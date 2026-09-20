use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::Result;
use chrono::{DateTime, TimeZone, Utc};
use tokio_util::sync::CancellationToken;

use super::{DebankSyncAdapter, SimpleFinSyncAdapter};
use crate::{
    accounts::{AccountType, SourceTable, UpsertAccount, store as accounts_store},
    clients::{debank::Debank, simplefin::SimpleFinClient},
    testutil::{
        debank_mock, simplefin_mock,
        store::{create_owner, seed_evm_wallet},
    },
    utils::future::BoxFuture,
    wealth::{ConnectionRef, PersistEvent, PersistSink, SyncAdapter},
};

struct RecordingSink {
    now: DateTime<Utc>,
    events: Mutex<Vec<PersistEvent>>,
}

impl PersistSink for RecordingSink {
    fn now(&self) -> DateTime<Utc> {
        self.now
    }
    fn today(&self) -> &str {
        "2026-09-06"
    }
    fn persist<'a>(&'a self, event: PersistEvent) -> BoxFuture<'a, Result<()>> {
        self.events.lock().unwrap().push(event);
        Box::pin(async { Ok(()) })
    }
}

#[tokio::test]
async fn simplefin_connection_syncs_through_the_http_client() -> Result<()> {
    let pool = crate::database::dbtest::open().await?;
    let owner = create_owner(&pool, "Owner").await?;
    let server = wiremock::MockServer::start().await;
    let access_url = simplefin_mock::access_url(&server);
    simplefin_mock::mount_accounts(
        &server,
        serde_json::json!({
            "accounts":[
                {"id":"simplefin-account","balance":"12.34","currency":"USD"},
                {"id":"simplefin-investment","balance":"5.00","balance-date":1700000000,"currency":"USD","holdings":[
                    {"id":"holding","symbol":"SPAXX","description":"Money market fund","shares":"10","market_value":"10.00","currency":"USD"}
                ]}
            ]
        }),
    )
    .await;
    let token = accounts_store::create_simple_fin_access_token(&pool, &access_url, owner.id, "Bridge").await?;
    let (source_id, connection_id) = accounts_store::link_simple_fin_connection(
        &pool,
        &crate::accounts::simplefin_types::UpsertSimpleFinConnectionParams {
            external_id: "simplefin-connection".to_owned(),
            access_token_id: token.id,
            org_id: None,
            org_domain: None,
            org_url: None,
            sfin_url: None,
            logo_url: None,
            name: "Bridge".to_owned(),
            owner_id: owner.id,
        },
    )
    .await?;
    accounts_store::upsert_account(
        &pool,
        &UpsertAccount {
            external_id: "simplefin-account".to_owned(),
            connection_id: Some(connection_id),
            owner_id: owner.id,
            name: "Checking".to_owned(),
            account_type: AccountType::Depository,
            subtype: None,
            mask: None,
            notes: None,
            closed: false,
            hidden: false,
            needs_review: false,
        },
    )
    .await?;
    accounts_store::upsert_account(
        &pool,
        &UpsertAccount {
            external_id: "simplefin-investment".to_owned(),
            connection_id: Some(connection_id),
            owner_id: owner.id,
            name: "Investment".to_owned(),
            account_type: AccountType::Investment,
            subtype: None,
            mask: None,
            notes: None,
            closed: false,
            hidden: false,
            needs_review: false,
        },
    )
    .await?;
    let adapter = SimpleFinSyncAdapter::with_client(pool, SimpleFinClient::new()?);
    let sink = RecordingSink {
        now: Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
        events: Mutex::new(Vec::new()),
    };

    adapter
        .sync_connection_into(
            ConnectionRef {
                connection_id,
                source_table: SourceTable::SimpleFinConnections,
                source_id,
            },
            &sink,
        )
        .await?;
    let events = sink.events.lock().unwrap();
    assert_eq!(events.len(), 2);
    let PersistEvent::Snapshot(investment) = &events[1] else {
        panic!("expected investment snapshot")
    };
    assert_eq!(investment.snapshot.balance_usd.0, 1000);
    assert_eq!(investment.snapshot.holdings.len(), 1);
    assert!(
        investment
            .snapshot
            .raw_payload
            .as_deref()
            .is_some_and(|raw| raw.contains("simplefin-investment"))
    );
    assert_eq!(
        investment.snapshot.holdings[0]
            .asset
            .as_ref()
            .and_then(|asset| asset.last_price_at),
        Utc.timestamp_opt(1_700_000_000, 0).single(),
    );
    Ok(())
}

#[tokio::test]
async fn simplefin_due_sync_continues_after_an_invalid_token_and_accepts_partial_responses() -> Result<()> {
    let pool = crate::database::dbtest::open().await?;
    let owner = create_owner(&pool, "Owner").await?;
    let server = wiremock::MockServer::start().await;
    let access_url = simplefin_mock::access_url(&server);
    simplefin_mock::mount_accounts(
        &server,
        serde_json::json!({
            "errlist":[{"conn_id":"unavailable","message":"temporarily unavailable"}],
            "accounts":[{"id":"simplefin-account","balance":"12.34","currency":"USD"}]
        }),
    )
    .await;
    accounts_store::create_simple_fin_access_token(&pool, "not an access url", owner.id, "Broken").await?;
    let token = accounts_store::create_simple_fin_access_token(&pool, &access_url, owner.id, "Bridge").await?;
    let (_, connection_id) = accounts_store::link_simple_fin_connection(
        &pool,
        &crate::accounts::simplefin_types::UpsertSimpleFinConnectionParams {
            external_id: "simplefin-connection".to_owned(),
            access_token_id: token.id,
            org_id: None,
            org_domain: None,
            org_url: None,
            sfin_url: None,
            logo_url: None,
            name: "Bridge".to_owned(),
            owner_id: owner.id,
        },
    )
    .await?;
    accounts_store::upsert_account(
        &pool,
        &UpsertAccount {
            external_id: "simplefin-account".to_owned(),
            connection_id: Some(connection_id),
            owner_id: owner.id,
            name: "Checking".to_owned(),
            account_type: AccountType::Depository,
            subtype: None,
            mask: None,
            notes: None,
            closed: false,
            hidden: false,
            needs_review: false,
        },
    )
    .await?;
    let now = Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap();
    let sink = Arc::new(RecordingSink {
        now,
        events: Mutex::new(Vec::new()),
    });
    let adapter = SimpleFinSyncAdapter::with_client(pool.clone(), SimpleFinClient::new()?);

    adapter.sync_due(sink.clone()).await?;

    assert_eq!(sink.events.lock().unwrap().len(), 1);
    assert_eq!(
        accounts_store::simple_fin_token_secrets_due(&pool, crate::accounts::SimpleFinTokenSecretKind::Balance, now)
            .await?
            .len(),
        1
    );
    Ok(())
}

#[tokio::test]
async fn debank_wallet_syncs_selected_chain_balances_through_the_http_client() -> Result<()> {
    let pool = crate::database::dbtest::open().await?;
    let owner = create_owner(&pool, "Owner").await?;
    let (connection, _) = seed_evm_wallet(&pool, &owner, "0x1111111111111111111111111111111111111111").await?;
    let server = wiremock::MockServer::start().await;
    debank_mock::mount_wallet(
        &server,
        serde_json::json!([
            {"id":"0xtoken","symbol":"USDC","name":"USD Coin","amount":2.0,"price":1.0,"usd_value":2.0}
        ]),
        serde_json::json!([{
            "id":"project",
            "name":"Project",
            "portfolio_item_list":[{
                "pool":{"id":"pool","chain":"eth"},
                "detail":{"description":"USDC"},
                "stats":{"net_usd_value":3.0}
            }]
        }]),
    )
    .await;
    debank_mock::mount(
        &server,
        "/token",
        serde_json::json!({"id":"pool","chain":"eth","symbol":"USDC","name":"USD Coin","price":1.0}),
    )
    .await;
    let adapter = DebankSyncAdapter::with_client(pool, Debank::with_base_url(server.uri())?);
    let sink = RecordingSink {
        now: Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
        events: Mutex::new(Vec::new()),
    };

    adapter
        .sync_connection_into(
            ConnectionRef {
                connection_id: connection.connection.id,
                source_table: SourceTable::EvmWallets,
                source_id: connection.source_id,
            },
            &sink,
        )
        .await?;
    let events = sink.events.lock().unwrap();
    let PersistEvent::Snapshot(snapshot) = &events[0] else {
        panic!("expected snapshot")
    };
    assert_eq!(snapshot.snapshot.holdings.len(), 2);
    let project = snapshot
        .snapshot
        .holdings
        .iter()
        .find(|holding| holding.line_type == "PROJECT_TOKEN")
        .expect("project holding");
    assert_eq!(project.token_symbol.as_deref(), Some("USDC"));
    assert_eq!(project.token_name.as_deref(), Some("USD Coin"));
    assert_eq!(project.price, Some(1.0));
    assert!(
        snapshot
            .snapshot
            .raw_payload
            .as_deref()
            .is_some_and(|raw| raw.contains("projects"))
    );
    Ok(())
}

#[tokio::test]
async fn debank_due_sync_limits_in_flight_wallet_requests() -> Result<()> {
    let pool = crate::database::dbtest::open().await?;
    let owner = create_owner(&pool, "Owner").await?;
    for index in 1..=5 {
        let (connection, _) = seed_evm_wallet(&pool, &owner, &format!("0x{index:040x}")).await?;
        accounts_store::set_evm_wallet_balance_synced(
            &pool,
            connection.source_id,
            Utc.with_ymd_and_hms(2020, 1, 1, 0, 0, 0).unwrap(),
        )
        .await?;
    }
    let server = wiremock::MockServer::start().await;
    debank_mock::mount_delayed(
        &server,
        "/token/balance_list",
        serde_json::json!([]),
        Duration::from_secs(7),
    )
    .await;
    debank_mock::mount(&server, "/portfolio/project_list", serde_json::json!([])).await;
    let cancellation = CancellationToken::new();
    let adapter = DebankSyncAdapter::with_client_and_cancellation(
        pool,
        Debank::with_base_url(server.uri())?,
        cancellation.clone(),
    );
    let sink: Arc<dyn PersistSink> = Arc::new(RecordingSink {
        now: Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
        events: Mutex::new(Vec::new()),
    });
    let sync = tokio::spawn(async move { adapter.sync_due(sink).await });

    tokio::time::sleep(Duration::from_millis(6500)).await;
    let requests = server.received_requests().await.unwrap_or_default();
    let balance_requests = requests
        .iter()
        .filter(|request| request.url.path() == "/token/balance_list")
        .count();
    assert_eq!(balance_requests, 4);

    cancellation.cancel();
    sync.await??;
    Ok(())
}
