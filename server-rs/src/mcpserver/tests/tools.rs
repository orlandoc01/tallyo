use anyhow::Result;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use sqlx::SqlitePool;

use super::{Client, all_scopes, api_error, global_id, identity, is_error, server, text};
use crate::{
    accounts::Owner,
    apierror::Code,
    auth::Scope,
    graph::{operation_scope, require_scope},
    ids::GlobalIdType,
    mcpserver::{
        Server, tool_result,
        tools::{Kind, NoInput, ToolOutput, ToolSpec, input_schema},
    },
    money::Cents,
    schema::{AccountType, AnalysisInput, AnalysisView},
    testutil::{
        store::{create_owner, seed_plaid_account, seed_plaid_item},
        transactions::transaction,
    },
    transactions::store as transactions_store,
    wealth::{AccountBalanceSnapshot, AssetDailyHolding, store as wealth_store},
};

fn input<T: DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).unwrap()
}

struct Seeded {
    owner: Owner,
    account_id: i64,
}

async fn seed_account(pool: &SqlitePool) -> Result<Seeded> {
    let owner = create_owner(pool, "Alex").await?;
    let (_, connection) = seed_plaid_item(pool, &owner, "item").await?;
    let account_id = seed_plaid_account(pool, &owner, &connection, "acc").await?;
    Ok(Seeded { owner, account_id })
}

async fn seed_transaction(pool: &SqlitePool, merchant: &str, account_id: i64, dollars: f64, at: &str) -> Result<i64> {
    transaction(pool, merchant, account_id, 0, Cents::from_dollars(dollars), at.parse()?).await
}

async fn groceries(pool: &SqlitePool) -> Result<String> {
    let id = sqlx::query_scalar::<_, i64>("SELECT id FROM categories WHERE name = 'Groceries'")
        .fetch_one(pool)
        .await?;
    Ok(global_id(GlobalIdType::Category, id))
}

#[tokio::test]
async fn curated_tools_read_and_mutate_transactions() -> Result<()> {
    let (pool, server) = server().await?;
    let seeded = seed_account(&pool).await?;
    let tx1 = seed_transaction(&pool, "Coffee Shop", seeded.account_id, 4.50, "2026-05-20T12:00:00Z").await?;
    seed_transaction(&pool, "Coffee Shop 2", seeded.account_id, 9.25, "2026-05-21T12:00:00Z").await?;
    let account_id = global_id(GlobalIdType::Account, seeded.account_id);
    let tx1_id = global_id(GlobalIdType::Transaction, tx1);
    let missing_id = global_id(GlobalIdType::Transaction, 999_999);
    let identity = all_scopes();

    let listed = server.list_transactions(input(json!({"first": 10}))).await?;
    assert_eq!((listed.value.total_count, listed.value.items.len()), (2, 2));
    assert_eq!(listed.summary, "Fetched 2 transactions (2 total).");

    let items = server
        .list_plaid_items(input(json!({"includeInactive": true})))
        .await?
        .value
        .items;
    assert_eq!(items.len(), 1);
    assert!(items[0].credential.is_some());
    assert_eq!(items[0].accounts.len(), 1);

    let fetched = server.get_transaction(input(json!({"id": tx1_id}))).await?;
    assert!(fetched.value.transaction.is_some());
    assert_eq!(fetched.summary, "Fetched transaction.");
    let missing = server.get_transaction(input(json!({"id": missing_id}))).await?;
    assert!(missing.value.transaction.is_none());
    assert_eq!(missing.summary, "Transaction not found.");

    let range = json!({"datetimeRange": {"from": "2026-05-01T00:00:00Z", "to": "2026-06-01T00:00:00Z"}});
    let spending = server.spending_by_category(&identity, input(range.clone())).await?;
    assert!(
        spending.summary.starts_with("Total spending: $"),
        "{}",
        spending.summary
    );
    let cash_flow = server.cash_flow(&identity, input(range)).await?;
    assert_eq!(
        cash_flow.summary,
        format!("Fetched {} cash-flow periods.", cash_flow.value.periods.len())
    );
    let summary = server.transactions_summary(input(json!({}))).await?;
    assert_eq!(summary.value.total_count, 2);
    assert_eq!(summary.summary, "Matched 2 transactions totaling $13.75.");
    assert!(!server.list_categories().await?.value.items.is_empty());
    assert!(!server.list_category_groups().await?.value.items.is_empty());
    assert_eq!(
        server.list_recurring_charges().await?.summary,
        "Fetched 0 recurring groups."
    );
    assert_eq!(server.list_owners().await?.value.items[0].name, "Alex");
    let credentials = server.list_plaid_credentials().await?.value.items;
    assert_eq!(credentials.len(), 1);
    assert_eq!(credentials[0].item_count, 1);

    let groceries = groceries(&pool).await?;
    let bulk = server
        .bulk_update_transactions(input(
            json!({"transactionIds": [tx1_id], "updates": {"categoryId": groceries}}),
        ))
        .await?;
    assert_eq!(bulk.value.updated_count, 1);
    let updated = server
        .update_transaction(input(json!({
            "id": tx1_id,
            "updates": {"merchantName": "Reviewed Coffee", "notes": "reviewed"}
        })))
        .await?;
    let transaction = updated.value.transaction.unwrap();
    assert_eq!(transaction.merchant_name.as_deref(), Some("Reviewed Coffee"));
    assert_eq!(transaction.category_id, groceries);
    let error = server
        .update_transaction(input(json!({"id": missing_id, "updates": {"notes": "missing"}})))
        .await
        .unwrap_err();
    assert_eq!(api_error(&error).message, "transaction not found");

    let tag = transactions_store::create_tag(&pool, "Recurring Bills", "#ff0000").await?;
    let created = server
        .create_rule(input(json!({
            "merchantPattern": "Coffee",
            "changes": {"categoryId": groceries, "tagIds": [global_id(GlobalIdType::Tag, tag.id)]},
            "accountIds": [account_id]
        })))
        .await?;
    assert_eq!(created.value.rule.tags.len(), 1);
    let rules = server.list_rules(input(json!({}))).await?.value.items;
    assert_eq!(rules[0].tags[0].name, "Recurring Bills");
    assert_eq!(rules[0].accounts.len(), 1);
    let filtered = server
        .list_rules(input(json!({"merchantPattern": "zzz-no-match"})))
        .await?;
    assert!(filtered.value.items.is_empty());
    let search_filtered = server.list_rules(input(json!({"search": "zzz-no-match"}))).await?;
    assert!(search_filtered.value.items.is_empty());
    let deleted = server
        .delete_rule(input(json!({"id": rules[0].id, "confirm": true})))
        .await?;
    assert!(deleted.value.success);
    assert_eq!(deleted.summary, "Deleted rule: true.");

    let manual = server
        .create_manual_account(input(json!({
            "name": "Cash",
            "ownerId": global_id(GlobalIdType::Owner, seeded.owner.id),
            "type": "DEPOSITORY"
        })))
        .await?;
    assert!(manual.value.account.manual);
    assert_eq!(manual.summary, "Created manual account.");
    let updated = server
        .update_account(input(
            json!({"id": account_id, "name": "Updated Checking", "type": "CREDIT"}),
        ))
        .await?;
    assert_eq!(updated.value.account.name, "Updated Checking");
    assert_eq!(updated.value.account.r#type, AccountType::Credit);

    let created = server
        .create_transaction(input(json!({
            "accountId": account_id,
            "date": "2026-05-22",
            "amount": 12.34,
            "merchantName": "Manual Coffee",
            "categoryId": groceries
        })))
        .await?;
    let manual_id = created.value.transaction.unwrap().id;
    let bulk_deleted = server
        .bulk_delete_transactions(input(json!({"transactionIds": [manual_id], "confirm": true})))
        .await?;
    assert_eq!(bulk_deleted.value.deleted_count, 1);
    let deleted = server
        .delete_transaction(input(json!({"id": tx1_id, "confirm": true})))
        .await?;
    assert!(deleted.value.success);
    assert_eq!(deleted.summary, "Deleted transaction: true.");
    Ok(())
}

#[tokio::test]
async fn portfolio_analysis_tool() -> Result<()> {
    let (pool, server) = server().await?;
    let owner = create_owner(&pool, "Alex").await?;
    let analysed = server
        .portfolio_analysis(input(json!({
            "view": "SECTORS",
            "ownerIds": [global_id(GlobalIdType::Owner, owner.id)],
            "accountSubtypes": ["401k"],
            "includeUnclassified": true
        })))
        .await?;
    assert_eq!(analysed.value.view, AnalysisView::Sectors);
    assert_eq!(analysed.summary, "Analyzed $0.00 across 0 portfolio slices.");

    // An invalid view is unrepresentable: it fails binding before the tool runs.
    let error = serde_json::from_value::<AnalysisInput>(json!({"view": "BAD"})).unwrap_err();
    assert!(error.to_string().contains("unknown variant `BAD`"), "{error}");
    Ok(())
}

#[tokio::test]
async fn budget_tools() -> Result<()> {
    let (pool, server) = server().await?;
    let groceries = groceries(&pool).await?;
    let set = server
        .set_budget(input(
            json!({"month": "2026-05", "categoryId": groceries, "amount": 500}),
        ))
        .await?;
    assert_eq!(set.value.budget.amount, Cents(50_000));
    assert_eq!(
        set.summary,
        format!("Set budget for category {groceries} in 2026-05 to $500.00.")
    );

    let report = server
        .budget_report(&all_scopes(), input(json!({"month": "2026-05"})))
        .await?;
    assert_eq!(report.value.month, "2026-05");
    assert!(
        report
            .summary
            .starts_with("Budget for 2026-05: $0.00 income planned, $500.00 expenses planned"),
        "{}",
        report.summary
    );
    Ok(())
}

async fn assert_error(client: &Client, tool: &str, arguments: Value, want: &str) -> Result<()> {
    let result = client.call(tool, arguments).await?;
    assert!(is_error(&result), "{tool}: {result}");
    assert!(
        text(&result).contains(want),
        "{tool}: {:?} should contain {want:?}",
        text(&result)
    );
    Ok(())
}

#[tokio::test]
async fn registered_tools_sdk_path() -> Result<()> {
    let (pool, server) = server().await?;
    let seeded = seed_account(&pool).await?;
    let tx = seed_transaction(&pool, "sdk-tx-1", seeded.account_id, 4.50, "2026-05-20T12:00:00Z").await?;
    let account_id = global_id(GlobalIdType::Account, seeded.account_id);
    let tx_id = global_id(GlobalIdType::Transaction, tx);

    let client = Client::connect(server.clone(), Some(all_scopes())).await?;
    let result = client.call("list_accounts", json!({})).await?;
    assert!(!is_error(&result), "{result}");
    assert_eq!(result["structuredContent"]["items"][0]["ownerName"], "Alex");
    assert!(
        text(&result).starts_with("Fetched 1 accounts.\n{\"items\":["),
        "{}",
        text(&result)
    );

    let anonymous = Client::connect(server.clone(), None).await?;
    assert_error(
        &anonymous,
        "list_accounts",
        json!({}),
        "forbidden: read:accounts access required",
    )
    .await?;
    let limited = Client::connect(server.clone(), Some(identity(&[Scope::ReadAccounts]))).await?;
    assert_error(
        &limited,
        "create_rule",
        json!({}),
        "forbidden: write:rules access required",
    )
    .await?;
    assert_error(
        &client,
        "get_transaction",
        json!({"id": 1}),
        "invalid type: integer `1`, expected a string",
    )
    .await?;
    assert_error(
        &client,
        "create_transaction",
        json!({"accountId": account_id, "date": "bad", "amount": 1}),
        "date must use YYYY-MM-DD",
    )
    .await?;
    assert_error(
        &client,
        "delete_transaction",
        json!({"id": tx_id, "confirm": false}),
        "required",
    )
    .await?;
    assert_error(
        &client,
        "delete_rule",
        json!({"id": tx_id, "confirm": false}),
        "required",
    )
    .await?;
    assert_error(
        &client,
        "delete_transaction",
        json!({"confirm": true}),
        "missing field `id`",
    )
    .await?;
    assert_error(
        &client,
        "list_accounts",
        json!({"unexpected": true}),
        "unknown field `unexpected`",
    )
    .await?;
    assert_error(
        &client,
        "bulk_delete_transactions",
        json!({"transactionIds": [null], "filter": {"accountIds": [account_id]}, "confirm": true}),
        "transactionIds contains a malformed id",
    )
    .await?;
    assert!(
        transactions_store::transaction_by_id(&pool, tx).await?.is_some(),
        "malformed bulk delete removed a filtered transaction"
    );
    let unknown = client
        .request("tools/call", json!({"name": "no_such_tool", "arguments": {}}))
        .await
        .unwrap_err();
    assert!(unknown.to_string().contains("unknown tool: no_such_tool"), "{unknown}");

    pool.close().await;
    let result = client.call("list_accounts", json!({})).await?;
    assert!(is_error(&result), "{result}");
    assert_eq!(text(&result), "internal error");
    Ok(())
}

async fn net_worth_as(server: &Server, scopes: &[Scope]) -> Result<Value> {
    Client::connect(server.clone(), Some(identity(scopes)))
        .await?
        .call("net_worth", json!({}))
        .await
}

#[tokio::test]
async fn net_worth_tool_scopes_holdings_through_sdk_path() -> Result<()> {
    let (pool, server) = server().await?;
    let seeded = seed_account(&pool).await?;
    let asset_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO assets (asset_type, identifier, classifier) VALUES ('SECURITY', 'MCP-HOLDING', 'PUBLIC') RETURNING id",
    )
    .fetch_one(&pool)
    .await?;
    wealth_store::replace_account_balance_snapshot(
        &pool,
        AccountBalanceSnapshot {
            account_id: seeded.account_id,
            wallet_address: String::new(),
            source: "plaid".to_owned(),
            date: "2026-06-01".to_owned(),
            synced_at: "2026-06-01T12:00:00Z".to_owned(),
            balance_usd: Cents::from_dollars(100.0),
            raw_payload: None,
            holdings: vec![AssetDailyHolding {
                asset_id,
                asset: None,
                adapter_source: None,
                adapter_sources: Vec::new(),
                price_update: None,
                quantity: Some(2.0),
                price: Some(50.0),
                value_usd: 100.0,
                counts_toward_value: true,
                manual: false,
                line_type: String::new(),
                chain_id: String::new(),
                project_name: None,
                token_id: String::new(),
                identifier: String::new(),
                token_symbol: None,
                token_name: None,
                provider_price: None,
            }],
            flagged: false,
            flag_reason: String::new(),
        },
    )
    .await?;

    let without = net_worth_as(&server, &[Scope::ReadWealth]).await?;
    assert!(!is_error(&without), "{without}");
    let rollup = &without["structuredContent"]["classifierBreakdown"][0]["holdings"][0];
    assert_eq!(rollup["asset"]["identifier"], "MCP-HOLDING");
    assert!(
        rollup.get("holdings").is_none(),
        "holdings should be omitted without read:holdings: {rollup}"
    );

    let with = net_worth_as(&server, &[Scope::ReadWealth, Scope::ReadHoldings]).await?;
    let holdings = &with["structuredContent"]["classifierBreakdown"][0]["holdings"][0]["holdings"];
    assert_eq!(
        holdings,
        &json!([{
            "assetId": global_id(GlobalIdType::Asset, asset_id),
            "accountId": global_id(GlobalIdType::Account, seeded.account_id),
            "quantity": 2.0,
            "valueUSD": 100,
            "manual": false
        }])
    );
    Ok(())
}

#[test]
fn tool_result_returns_structured_content_with_text_fallback() -> Result<()> {
    let output = |summary: &str| ToolOutput {
        value: json!({"ok": "true"}),
        summary: summary.to_owned(),
    };
    let result = serde_json::to_value(tool_result(output("summary")))?;
    assert_eq!(result["structuredContent"], json!({"ok": "true"}));
    assert_eq!(result["content"].as_array().map(Vec::len), Some(1));
    assert_eq!(result["content"][0]["text"], "summary\n{\"ok\":\"true\"}");
    assert_eq!(result["isError"], false);

    let bare = serde_json::to_value(tool_result(output("")))?;
    assert_eq!(bare["content"][0]["text"], "{\"ok\":\"true\"}");
    Ok(())
}

#[tokio::test]
async fn list_transactions_tool_rejects_invalid_page_args() -> Result<()> {
    let (pool, server) = server().await?;
    seed_account(&pool).await?;
    for (name, arguments) in [
        ("first and last together", json!({"first": 1, "last": 1})),
        ("non-positive first", json!({"first": 0})),
        ("malformed cursor", json!({"first": 1, "after": "not-valid-base64!!"})),
    ] {
        assert!(server.list_transactions(input(arguments)).await.is_err(), "{name}");
    }
    Ok(())
}

#[tokio::test]
async fn create_manual_account_tool_rejects_unknown_references() -> Result<()> {
    let (pool, server) = server().await?;
    let owner = create_owner(&pool, "manual-owner").await?;
    let owner_id = global_id(GlobalIdType::Owner, owner.id);
    for (name, arguments) in [
        (
            "unknown owner",
            json!({"name": "Cash", "ownerId": global_id(GlobalIdType::Owner, 999_999), "type": "DEPOSITORY"}),
        ),
        (
            "unknown connection",
            json!({"name": "Cash", "ownerId": owner_id, "type": "DEPOSITORY", "connectionId": global_id(GlobalIdType::Connection, 999_999)}),
        ),
        (
            "zero connection",
            json!({"name": "Cash", "ownerId": owner_id, "type": "DEPOSITORY", "connectionId": global_id(GlobalIdType::Connection, 0)}),
        ),
    ] {
        assert!(server.create_manual_account(input(arguments)).await.is_err(), "{name}");
        assert!(
            server.resolver.accounts().await?.items.is_empty(),
            "{name}: account created after failed tool call"
        );
    }
    Ok(())
}

fn probe(operation_name: &'static str) -> ToolSpec {
    ToolSpec {
        name: "probe",
        kind: Kind::Query,
        operation_name,
        description: "probe",
        input_schema: input_schema::<NoInput>,
        call: |_, _, _| Box::pin(async { panic!("tool exploded") }),
    }
}

#[tokio::test]
async fn scope_failures_and_panics_become_tool_errors() -> Result<()> {
    let (_, server) = server().await?;
    let text_of =
        |result| serde_json::to_value::<rmcp::model::CallToolResult>(result).unwrap()["content"][0]["text"].clone();

    let denied = server.call(&probe("accounts"), None, json!({})).await;
    assert_eq!(text_of(denied), "forbidden: read:accounts access required");
    let unknown = server.call(&probe("nope"), Some(&all_scopes()), json!({})).await;
    assert_eq!(text_of(unknown), "internal error");
    let panicked = server.call(&probe("accounts"), Some(&all_scopes()), json!({})).await;
    assert_eq!(text_of(panicked), "internal error");

    assert_eq!(operation_scope("Query", "nope").unwrap_err().code, Code::Internal);
    let accounts = operation_scope("Query", "accounts")?;
    assert_eq!(accounts, Scope::ReadAccounts);
    assert!(require_scope(Some(&identity(&[Scope::ReadAccounts])), accounts).is_ok());
    assert_eq!(
        require_scope(None, accounts).unwrap_err().message,
        "forbidden: read:accounts access required"
    );
    Ok(())
}
