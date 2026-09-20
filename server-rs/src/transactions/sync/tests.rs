use std::sync::Arc;

use anyhow::Result;
use chrono::{TimeZone, Utc};
use serde_json::json;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use wiremock::MockServer;
use wiremock::{
    Mock, ResponseTemplate,
    matchers::{method, path},
};

use super::{PlaidSync, SimpleFinSync, Syncer};
use crate::{
    accounts::{
        AccountsCreated, PlaidClientFactory, SourceTable,
        simplefin_types::UpsertSimpleFinConnectionParams,
        store::{create_simple_fin_access_token, link_simple_fin_connection, set_plaid_product_flags, upsert_account},
    },
    clients::simplefin::SimpleFinClient,
    database::dbtest,
    money::Cents,
    testutil::transactions,
    testutil::{
        plaid_mock,
        simplefin_mock::{self, access_url},
        store::{create_owner, linked_account, seed_plaid_item},
    },
    transactions::{
        llm::OllamaCategorizer,
        store::{llm_store, plaid_sync},
    },
};

#[tokio::test]
async fn persists_paginated_plaid_and_simplefin_sync_responses() -> Result<()> {
    let pool = dbtest::open().await?;
    let plaid_server = MockServer::start().await;
    let simplefin_server = MockServer::start().await;
    plaid_mock::mount_accounts(&plaid_server).await;
    plaid_mock::mount_transactions_sync(
        &plaid_server,
        "",
        json!({
            "added":[plaid_transaction("plaid-one")],
            "modified":[],
            "removed":[],
            "next_cursor":"first",
            "has_more":true,
        }),
    )
    .await;
    plaid_mock::mount_transactions_sync(
        &plaid_server,
        "first",
        json!({
            "added":[plaid_transaction("plaid-two")],
            "modified":[],
            "removed":[],
            "next_cursor":"complete",
            "has_more":false,
        }),
    )
    .await;
    let mut simplefin_response = simplefin_mock::full_accounts_response();
    simplefin_response["errlist"][0]["conn_id"] = json!("connection");
    simplefin_mock::mount_accounts(&simplefin_server, simplefin_response).await;

    let owner = create_owner(&pool, "Owner").await?;
    let (item_id, _) = seed_plaid_item(&pool, &owner, "item").await?;
    create_simple_fin_access_token(&pool, &access_url(&simplefin_server), owner.id, "Bank").await?;
    let syncer = Syncer::new(
        pool.clone(),
        vec![
            Box::new(PlaidSync::new(
                pool.clone(),
                PlaidClientFactory::with_base_url(pool.clone(), plaid_server.uri()),
            )),
            Box::new(SimpleFinSync::new(pool.clone(), SimpleFinClient::new()?)),
        ],
    );

    let report = syncer.sync_due().await;

    assert_eq!(report.items.len(), 2);
    assert!(report.items.iter().all(|item| item.error.is_none()));
    assert_eq!(plaid_sync::sync_cursor(&pool, item_id).await?, "complete");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM plaid_sync_log WHERE item_id = ?")
            .bind(item_id)
            .fetch_one(&pool)
            .await?,
        1
    );
    let added = sqlx::query_scalar::<_, String>("SELECT added FROM plaid_sync_log WHERE item_id = ?")
        .bind(item_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(
        serde_json::from_str::<Vec<serde_json::Value>>(&added)?
            .into_iter()
            .map(|transaction| transaction["transaction_id"].as_str().unwrap_or_default().to_owned())
            .collect::<Vec<_>>(),
        ["plaid-one", "plaid-two"]
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM simplefin_sync_log")
            .fetch_one(&pool)
            .await?,
        0
    );
    assert_eq!(
        sqlx::query_as::<_, (String, Option<String>)>(
            "SELECT health_state, health_error_message FROM simplefin_connections WHERE external_id = 'connection'",
        )
        .fetch_one(&pool)
        .await?,
        (
            "SYNC_ERROR".to_owned(),
            Some("provider temporarily unavailable".to_owned())
        )
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transactions")
            .fetch_one(&pool)
            .await?,
        4
    );
    Ok(())
}

#[tokio::test]
async fn simplefin_fetch_failures_record_sanitized_item_errors_and_audit_logs() -> Result<()> {
    let pool = dbtest::open().await?;
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/simplefin/accounts"))
        .respond_with(ResponseTemplate::new(500).set_body_string("provider unavailable"))
        .mount(&server)
        .await;
    let owner = create_owner(&pool, "Owner").await?;
    let token = create_simple_fin_access_token(&pool, &access_url(&server), owner.id, "Bank").await?;
    let (_, connection_id) = link_simple_fin_connection(
        &pool,
        &UpsertSimpleFinConnectionParams {
            external_id: "connection".to_owned(),
            access_token_id: token.id,
            org_id: None,
            org_domain: None,
            org_url: None,
            sfin_url: None,
            logo_url: None,
            name: "Bank".to_owned(),
            owner_id: owner.id,
        },
    )
    .await?;
    let syncer = Arc::new(Syncer::new(
        pool.clone(),
        vec![
            Box::new(PlaidSync::new(pool.clone(), PlaidClientFactory::new(pool.clone()))),
            Box::new(SimpleFinSync::new(pool.clone(), SimpleFinClient::new()?)),
        ],
    ));

    let report = syncer.sync_due().await;

    assert_eq!(report.items.len(), 1);
    assert_eq!(report.items[0].error.as_deref(), Some("sync failed"));
    assert!(
        sqlx::query_scalar::<_, Option<String>>("SELECT error FROM simplefin_sync_log WHERE access_token_id = ?")
            .bind(token.id)
            .fetch_one(&pool)
            .await?
            .is_some()
    );
    let (events, receiver) = mpsc::channel(1);
    events
        .send(AccountsCreated {
            connection_id,
            provider: SourceTable::SimpleFinConnections,
            source_id: connection_id,
        })
        .await?;
    drop(events);
    syncer.run_account_events(receiver, CancellationToken::new()).await;
    Ok(())
}

#[tokio::test]
async fn retries_a_plaid_pagination_mutation_from_the_persisted_cursor() -> Result<()> {
    let pool = dbtest::open().await?;
    let server = MockServer::start().await;
    plaid_mock::mount_accounts(&server).await;
    plaid_mock::mount_transactions_sync(
        &server,
        "",
        json!({
            "added":[plaid_transaction("first")],
            "modified":[],
            "removed":[],
            "next_cursor":"first",
            "has_more":true,
        }),
    )
    .await;
    plaid_mock::mount_transactions_sync_error(&server, "first", "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION").await;
    plaid_mock::mount_transactions_sync(
        &server,
        "first",
        json!({
            "added":[plaid_transaction("second")],
            "modified":[],
            "removed":[],
            "next_cursor":"complete",
            "has_more":false,
        }),
    )
    .await;

    let owner = create_owner(&pool, "Owner").await?;
    let (item_id, _) = seed_plaid_item(&pool, &owner, "item").await?;
    let syncer = Syncer::new(
        pool.clone(),
        vec![
            Box::new(PlaidSync::new(
                pool.clone(),
                PlaidClientFactory::with_base_url(pool.clone(), server.uri()),
            )),
            Box::new(SimpleFinSync::new(pool.clone(), SimpleFinClient::new()?)),
        ],
    );
    syncer
        .set_llm(Some(OllamaCategorizer::new(&pool, "http://localhost", "model").await?))
        .await?;

    syncer.sync_item(item_id).await?;

    assert_eq!(plaid_sync::sync_cursor(&pool, item_id).await?, "complete");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transactions")
            .fetch_one(&pool)
            .await?,
        2
    );
    assert_eq!(llm_store::uncategorized_for_llm(&pool, 10).await?.len(), 2);
    Ok(())
}

#[tokio::test]
async fn syncs_recurring_plaid_streams() -> Result<()> {
    let pool = dbtest::open().await?;
    let server = MockServer::start().await;
    let owner = create_owner(&pool, "Owner").await?;
    let (_, connection) = seed_plaid_item(&pool, &owner, "item").await?;
    let account_id = upsert_account(&pool, &linked_account(&owner, connection.id, "account")).await?;
    let transaction_id = crate::database::queries::insert_transaction(
        &pool,
        crate::database::queries::InsertTransactionParams {
            source: "plaid",
            external_id: "transaction",
            account_id,
            amount_cents: Cents(1299),
            datetime: Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap().into(),
            posted_datetime: Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap().into(),
            merchant_name: Some("Subscription"),
            original_name: None,
            category_id: 0,
            is_reviewed: false,
            is_recurring: false,
            is_hidden: false,
            notes: None,
        },
    )
    .await?
    .id;
    plaid_mock::mount_recurring_streams(
        &server,
        &["account"],
        json!({
            "inflow_streams": [],
            "outflow_streams": [{
                "account_id": "account",
                "stream_id": "stream",
                "description": "Subscription",
                "merchant_name": "Subscription",
                "first_date": "2026-01-01",
                "last_date": "2026-09-01",
                "frequency": "MONTHLY",
                "transaction_ids": ["transaction"],
                "average_amount": {"amount": 12.99},
                "last_amount": {"amount": 12.99},
                "is_active": true,
                "status": "MATURE",
                "is_user_modified": false,
            }],
        }),
    )
    .await;
    let syncer = Syncer::new(
        pool.clone(),
        vec![
            Box::new(PlaidSync::new(
                pool.clone(),
                PlaidClientFactory::with_base_url(pool.clone(), server.uri()),
            )),
            Box::new(SimpleFinSync::new(pool.clone(), SimpleFinClient::new()?)),
        ],
    );

    let report = syncer.sync_recurring_due().await;

    assert_eq!(report.items.len(), 1);
    assert!(report.items[0].error.is_none());
    assert!(
        sqlx::query_scalar::<_, bool>("SELECT is_recurring FROM transactions WHERE id = ?")
            .bind(transaction_id)
            .fetch_one(&pool)
            .await?
    );
    Ok(())
}

#[tokio::test]
async fn syncs_mixed_plaid_investment_items_before_cursor_pages() -> Result<()> {
    let pool = dbtest::open().await?;
    let server = MockServer::start().await;
    plaid_mock::mount(
        &server,
        "/accounts/get",
        json!({"accounts":[
            {"account_id":"checking","name":"Checking","type":"depository","subtype":"checking","mask":"0000"},
            {"account_id":"invest","name":"Brokerage","type":"investment","subtype":"brokerage","mask":"1111"}
        ]}),
    )
    .await;
    plaid_mock::mount_investments_transactions(
        &server,
        json!({
            "securities":[{"security_id":"sec","name":"iShares 0-3 Month Treasury Bond ETF","ticker_symbol":"SGOV"}],
            "investment_transactions":[{
                "investment_transaction_id":"investment",
                "account_id":"invest",
                "security_id":"sec",
                "date":"2026-06-18",
                "name":"BUY",
                "amount":123.45,
                "type":"buy",
                "subtype":"buy"
            }],
            "total_investment_transactions":1
        }),
    )
    .await;
    plaid_mock::mount_transactions_sync(
        &server,
        "",
        json!({
            "added":[
                plaid_transaction_for("regular-checking", "checking"),
                plaid_transaction_for("regular-investment", "invest")
            ],
            "modified":[],
            "removed":[],
            "next_cursor":"complete",
            "has_more":false,
        }),
    )
    .await;
    let owner = create_owner(&pool, "Owner").await?;
    let (item_id, _) = seed_plaid_item(&pool, &owner, "item").await?;
    set_plaid_product_flags(&pool, item_id, true, false).await?;
    let syncer = Syncer::new(
        pool.clone(),
        vec![Box::new(PlaidSync::new(
            pool.clone(),
            PlaidClientFactory::with_base_url(pool.clone(), server.uri()),
        ))],
    );

    let report = syncer.sync_due().await;

    assert_eq!(report.items.len(), 1);
    assert!(report.items[0].error.is_none());
    assert_eq!(plaid_sync::sync_cursor(&pool, item_id).await?, "complete");
    assert_eq!(
        sqlx::query_as::<_, (String, Option<String>, Option<String>)>(
            "SELECT external_id, merchant_name, plaid_category FROM transactions ORDER BY external_id",
        )
        .fetch_all(&pool)
        .await?,
        vec![
            (
                "investment".to_owned(),
                Some("Institution - iShares 0-3 Month Treasury Bond ETF (SGOV)".to_owned()),
                Some("TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS".to_owned()),
            ),
            (
                "regular-checking".to_owned(),
                Some("Coffee Shop".to_owned()),
                Some("FOOD_AND_DRINK:COFFEE".to_owned())
            ),
        ]
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT api FROM plaid_sync_log WHERE item_id = ? ORDER BY id")
            .bind(item_id)
            .fetch_all(&pool)
            .await?,
        ["investments", "transactions"]
    );
    Ok(())
}

#[tokio::test]
async fn syncs_cursorless_plaid_investment_items_without_transaction_sync() -> Result<()> {
    let pool = dbtest::open().await?;
    let server = MockServer::start().await;
    plaid_mock::mount(
        &server,
        "/accounts/get",
        json!({"accounts":[{"account_id":"invest","name":"Brokerage","type":"investment","subtype":"brokerage","mask":"1111"}]}),
    )
    .await;
    plaid_mock::mount_investments_transactions(
        &server,
        json!({
            "securities":[],
            "investment_transactions":[{
                "investment_transaction_id":"investment",
                "account_id":"invest",
                "date":"2026-06-18",
                "name":"Deposit",
                "amount":-100.0,
                "type":"cash",
                "subtype":"deposit"
            }],
            "total_investment_transactions":1
        }),
    )
    .await;
    let owner = create_owner(&pool, "Owner").await?;
    let (item_id, _) = seed_plaid_item(&pool, &owner, "item").await?;
    set_plaid_product_flags(&pool, item_id, true, false).await?;
    let syncer = Syncer::new(
        pool.clone(),
        vec![Box::new(PlaidSync::new(
            pool.clone(),
            PlaidClientFactory::with_base_url(pool.clone(), server.uri()),
        ))],
    );

    let report = syncer.sync_due().await;

    assert_eq!(report.items.len(), 1);
    assert!(report.items[0].error.is_none());
    assert_eq!(plaid_sync::sync_cursor(&pool, item_id).await?, "");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transactions WHERE external_id = 'investment'")
            .fetch_one(&pool)
            .await?,
        1
    );
    assert!(
        crate::accounts::store::plaid_item_secret_by_id(&pool, item_id, crate::accounts::PlaidSyncKind::Sync)
            .await?
            .is_some_and(|item| item.next_sync_at().is_some())
    );
    assert_eq!(
        server
            .received_requests()
            .await
            .unwrap_or_default()
            .iter()
            .filter(|request| request.url.path() == "/transactions/sync")
            .count(),
        0
    );
    Ok(())
}

#[tokio::test]
async fn removes_plaid_investment_transactions_missing_from_the_refetched_window() -> Result<()> {
    let pool = dbtest::open().await?;
    let server = MockServer::start().await;
    let now = Utc::now();
    plaid_mock::mount(
        &server,
        "/accounts/get",
        json!({"accounts":[{"account_id":"invest","name":"Brokerage","type":"investment","subtype":"brokerage","mask":"1111"}]}),
    )
    .await;
    plaid_mock::mount_investments_transactions(
        &server,
        json!({
            "securities":[],
            "investment_transactions":[{
                "investment_transaction_id":"fresh",
                "account_id":"invest",
                "date":now.format("%F").to_string(),
                "name":"CASH DIV",
                "amount":-542.46,
                "type":"fee",
                "subtype":"dividend"
            }],
            "total_investment_transactions":1
        }),
    )
    .await;
    let owner = create_owner(&pool, "Owner").await?;
    let (item_id, connection) = seed_plaid_item(&pool, &owner, "item").await?;
    set_plaid_product_flags(&pool, item_id, true, false).await?;
    let invest = upsert_account(&pool, &linked_account(&owner, connection.id, "invest")).await?;
    let other = upsert_account(&pool, &linked_account(&owner, connection.id, "other")).await?;
    for (external_id, account_id, datetime) in [
        ("stale", invest, now - chrono::Duration::days(3)),
        ("old", invest, now - chrono::Duration::days(40)),
        ("other-account", other, now - chrono::Duration::days(3)),
        ("manual", invest, now - chrono::Duration::days(3)),
    ] {
        transactions::transaction(&pool, external_id, account_id, 0, Cents(100), datetime).await?;
    }
    sqlx::query("UPDATE transactions SET source = 'plaid' WHERE external_id <> 'manual'")
        .execute(&pool)
        .await?;
    let syncer = Syncer::new(
        pool.clone(),
        vec![Box::new(PlaidSync::new(
            pool.clone(),
            PlaidClientFactory::with_base_url(pool.clone(), server.uri()),
        ))],
    );

    let report = syncer.sync_due().await;

    assert_eq!(report.items.len(), 1);
    assert!(report.items[0].error.is_none());
    assert_eq!(report.items[0].removed, 1);
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT external_id FROM transactions ORDER BY external_id")
            .fetch_all(&pool)
            .await?,
        ["fresh", "manual", "old", "other-account"]
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT removed FROM plaid_sync_log WHERE item_id = ? AND api = 'investments'")
            .bind(item_id)
            .fetch_one(&pool)
            .await?,
        r#"["stale"]"#
    );
    Ok(())
}

#[tokio::test]
async fn keeps_plaid_investment_transactions_returned_on_later_pages() -> Result<()> {
    let pool = dbtest::open().await?;
    let server = MockServer::start().await;
    let today = Utc::now().format("%F").to_string();
    plaid_mock::mount(
        &server,
        "/accounts/get",
        json!({"accounts":[{"account_id":"invest","name":"Brokerage","type":"investment","subtype":"brokerage","mask":"1111"}]}),
    )
    .await;
    for (offset, id) in [(0, "first-page"), (1, "second-page")] {
        plaid_mock::mount_investments_transactions_page(
            &server,
            offset,
            json!({
                "securities":[],
                "investment_transactions":[{
                    "investment_transaction_id":id,
                    "account_id":"invest",
                    "date":today,
                    "name":"CASH DIV",
                    "amount":-1.0,
                    "type":"fee",
                    "subtype":"dividend"
                }],
                "total_investment_transactions":2
            }),
        )
        .await;
    }
    let owner = create_owner(&pool, "Owner").await?;
    let (item_id, connection) = seed_plaid_item(&pool, &owner, "item").await?;
    set_plaid_product_flags(&pool, item_id, true, false).await?;
    let invest = upsert_account(&pool, &linked_account(&owner, connection.id, "invest")).await?;
    transactions::transaction(&pool, "second-page", invest, 0, Cents(100), Utc::now()).await?;
    sqlx::query("UPDATE transactions SET source = 'plaid'")
        .execute(&pool)
        .await?;
    let syncer = Syncer::new(
        pool.clone(),
        vec![Box::new(PlaidSync::new(
            pool.clone(),
            PlaidClientFactory::with_base_url(pool.clone(), server.uri()),
        ))],
    );

    let report = syncer.sync_due().await;

    assert!(report.items[0].error.is_none());
    assert_eq!(report.items[0].removed, 0);
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT external_id FROM transactions ORDER BY external_id")
            .fetch_all(&pool)
            .await?,
        ["first-page", "second-page"]
    );
    Ok(())
}

fn plaid_transaction(id: &str) -> serde_json::Value {
    plaid_transaction_for(id, "acc")
}

fn plaid_transaction_for(id: &str, account_id: &str) -> serde_json::Value {
    json!({
        "transaction_id":id,
        "account_id":account_id,
        "amount":12.34,
        "date":"2026-09-06",
        "name":"Coffee",
        "merchant_name":"Coffee Shop",
        "personal_finance_category":{"primary":"FOOD_AND_DRINK","detailed":"COFFEE"},
    })
}

#[tokio::test]
async fn categorizes_staged_transactions_with_ollama() -> Result<()> {
    let pool = dbtest::open().await?;
    let server = MockServer::start().await;
    let category = crate::database::queries::categories_for_llm(&pool)
        .await?
        .into_iter()
        .next()
        .expect("seeded expense category");
    Mock::given(method("POST"))
        .and(path("/api/generate"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "response": format!("[{{\"transaction_index\":1,\"category_id\":{},\"confidence\":\"high\"}}]", category.id),
        })))
        .mount(&server)
        .await;
    let account_id = transactions::account(&pool, "checking").await?;
    let transaction_id = transactions::transaction(
        &pool,
        "Coffee",
        account_id,
        0,
        Cents(500),
        Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
    )
    .await?;
    llm_store::stage_uncategorized(&pool).await?;
    let syncer = Arc::new(Syncer::new(
        pool.clone(),
        vec![
            Box::new(PlaidSync::new(pool.clone(), PlaidClientFactory::new(pool.clone()))),
            Box::new(SimpleFinSync::new(pool.clone(), SimpleFinClient::new()?)),
        ],
    ));
    let cancel = CancellationToken::new();
    let worker = tokio::spawn({
        let syncer = Arc::clone(&syncer);
        let cancel = cancel.clone();
        async move { syncer.run_llm_worker(cancel).await }
    });

    syncer
        .set_llm(Some(OllamaCategorizer::new(&pool, server.uri(), "model").await?))
        .await?;
    for _ in 0..50 {
        let categorized = sqlx::query_scalar::<_, bool>("SELECT is_reviewed FROM transactions WHERE id = ?")
            .bind(transaction_id)
            .fetch_one(&pool)
            .await?;
        if categorized {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    cancel.cancel();
    worker.await?;

    let row = crate::database::queries::synced_transaction_state(
        &pool,
        crate::database::queries::SyncedTransactionStateParams {
            external_id: "Coffee",
            source: "manual",
        },
    )
    .await?;
    assert_eq!(row.category_id, category.id);
    assert!(row.is_reviewed);
    assert_eq!(llm_store::uncategorized_for_llm(&pool, 10).await?.len(), 0);
    Ok(())
}

#[tokio::test]
async fn disabling_llm_clears_staged_transactions() -> Result<()> {
    let pool = dbtest::open().await?;
    let account_id = transactions::account(&pool, "checking").await?;
    transactions::transaction(
        &pool,
        "Coffee",
        account_id,
        0,
        Cents(500),
        Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
    )
    .await?;
    llm_store::stage_uncategorized(&pool).await?;
    let syncer = Syncer::new(
        pool.clone(),
        vec![
            Box::new(PlaidSync::new(pool.clone(), PlaidClientFactory::new(pool.clone()))),
            Box::new(SimpleFinSync::new(pool.clone(), SimpleFinClient::new()?)),
        ],
    );

    syncer
        .set_llm(Some(OllamaCategorizer::new(&pool, "http://localhost", "model").await?))
        .await?;
    syncer.set_llm(None).await?;

    assert!(llm_store::uncategorized_for_llm(&pool, 10).await?.is_empty());
    Ok(())
}
