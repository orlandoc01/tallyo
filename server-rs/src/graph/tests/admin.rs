use std::sync::Arc;

use anyhow::Result;
use async_graphql::Request;
use serde_json::{Value, json};
use wiremock::MockServer;

use super::{all_scopes, code, global_id, request, seed};
use crate::{
    accounts::{LinkService, PlaidClientFactory, store as accounts_store},
    admin::store as admin_store,
    auth::{Identity, Scope},
    graph::{Resolver, build_schema},
    ids::GlobalIdType,
    schema::Role,
    testutil::{plaid_mock, simplefin_mock},
};

#[tokio::test]
async fn users_execute_and_default_to_the_writer_role() -> Result<()> {
    let fixture = seed().await?;
    let admin = admin_store::insert_user(&fixture.pool, "admin@example.com", None, Role::Admin).await?;
    let identity = Identity {
        subject: Some(admin.email.clone()),
        ..Identity::with_scopes(all_scopes())
    };
    let response = fixture
        .schema()
        .execute(
            Request::new(
                r#"mutation { addUser(input: { email: " Friend@Example.com " }) { user { id email role } } }"#,
            )
            .data(identity),
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json()?;
    assert_eq!(data["addUser"]["user"]["email"], "friend@example.com");
    assert_eq!(data["addUser"]["user"]["role"], "WRITER");
    let user_id = data["addUser"]["user"]["id"].as_str().unwrap().to_owned();
    let invited_by =
        sqlx::query_scalar::<_, Option<i64>>("SELECT invited_by FROM users WHERE email = 'friend@example.com'")
            .fetch_one(&fixture.pool)
            .await?;
    assert_eq!(invited_by, Some(admin.id));

    let (data, errors) = fixture
        .execute_with(
            "mutation($id: ID!) { updateUser(input: { id: $id, role: READONLY }) { user { role } } createInviteLink(input: { userId: $id }) { url } }",
            all_scopes(),
            json!({"id": user_id}),
        )
        .await?;
    assert_eq!(data["updateUser"]["user"]["role"], "READONLY");
    assert_eq!(data["createInviteLink"], Value::Null);
    assert_eq!(errors[0].message, "invitations are not configured");
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");

    let (data, errors) = fixture
        .execute("{ users { items { email role } } }", all_scopes())
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        data["users"]["items"],
        json!([{"email": "admin@example.com", "role": "ADMIN"}, {"email": "friend@example.com", "role": "READONLY"}])
    );

    let (data, errors) = fixture
        .execute_with(
            "mutation($id: ID!) { removeUser(input: { id: $id }) { success } }",
            all_scopes(),
            json!({"id": user_id}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["removeUser"]["success"], true);

    let wrong = global_id(GlobalIdType::Owner, 1);
    let (_, errors) = fixture
        .execute_with(
            r#"mutation($wrong: ID!) { addUser(input: { email: "  " }) { user { id } } createInviteLink(input: { userId: $wrong }) { url } removeUser(input: { id: $wrong }) { success } updateUser(input: { id: $wrong, role: ADMIN }) { user { id } } }"#,
            all_scopes(),
            json!({"wrong": wrong}),
        )
        .await?;
    assert_eq!(errors.len(), 4, "{errors:?}");
    assert!(errors.iter().all(|error| code(error) == "BAD_USER_INPUT"), "{errors:?}");
    assert!(errors.iter().any(|error| error.message == "email is required"));
    Ok(())
}

#[tokio::test]
async fn plaid_credentials_execute() -> Result<()> {
    let fixture = seed().await?;
    let (data, errors) = fixture
        .execute(
            r#"mutation { createPlaidCredential(input: { clientId: "client-2", secret: "secret", environment: SANDBOX, label: "Second" }) { credential { id clientId environment label itemCount } } }"#,
            all_scopes(),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    let credential = &data["createPlaidCredential"]["credential"];
    assert_eq!(credential["clientId"], "client-2");
    assert_eq!(credential["environment"], "SANDBOX");
    let id = credential["id"].as_i64().unwrap();

    let (data, errors) = fixture
        .execute_with(
            r#"mutation($id: Int!) { updatePlaidCredential(input: { id: $id, secret: "secret-2", environment: DEVELOPMENT }) { credential { environment } } }"#,
            all_scopes(),
            json!({"id": id}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        data["updatePlaidCredential"]["credential"]["environment"],
        "DEVELOPMENT"
    );

    let (data, errors) = fixture
        .execute("{ plaidCredentials { items { clientId } } }", all_scopes())
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["plaidCredentials"]["items"].as_array().unwrap().len(), 2);

    let (data, errors) = fixture
        .execute_with(
            "mutation($id: Int!) { deletePlaidCredential(input: { id: $id }) { success } }",
            all_scopes(),
            json!({"id": id}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["deletePlaidCredential"]["success"], true);
    Ok(())
}

#[tokio::test]
async fn plaid_link_flow_executes_against_the_mock() -> Result<()> {
    let server = MockServer::start().await;
    plaid_mock::mount_link_flow(&server).await;
    let fixture = seed().await?;
    let credential_id = sqlx::query_scalar::<_, i64>("SELECT id FROM plaid_credentials")
        .fetch_one(&fixture.pool)
        .await?;
    let base = fixture.resolver();
    let resolver = Resolver {
        linker: Arc::new(LinkService {
            pool: fixture.pool.clone(),
            clients: Arc::new(PlaidClientFactory::with_base_url(fixture.pool.clone(), server.uri())),
            syncer: base.syncer.clone(),
            events: base.linker.events.clone(),
        }),
        ..base
    };
    let schema = build_schema(resolver);
    let owner = global_id(GlobalIdType::Owner, fixture.owner.id);

    let response = schema
        .execute(
            request(
                "mutation($owner: ID!, $credential: Int!) { createLinkToken(input: { credentialId: $credential, ownerId: $owner }) { linkToken } exchangePublicToken(input: { publicToken: \"public\", credentialId: $credential, ownerId: $owner, institutionId: \"ins\" }) { item { id institutionId } accounts { name } } }",
                all_scopes(),
            )
            .variables(async_graphql::Variables::from_json(json!({"owner": owner, "credential": credential_id}))),
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json()?;
    assert_eq!(data["createLinkToken"]["linkToken"], "link");
    // The mock item shares the seeded item's external id, so both linked accounts come back.
    let accounts = data["exchangePublicToken"]["accounts"].as_array().unwrap();
    assert!(
        !accounts.is_empty() && accounts.iter().all(|account| account["name"] == "Checking"),
        "{accounts:?}"
    );
    let item_id = data["exchangePublicToken"]["item"]["id"].as_str().unwrap().to_owned();

    let response = schema
        .execute(
            request(
                "mutation($item: ID!) { createUpdateLinkToken(itemId: $item) { linkToken } completeLinkUpdate(itemId: $item) { item { id } } }",
                all_scopes(),
            )
            .variables(async_graphql::Variables::from_json(json!({"item": item_id}))),
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json()?;
    assert_eq!(data["createUpdateLinkToken"]["linkToken"], "link");
    assert_eq!(data["completeLinkUpdate"]["item"]["id"], item_id);

    let response = schema
        .execute(
            request(
                "mutation($wrong: ID!) { createUpdateLinkToken(itemId: $wrong) { linkToken } completeLinkUpdate(itemId: $wrong) { item { id } } createLinkToken(input: { credentialId: 1, ownerId: $wrong }) { linkToken } }",
                all_scopes(),
            )
            .variables(async_graphql::Variables::from_json(json!({"wrong": global_id(GlobalIdType::Account, 1)}))),
        )
        .await;
    assert_eq!(response.errors.len(), 3, "{:?}", response.errors);
    assert!(response.errors.iter().all(|error| code(error) == "BAD_USER_INPUT"));
    Ok(())
}

#[tokio::test]
async fn simplefin_access_tokens_execute() -> Result<()> {
    let server = MockServer::start().await;
    let access_url = simplefin_mock::access_url(&server);
    simplefin_mock::mount_claim(&server, &access_url).await;
    simplefin_mock::mount_accounts(&server, simplefin_mock::full_accounts_response()).await;
    let fixture = seed().await?;
    let owner = global_id(GlobalIdType::Owner, fixture.owner.id);

    let (data, errors) = fixture
        .execute_with(
            "mutation($owner: ID!, $token: String!) { createSimpleFinAccessToken(input: { setupToken: $token, ownerId: $owner, label: \"Second\" }) { accessToken { id label } connections { orgDomain } accounts { name } } }",
            all_scopes(),
            json!({"owner": owner, "token": simplefin_mock::setup_token(&server)}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    let created = &data["createSimpleFinAccessToken"];
    assert_eq!(created["accessToken"]["label"], "Second");
    assert_eq!(created["connections"].as_array().unwrap().len(), 1);
    assert_eq!(created["accounts"], json!([{"name": "Checking"}]));

    let (data, errors) = fixture
        .execute("{ simpleFinAccessTokens { items { id } } }", all_scopes())
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    let token_id = data["simpleFinAccessTokens"]["items"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();

    let (data, errors) = fixture
        .execute_with(
            "mutation($id: ID!) { resetSimpleFinSync(id: $id) { id } }",
            all_scopes(),
            json!({"id": token_id}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["resetSimpleFinSync"]["id"], token_id);

    let (_, errors) = fixture
        .execute_with(
            "mutation($id: ID!) { resetSimpleFinSync(id: $id) { id } }",
            all_scopes(),
            json!({"id": global_id(GlobalIdType::SimpleFinAccessToken, 999_999)}),
        )
        .await?;
    assert_eq!(errors[0].message, "simplefin access token 999999 not found");
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");

    let (_, errors) = fixture
        .execute_with(
            "mutation($id: ID!) { deleteSimpleFinAccessToken(id: $id) }",
            all_scopes(),
            json!({"id": owner}),
        )
        .await?;
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");

    let (data, errors) = fixture
        .execute_with(
            "mutation($id: ID!) { deleteSimpleFinAccessToken(id: $id) }",
            all_scopes(),
            json!({"id": token_id}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["deleteSimpleFinAccessToken"], true);
    Ok(())
}

#[tokio::test]
async fn connections_update_and_delete() -> Result<()> {
    let fixture = seed().await?;
    let connection = global_id(GlobalIdType::Connection, fixture.plaid_connection_id);
    let (data, errors) = fixture
        .execute_with(
            r#"mutation($id: ID!) { updateConnection(input: { connectionId: $id, syncCron: "0 */2 * * *", recurringSyncCron: "0 12 * * 0" }) { connection { id isActive } } }"#,
            all_scopes(),
            json!({"id": connection}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["updateConnection"]["connection"]["id"], connection.as_str());

    for (name, input, message) in [
        (
            "too frequent",
            r#"syncCron: "*/30 * * * *", recurringSyncCron: "0 12 * * 0""#,
            "syncCron: ",
        ),
        (
            "missing partner",
            r#"syncCron: "0 */2 * * *""#,
            "syncCron and recurringSyncCron are required together",
        ),
        (
            "invalid expression",
            r#"syncCron: "not a cron", recurringSyncCron: "0 12 * * 0""#,
            "syncCron: ",
        ),
    ] {
        let (_, errors) = fixture
            .execute_with(
                &format!("mutation($id: ID!) {{ updateConnection(input: {{ connectionId: $id, {input} }}) {{ connection {{ id }} }} }}"),
                all_scopes(),
                json!({"id": connection}),
            )
            .await?;
        assert_eq!(errors.len(), 1, "{name}: {errors:?}");
        assert!(errors[0].message.starts_with(message), "{name}: {}", errors[0].message);
        assert_eq!(code(&errors[0]), "BAD_USER_INPUT", "{name}");
    }

    let wallet_connection_id =
        sqlx::query_scalar::<_, i64>("SELECT id FROM connections WHERE source_table = 'evm_wallets'")
            .fetch_one(&fixture.pool)
            .await?;
    let (data, errors) = fixture
        .execute_with(
            r#"mutation($id: ID!) { updateConnection(input: { connectionId: $id, chainIds: ["op", "arb", "op"] }) { connection { provider { ... on EVMWallet { chainIds } } } } }"#,
            all_scopes(),
            json!({"id": global_id(GlobalIdType::Connection, wallet_connection_id)}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        data["updateConnection"]["connection"]["provider"]["chainIds"],
        json!(["arb", "op"])
    );
    let wallet = accounts_store::evm_wallet_by_connection_id(&fixture.pool, wallet_connection_id)
        .await?
        .unwrap();
    assert_eq!(wallet.chain_ids, ["arb", "op"]);

    let (_, errors) = fixture
        .execute_with(
            "mutation($id: ID!) { updateConnection(input: { connectionId: $id, isActive: false }) { connection { id } } }",
            all_scopes(),
            json!({"id": global_id(GlobalIdType::Connection, 999_999)}),
        )
        .await?;
    assert_eq!(errors[0].message, "connection 999999 not found");
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");

    let (data, errors) = fixture
        .execute_with(
            "mutation($wallet: ID!, $plaid: ID!) { unlinkEVMWallet(id: $wallet) deleteConnection(input: { connectionId: $plaid }) { success } }",
            all_scopes(),
            json!({"wallet": global_id(GlobalIdType::Connection, wallet_connection_id), "plaid": connection}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        data,
        json!({"unlinkEVMWallet": true, "deleteConnection": {"success": true}})
    );

    let (data, errors) = fixture
        .execute_with(
            r#"mutation($owner: ID!) { linkEVMWallet(input: { address: "0x2222222222222222222222222222222222222222", chainIds: ["eth"], ownerId: $owner, label: "Cold" }) { connection { name } account { name type } } }"#,
            all_scopes(),
            json!({"owner": global_id(GlobalIdType::Owner, fixture.owner.id)}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["linkEVMWallet"]["account"]["type"], "CRYPTO_WALLET");
    let (data, errors) = fixture
        .execute("{ evmChains { items { id name } } }", vec![Scope::ReadAccounts])
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert!(
        data["evmChains"]["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|chain| chain["id"] == "eth")
    );

    let (_, errors) = fixture
        .execute_with(
            r#"mutation($wrong: ID!) { linkEVMWallet(input: { address: "0x", chainIds: [], ownerId: $wrong }) { account { id } } unlinkEVMWallet(id: $wrong) }"#,
            all_scopes(),
            json!({"wrong": global_id(GlobalIdType::Account, 1)}),
        )
        .await?;
    assert_eq!(errors.len(), 2, "{errors:?}");
    assert!(errors.iter().all(|error| code(error) == "BAD_USER_INPUT"));

    let (_, errors) = fixture
        .execute(
            "mutation { deleteConnection(input: { connectionId: \"x\" }) { success } }",
            vec![Scope::ReadAccounts],
        )
        .await?;
    assert_eq!(errors[0].message, "forbidden: write:accounts access required");
    Ok(())
}
