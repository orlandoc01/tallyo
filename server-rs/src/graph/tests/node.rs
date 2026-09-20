use anyhow::Result;
use serde_json::{Value, json};

use super::{all_scopes, code, global_id, seed};
use crate::{
    admin::store as admin_store,
    auth::{Identity, Scope},
    budgets,
    graph::node::MAX_NODE_IDS,
    ids::GlobalIdType,
    money::Cents,
    schema::{Role, SetBudgetInput},
    transactions::store as transactions_store,
};

#[tokio::test]
async fn node_and_nodes_dispatch_on_the_global_id_type() -> Result<()> {
    let fixture = seed().await?;
    let user = admin_store::insert_user(&fixture.pool, "nodes@example.com", None, Role::Admin).await?;
    let category_id = sqlx::query_scalar::<_, i64>("SELECT id FROM categories WHERE name = 'Groceries'")
        .fetch_one(&fixture.pool)
        .await?;
    let group_id = sqlx::query_scalar::<_, i64>("SELECT group_id FROM categories WHERE id = ?")
        .bind(category_id)
        .fetch_one(&fixture.pool)
        .await?;
    let budget = budgets::set_budget(
        &fixture.pool,
        SetBudgetInput {
            month: "2026-06".to_owned(),
            category_id: global_id(GlobalIdType::Category, category_id),
            amount: Cents(25_000),
        },
    )
    .await?;
    let snapshot_id =
        sqlx::query_scalar::<_, i64>("SELECT id FROM account_balance_daily_snapshots WHERE account_id = ?")
            .bind(fixture.plaid_account_id)
            .fetch_one(&fixture.pool)
            .await?;
    let token_id = sqlx::query_scalar::<_, i64>("SELECT id FROM simplefin_access_tokens")
        .fetch_one(&fixture.pool)
        .await?;
    let simplefin_connection_id = sqlx::query_scalar::<_, i64>("SELECT id FROM simplefin_connections")
        .fetch_one(&fixture.pool)
        .await?;
    let plaid_item_id = sqlx::query_scalar::<_, i64>("SELECT id FROM plaid_items")
        .fetch_one(&fixture.pool)
        .await?;

    let ids = [
        (GlobalIdType::Owner, fixture.owner.id, "Owner"),
        (GlobalIdType::Account, fixture.plaid_account_id, "Account"),
        (GlobalIdType::Connection, fixture.plaid_connection_id, "Connection"),
        (GlobalIdType::PlaidItem, plaid_item_id, "PlaidItem"),
        (GlobalIdType::SimpleFinAccessToken, token_id, "SimpleFinAccessToken"),
        (
            GlobalIdType::SimpleFinConnection,
            simplefin_connection_id,
            "SimpleFinConnection",
        ),
        (GlobalIdType::Asset, fixture.stock_asset_id, "Asset"),
        (GlobalIdType::AccountSnapshot, snapshot_id, "AccountSnapshot"),
        (GlobalIdType::Budget, budget.id, "Budget"),
        (GlobalIdType::Category, category_id, "Category"),
        (GlobalIdType::CategoryGroup, group_id, "CategoryGroup"),
        (GlobalIdType::Tag, fixture.tag_id, "Tag"),
        (GlobalIdType::Rule, fixture.rule_id, "Rule"),
        (GlobalIdType::Transaction, fixture.tagged_transaction_id, "Transaction"),
        (GlobalIdType::User, user.id, "User"),
    ];
    let encoded = ids.iter().map(|(typ, id, _)| global_id(*typ, *id)).collect::<Vec<_>>();
    let (data, errors) = fixture
        .execute_with(
            "query($ids: [ID!]!) { nodes(ids: $ids) { __typename id } }",
            all_scopes(),
            json!({"ids": encoded}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    let nodes = data["nodes"].as_array().unwrap();
    assert_eq!(nodes.len(), ids.len());
    for (node, ((typ, id, typename), encoded)) in nodes.iter().zip(ids.iter().zip(encoded)) {
        assert_eq!(node["__typename"], *typename, "{typ:?}");
        assert_eq!(node["id"], encoded.as_str(), "{typ:?} {id}");
    }

    // Every type resolves a missing row to null, including the two the fixture cannot seed.
    let missing = [
        GlobalIdType::Owner,
        GlobalIdType::Account,
        GlobalIdType::Connection,
        GlobalIdType::PlaidItem,
        GlobalIdType::SimpleFinAccessToken,
        GlobalIdType::SimpleFinConnection,
        GlobalIdType::Asset,
        GlobalIdType::AccountSnapshot,
        GlobalIdType::Budget,
        GlobalIdType::Category,
        GlobalIdType::CategoryGroup,
        GlobalIdType::Tag,
        GlobalIdType::Rule,
        GlobalIdType::Transaction,
        GlobalIdType::User,
        GlobalIdType::RecurringCharge,
        GlobalIdType::BalanceSnapshotReview,
    ]
    .map(|typ| global_id(typ, 999_999));
    let (data, errors) = fixture
        .execute_with(
            "query($ids: [ID!]!, $one: ID!) { nodes(ids: $ids) { id } node(id: $one) { id } }",
            all_scopes(),
            json!({"ids": missing, "one": missing[1]}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["nodes"], json!(vec![Value::Null; missing.len()]));
    assert_eq!(data["node"], Value::Null);
    Ok(())
}

#[tokio::test]
async fn node_resolves_nested_fields_through_the_loaders() -> Result<()> {
    let fixture = seed().await?;
    let token_id = sqlx::query_scalar::<_, i64>("SELECT id FROM simplefin_access_tokens")
        .fetch_one(&fixture.pool)
        .await?;
    let (data, errors) = fixture
        .execute_with(
            "query($id: ID!) { node(id: $id) { __typename ... on SimpleFinAccessToken { label connections { orgDomain accounts { name } } } } }",
            all_scopes(),
            json!({"id": global_id(GlobalIdType::SimpleFinAccessToken, token_id)}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        data["node"],
        json!({"__typename": "SimpleFinAccessToken", "label": "Bridge", "connections": [{"orgDomain": "bank.example", "accounts": [{"name": "Bank savings"}]}]})
    );
    Ok(())
}

#[tokio::test]
async fn nodes_reject_too_many_ids_and_invalid_ids() -> Result<()> {
    let fixture = seed().await?;
    let too_many = vec![global_id(GlobalIdType::Owner, fixture.owner.id); MAX_NODE_IDS + 1];
    let (data, errors) = fixture
        .execute_with(
            "query($ids: [ID!]!) { nodes(ids: $ids) { id } }",
            all_scopes(),
            json!({"ids": too_many}),
        )
        .await?;
    assert_eq!(data, json!({"nodes": Value::Null}));
    assert_eq!(errors[0].message, "nodes accepts at most 100 ids");
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");

    let (_, errors) = fixture
        .execute_with(
            "query($ids: [ID!]!) { nodes(ids: $ids) { id } }",
            all_scopes(),
            json!({"ids": ["not-a-global-id"]}),
        )
        .await?;
    assert_eq!(errors[0].message, "invalid global id");
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");
    Ok(())
}

#[tokio::test]
async fn node_checks_the_scope_of_each_type_before_fetching() -> Result<()> {
    let fixture = seed().await?;
    let account = global_id(GlobalIdType::Account, fixture.plaid_account_id);
    let user = global_id(GlobalIdType::User, 1);
    for (scopes, ids, message) in [
        (
            vec![],
            vec![account.clone()],
            "forbidden: read:accounts access required",
        ),
        (
            vec![Scope::ReadAccounts],
            vec![account.clone(), user.clone()],
            "forbidden: read:users access required",
        ),
        (
            vec![Scope::ReadAccounts],
            vec![user.clone()],
            "forbidden: read:users access required",
        ),
    ] {
        let (data, errors) = fixture
            .execute_with(
                "query($ids: [ID!]!, $one: ID!) { nodes(ids: $ids) { id } node(id: $one) { id } }",
                scopes,
                json!({"ids": ids, "one": ids[ids.len() - 1]}),
            )
            .await?;
        assert_eq!(data, json!({"nodes": Value::Null, "node": Value::Null}));
        assert_eq!(errors.len(), 2, "{errors:?}");
        assert!(errors.iter().all(|error| error.message == message), "{errors:?}");
        assert!(errors.iter().all(|error| code(error) == "FORBIDDEN"));
    }

    let response = fixture
        .schema()
        .execute(async_graphql::Request::new(format!(
            "{{ node(id: {:?}) {{ id }} }}",
            account.as_str()
        )))
        .await;
    assert_eq!(response.errors[0].message, "forbidden: read:accounts access required");
    let _ = Identity::with_scopes;

    let (data, errors) = fixture
        .execute_with(
            "query($id: ID!) { node(id: $id) { ... on Account { name } } }",
            vec![Scope::ReadAccounts],
            json!({"id": account}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["node"]["name"], "Checking");
    Ok(())
}

#[tokio::test]
async fn hydrated_rules_and_plaid_items_carry_their_relations() -> Result<()> {
    let fixture = seed().await?;
    let resolver = fixture.resolver();
    let rules = resolver.hydrate_rules(resolver.rules(None).await?.items).await?;
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0].rule.id, fixture.rule_id);
    assert_eq!(
        rules[0].tags.iter().map(|tag| tag.name.as_str()).collect::<Vec<_>>(),
        ["Household"]
    );
    assert_eq!(
        rules[0]
            .accounts
            .iter()
            .map(|account| account.name.as_str())
            .collect::<Vec<_>>(),
        ["Checking"]
    );

    let items = resolver
        .hydrate_plaid_items(resolver.plaid_items(None).await?.items)
        .await?;
    assert_eq!(items.len(), 1);
    assert_eq!(
        items[0]
            .credential
            .as_ref()
            .map(|credential| credential.client_id.as_str()),
        Some("client")
    );
    assert_eq!(
        items[0]
            .accounts
            .iter()
            .map(|account| account.name.as_str())
            .collect::<Vec<_>>(),
        ["Checking"]
    );

    transactions_store::delete_rule(&fixture.pool, fixture.rule_id).await?;
    assert!(resolver.hydrate_rules(Vec::new()).await?.is_empty());
    assert!(resolver.hydrate_plaid_items(Vec::new()).await?.is_empty());
    Ok(())
}
