use std::sync::Arc;

use anyhow::{Context, Result, anyhow};
use sqlx::SqlitePool;

use crate::{
    accounts::{
        AccountType, PlaidClientFactory, PlaidItemSecret, PlaidSyncKind, SourceTable, store as accounts_store,
        type_from_plaid,
    },
    clients::plaid::AccountBase,
    money::Cents,
    utils::future::BoxFuture,
    wealth::{
        AccountBalanceSnapshot, AssetDailyHolding, ConnectionRef, LastUnflaggedBalanceResult, PersistEvent,
        PersistSink, SnapshotDecision, SnapshotDraft, SyncAdapter, SyncerId, YahooPriceProvider,
        next_balance_sync_after, store,
    },
};

pub struct PlaidSyncAdapter {
    pub(super) pool: SqlitePool,
    pub(super) clients: PlaidClientFactory,
    pub(super) prices: YahooPriceProvider,
}

impl PlaidSyncAdapter {
    pub fn new(pool: SqlitePool, clients: PlaidClientFactory) -> Result<Self> {
        Ok(Self::with_prices(pool.clone(), clients, YahooPriceProvider::new(pool)?))
    }

    pub fn with_prices(pool: SqlitePool, clients: PlaidClientFactory, prices: YahooPriceProvider) -> Self {
        Self { pool, clients, prices }
    }

    async fn sync_item(&self, item: &PlaidItemSecret, sink: &dyn PersistSink) -> Result<()> {
        let cron = store::balance_sync_schedule_cron(&self.pool, self.source())
            .await?
            .ok_or_else(|| anyhow!("balance sync schedule {} not found", self.source()))?;
        let next_sync_at = next_balance_sync_after(&cron, sink.now())?;
        let client = self
            .clients
            .client_for_credential(item.plaid_items.credential_id)
            .await?;
        let accounts = client
            .accounts_balance_get(&item.plaid_items.access_token)
            .await
            .context("accounts balance get")?;
        let has_investments = accounts
            .iter()
            .any(|account| type_from_plaid(&account.account_type) == AccountType::Investment);
        if has_investments {
            match client.investments_holdings_get(&item.plaid_items.access_token).await {
                Ok(response) => self.sync_investments(&response, &accounts, sink).await?,
                Err(error) => tracing::error!(item_id = item.plaid_items.id, %error, "investments holdings get failed"),
            }
        }
        self.sync_cash_accounts(&accounts, sink).await?;
        accounts_store::set_item_balance_synced(&self.pool, item.plaid_items.id, next_sync_at).await
    }

    async fn sync_cash_accounts(&self, accounts: &[AccountBase], sink: &dyn PersistSink) -> Result<()> {
        let usd = store::asset_by_id(&self.pool, 1)
            .await?
            .ok_or_else(|| anyhow!("USD asset not found"))?;
        for account in accounts
            .iter()
            .filter(|account| type_from_plaid(&account.account_type) != AccountType::Investment)
            .filter_map(|account| account.balances.current.map(|balance| (account, balance)))
        {
            let (account, balance) = account;
            let account_id = accounts_store::account_by_external_id(&self.pool, &account.account_id)
                .await?
                .ok_or_else(|| anyhow!("lookup account {}: not found", account.account_id))?
                .id;
            let snapshot = AccountBalanceSnapshot {
                account_id,
                wallet_address: String::new(),
                source: self.source().to_string(),
                date: sink.today().to_owned(),
                synced_at: sink.now().to_rfc3339(),
                balance_usd: Cents::from_dollars(balance),
                raw_payload: None,
                holdings: vec![AssetDailyHolding {
                    asset_id: usd.id,
                    asset: None,
                    adapter_source: None,
                    adapter_sources: Vec::new(),
                    price_update: None,
                    quantity: Some(balance),
                    price: Some(1.0),
                    value_usd: balance,
                    counts_toward_value: true,
                    manual: false,
                    line_type: String::new(),
                    chain_id: String::new(),
                    project_name: None,
                    token_id: String::new(),
                    identifier: usd.identifier.clone(),
                    token_symbol: None,
                    token_name: None,
                    provider_price: None,
                }],
                flagged: false,
                flag_reason: String::new(),
            };
            sink.persist(PersistEvent::Snapshot(Box::new(SnapshotDraft {
                snapshot,
                decision: SnapshotDecision::Clean,
                anchor: empty_anchor(),
                review: None,
                provider_state: None,
                carry_usd: Default::default(),
            })))
            .await?;
        }
        Ok(())
    }
}

impl SyncAdapter for PlaidSyncAdapter {
    fn source(&self) -> SyncerId {
        SyncerId::Plaid
    }

    fn handles(&self, connection: &ConnectionRef) -> bool {
        connection.source_table == SourceTable::PlaidItems
    }

    fn sync_due<'a>(&'a self, sink: Arc<dyn PersistSink>) -> BoxFuture<'a, Result<()>> {
        Box::pin(async move {
            for item in accounts_store::plaid_items_due(&self.pool, PlaidSyncKind::Balance, sink.now()).await? {
                if let Err(error) = self.sync_item(&item, sink.as_ref()).await {
                    tracing::error!(item_id = item.plaid_items.id, %error, "plaid balance sync item failed");
                }
            }
            Ok(())
        })
    }

    fn sync_connection_into<'a>(
        &'a self,
        connection: ConnectionRef,
        sink: &'a dyn PersistSink,
    ) -> BoxFuture<'a, Result<()>> {
        Box::pin(async move {
            let item =
                accounts_store::plaid_item_secret_by_id(&self.pool, connection.source_id, PlaidSyncKind::Balance)
                    .await?
                    .ok_or_else(|| anyhow!("plaid item {} not found", connection.source_id))?;
            self.sync_item(&item, sink).await
        })
    }
}

pub(super) fn empty_anchor() -> LastUnflaggedBalanceResult {
    LastUnflaggedBalanceResult {
        found: false,
        amount_usd: Default::default(),
        date: String::new(),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use anyhow::Result;
    use chrono::{DateTime, TimeZone, Utc};

    use super::{PersistEvent, PersistSink, PlaidSyncAdapter, SyncAdapter};
    use crate::{
        accounts::{PlaidClientFactory, PlaidSyncKind, SourceTable, store as accounts_store},
        clients::plaid::{AccountBalance, AccountBase},
        database::{dbtest, queries},
        testutil::store::{create_owner, seed_plaid_account, seed_plaid_item},
        utils::future::BoxFuture,
        wealth::{ConnectionRef, SnapshotDecision},
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
    async fn emits_unflagged_usd_snapshots_for_persisted_cash_accounts() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "Owner").await?;
        let (_, connection) = seed_plaid_item(&pool, &owner, "item").await?;
        let account_id = seed_plaid_account(&pool, &owner, &connection, "cash").await?;
        let adapter = PlaidSyncAdapter::new(pool.clone(), PlaidClientFactory::new(pool))?;
        let sink = RecordingSink {
            now: Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
            events: Mutex::new(Vec::new()),
        };

        adapter
            .sync_cash_accounts(
                &[AccountBase {
                    account_id: "cash".to_owned(),
                    account_type: "depository".to_owned(),
                    balances: AccountBalance {
                        current: Some(12.34),
                        ..Default::default()
                    },
                    ..Default::default()
                }],
                &sink,
            )
            .await?;
        assert!(adapter.handles(&ConnectionRef {
            connection_id: connection.id,
            source_table: SourceTable::PlaidItems,
            source_id: 1
        }));
        let events = sink.events.lock().unwrap();
        let PersistEvent::Snapshot(snapshot) = &events[0] else {
            panic!("expected snapshot")
        };
        assert_eq!(snapshot.snapshot.account_id, account_id);
        assert_eq!(snapshot.snapshot.balance_usd.0, 1234);
        assert_eq!(snapshot.decision, SnapshotDecision::Clean);
        Ok(())
    }

    #[tokio::test]
    async fn syncs_a_linked_item_through_the_real_plaid_client() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "Owner").await?;
        let (item_id, connection) = seed_plaid_item(&pool, &owner, "item").await?;
        seed_plaid_account(&pool, &owner, &connection, "cash").await?;
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("POST"))
            .and(wiremock::matchers::path("/accounts/balance/get"))
            .and(wiremock::matchers::body_json(serde_json::json!({
                "access_token":"token", "client_id":"client", "secret":"secret"
            })))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(
                serde_json::json!({"accounts":[{"account_id":"cash","type":"depository","balances":{"current":12.34}}]}),
            ))
            .mount(&server)
            .await;
        let adapter = PlaidSyncAdapter::new(pool.clone(), PlaidClientFactory::with_base_url(pool, server.uri()))?;
        let sink = RecordingSink {
            now: Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
            events: Mutex::new(Vec::new()),
        };

        adapter
            .sync_connection_into(
                ConnectionRef {
                    connection_id: connection.id,
                    source_table: SourceTable::PlaidItems,
                    source_id: item_id,
                },
                &sink,
            )
            .await?;
        assert_eq!(sink.events.lock().unwrap().len(), 1);
        Ok(())
    }

    #[tokio::test]
    async fn due_sync_continues_after_a_failed_item_and_advances_the_successful_item() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "Owner").await?;
        let (good_item_id, connection) = seed_plaid_item(&pool, &owner, "good").await?;
        seed_plaid_account(&pool, &owner, &connection, "cash").await?;
        let credential_id = sqlx::query_scalar::<_, i64>("SELECT credential_id FROM plaid_items WHERE id = ?")
            .bind(good_item_id)
            .fetch_one(&pool)
            .await?;
        let bad_item_id = queries::upsert_plaid_item(
            &pool,
            queries::UpsertPlaidItemParams {
                external_id: "bad",
                credential_id,
                access_token: "bad",
                institution_id: Some("ins"),
                logo_url: None,
                next_sync_at: None,
                next_recurring_sync_at: None,
                next_balance_sync_at: None,
                plaid_investments_enabled: false,
                plaid_liabilities_enabled: false,
            },
        )
        .await?
        .id;
        accounts_store::create_connection(&pool, bad_item_id, Some("Broken"), owner.id).await?;
        assert_eq!(
            accounts_store::plaid_item_secret_by_id(&pool, bad_item_id, PlaidSyncKind::Balance)
                .await?
                .unwrap()
                .plaid_items
                .access_token,
            "bad"
        );
        let server = wiremock::MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::method("POST"))
            .and(wiremock::matchers::path("/accounts/balance/get"))
            .and(wiremock::matchers::body_json(serde_json::json!({
                "access_token":"token", "client_id":"client", "secret":"secret"
            })))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(
                serde_json::json!({"accounts":[{"account_id":"cash","type":"depository","balances":{"current":12.34}}]}),
            ))
            .mount(&server)
            .await;
        wiremock::Mock::given(wiremock::matchers::method("POST"))
            .and(wiremock::matchers::path("/accounts/balance/get"))
            .and(wiremock::matchers::body_json(serde_json::json!({
                "access_token":"bad", "client_id":"client", "secret":"secret"
            })))
            .respond_with(wiremock::ResponseTemplate::new(500).set_body_string("failed"))
            .mount(&server)
            .await;
        let now = Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap();
        let sink = Arc::new(RecordingSink {
            now,
            events: Mutex::new(Vec::new()),
        });
        let adapter = PlaidSyncAdapter::new(
            pool.clone(),
            PlaidClientFactory::with_base_url(pool.clone(), server.uri()),
        )?;

        adapter.sync_due(sink.clone()).await?;

        assert_eq!(sink.events.lock().unwrap().len(), 1);
        assert_eq!(
            accounts_store::plaid_items_due(&pool, PlaidSyncKind::Balance, now)
                .await?
                .len(),
            1
        );
        assert!(!adapter.handles(&ConnectionRef {
            connection_id: connection.id,
            source_table: SourceTable::EvmWallets,
            source_id: good_item_id,
        }));
        Ok(())
    }
}
