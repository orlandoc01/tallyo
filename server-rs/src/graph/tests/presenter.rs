use anyhow::Result;
use serde_json::{Value, json};

use super::{all_scopes, code, global_id, path, seed};
use crate::{auth::Scope, graph::MAX_COMPLEXITY, ids::GlobalIdType};

#[tokio::test]
async fn api_errors_keep_their_message_and_code() -> Result<()> {
    let fixture = seed().await?;
    let owner = global_id(GlobalIdType::Owner, fixture.owner.id);
    let (data, errors) = fixture
        .execute_with(
            "query($id: ID!) { transaction(id: $id) { id } }",
            all_scopes(),
            json!({"id": owner}),
        )
        .await?;
    assert_eq!(data, json!({"transaction": Value::Null}));
    assert_eq!(errors.len(), 1);
    assert_eq!(
        errors[0].message,
        "wrong global id type \"Owner\", expected \"Transaction\""
    );
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");
    assert_eq!(path(&errors[0]), "transaction");

    let (_, errors) = fixture.execute("{ owners { items { name } } }", vec![]).await?;
    assert_eq!(errors[0].message, "forbidden: read:owners access required");
    assert_eq!(code(&errors[0]), "FORBIDDEN");
    Ok(())
}

#[tokio::test]
async fn parse_and_validation_errors_are_masked_as_invalid_requests() -> Result<()> {
    let fixture = seed().await?;
    for query in [
        "{ owners {",
        "{ bogus }",
        "{ transactions(input: { filter: { bogus: true } }) { totalCount } }",
        "{ transactions(input: { sort: { field: BOGUS, direction: ASC } }) { totalCount } }",
        "mutation { deleteTransaction { success } }",
        "query($ids: [ID!]!) { nodes(ids: $ids) { id } }",
    ] {
        let (data, errors) = fixture.execute(query, all_scopes()).await?;
        assert_eq!(data, Value::Null, "{query}");
        assert_eq!(errors.len(), 1, "{query}: {errors:?}");
        assert_eq!(errors[0].message, "invalid GraphQL request", "{query}");
        assert_eq!(code(&errors[0]), "BAD_USER_INPUT", "{query}");
    }

    let (_, errors) = fixture
        .execute_with(
            "query($ids: [ID!]!) { nodes(ids: $ids) { id } }",
            all_scopes(),
            json!({"ids": [Value::Null]}),
        )
        .await?;
    assert_eq!(errors[0].message, "invalid GraphQL request");
    Ok(())
}

#[tokio::test]
async fn input_coercion_failures_are_user_errors() -> Result<()> {
    let fixture = seed().await?;
    let (_, errors) = fixture
        .execute(
            r#"{ accountSnapshot(input: { date: "2026-1-2" }) { id } }"#,
            all_scopes(),
        )
        .await?;
    assert_eq!(errors.len(), 1);
    assert!(
        errors[0].message.contains("date must use YYYY-MM-DD"),
        "{}",
        errors[0].message
    );
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");
    Ok(())
}

#[tokio::test]
async fn internal_errors_are_masked() -> Result<()> {
    let fixture = seed().await?;
    let (data, errors) = fixture
        .execute(r#"{ assetQuote(ticker: "VTI") { priceUSD } }"#, all_scopes())
        .await?;
    assert_eq!(data, Value::Null);
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].message, "internal error");
    assert_eq!(code(&errors[0]), "INTERNAL");
    assert_eq!(path(&errors[0]), "assetQuote");
    Ok(())
}

#[tokio::test]
async fn introspection_is_disabled() -> Result<()> {
    let fixture = seed().await?;
    for (query, field) in [
        ("{ __schema { types { name } } }", "__schema"),
        (r#"{ __type(name: "Query") { name } }"#, "__type"),
    ] {
        let (data, errors) = fixture.execute(query, all_scopes()).await?;
        assert!(data[field].is_null(), "{query}: {data}");
        assert!(errors.is_empty(), "{query}: {errors:?}");
    }
    let (data, errors) = fixture.execute("{ __typename }", all_scopes()).await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data, json!({"__typename": "Query"}));
    Ok(())
}

#[tokio::test]
async fn complexity_limit_counts_node_ids_times_selection() -> Result<()> {
    let fixture = seed().await?;
    let account = global_id(GlobalIdType::Account, fixture.plaid_account_id);
    let query =
        "query($ids: [ID!]!) { nodes(ids: $ids) { id ... on Account { name type subtype mask notes closed } } }";
    let (_, errors) = fixture
        .execute_with(query, all_scopes(), json!({"ids": vec![account.clone(); 100]}))
        .await?;
    assert_eq!(
        errors.len(),
        1,
        "100 ids x 7 fields exceed {MAX_COMPLEXITY}: {errors:?}"
    );
    assert_eq!(errors[0].message, "invalid GraphQL request");
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");

    let (data, errors) = fixture
        .execute_with(query, all_scopes(), json!({"ids": vec![account; 70]}))
        .await?;
    assert!(errors.is_empty(), "70 ids x 7 fields stay under the limit: {errors:?}");
    assert_eq!(data["nodes"].as_array().unwrap().len(), 70);

    let (_, errors) = fixture
        .execute(
            "{ accounts { items { id name connection { id provider { __typename } } } } connections { items { id name isActive provider { ... on PlaidItem { accounts { id name type subtype mask notes closed hidden manual typeLocked lastSyncedAt createdAt updatedAt } } ... on SimpleFinConnection { accounts { id name type } } } } } }",
            vec![Scope::ReadAccounts],
        )
        .await?;
    assert!(
        errors.is_empty(),
        "real account/provider queries stay under the limit: {errors:?}"
    );
    Ok(())
}

#[tokio::test]
async fn every_root_field_carries_a_known_scope() -> Result<()> {
    use crate::schema::SCOPES;

    for (type_name, field, scope) in SCOPES {
        assert!(
            scope.parse::<Scope>().is_ok(),
            "{type_name}.{field} scope {scope:?} is not an auth::Scope"
        );
    }
    let sdl = seed().await?.schema().sdl();
    for root in ["Query", "Mutation"] {
        let definition = sdl
            .split(&format!("type {root} {{"))
            .nth(1)
            .and_then(|rest| rest.split("\n}").next())
            .unwrap();
        let mut in_description = false;
        let fields = definition
            .lines()
            .map(str::trim)
            .filter(|line| {
                if line.contains("\"\"\"") {
                    in_description = line.matches("\"\"\"").count() == 1 && !in_description;
                    return false;
                }
                !in_description && !line.is_empty()
            })
            .map(|line| line.split(['(', ':']).next().unwrap())
            .collect::<Vec<_>>();
        assert!(fields.len() > 30, "{root} fields: {fields:?}");
        for field in fields {
            let guarded = SCOPES.iter().any(|(typ, name, _)| *typ == root && *name == field);
            let dynamic = root == "Query" && matches!(field, "node" | "nodes");
            assert!(guarded || dynamic, "{root}.{field} has no @requiresScope");
        }
    }
    Ok(())
}

#[tokio::test]
async fn scope_failures_on_root_fields_null_the_field_only() -> Result<()> {
    let fixture = seed().await?;
    let (data, errors) = fixture
        .execute(
            "{ owners { items { name } } tags { items { name } } }",
            vec![Scope::ReadOwners],
        )
        .await?;
    // async-graphql drops a failed non-null root field instead of nulling `data`.
    assert_eq!(data, json!({"owners": {"items": [{"name": "Alex"}]}}));
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].message, "forbidden: read:tags access required");
    assert_eq!(path(&errors[0]), "tags");

    let (data, errors) = fixture
        .execute_with(
            "query($id: ID!) { transaction(id: $id) { id } owners { items { name } } }",
            vec![Scope::ReadOwners],
            json!({"id": global_id(GlobalIdType::Transaction, fixture.tagged_transaction_id)}),
        )
        .await?;
    assert_eq!(data["owners"]["items"], json!([{"name": "Alex"}]));
    assert_eq!(data["transaction"], Value::Null);
    assert_eq!(errors[0].message, "forbidden: read:transactions access required");
    Ok(())
}
