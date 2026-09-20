use std::sync::Arc;

use anyhow::Result;
use sqlx::SqlitePool;

use crate::{
    money::Cents,
    schema::AssetType,
    utils::future::BoxFuture,
    wealth::{
        AccountBalanceSnapshot, AssetDailyHolding, ConnectionRef, LastUnflaggedBalanceResult, PersistEvent,
        PersistSink, SnapshotDecision, SnapshotDraft, SyncAdapter, SyncerId, YahooPriceProvider,
        run_scheduled_balance_sync, store,
    },
};

pub struct ManualSyncAdapter {
    pool: SqlitePool,
    prices: YahooPriceProvider,
}

impl ManualSyncAdapter {
    pub fn new(pool: SqlitePool) -> Result<Self> {
        Ok(Self::with_prices(pool.clone(), YahooPriceProvider::new(pool)?))
    }

    pub fn with_prices(pool: SqlitePool, prices: YahooPriceProvider) -> Self {
        Self { pool, prices }
    }

    pub async fn seed_initial_snapshot(&self, account_id: i64, sink: &dyn PersistSink) -> Result<()> {
        sink.persist(PersistEvent::Snapshot(Box::new(SnapshotDraft {
            snapshot: AccountBalanceSnapshot {
                account_id,
                wallet_address: String::new(),
                source: self.source().to_string(),
                date: sink.today().to_owned(),
                synced_at: sink.now().to_rfc3339(),
                balance_usd: Default::default(),
                raw_payload: None,
                holdings: Vec::new(),
                flagged: false,
                flag_reason: String::new(),
            },
            decision: SnapshotDecision::Clean,
            anchor: empty_anchor(),
            review: None,
            provider_state: None,
            carry_usd: Default::default(),
        })))
        .await
    }

    async fn emit_all(&self, sink: &dyn PersistSink) -> Result<()> {
        for account_id in store::manual_snapshot_account_ids(&self.pool).await? {
            let draft = match self.snapshot_draft(account_id, sink.today(), sink.now()).await {
                Ok(draft) => draft,
                Err(error) => {
                    tracing::error!(account_id, %error, "snapshot manual account failed");
                    continue;
                }
            };
            if let Some(draft) = draft {
                sink.persist(PersistEvent::Snapshot(Box::new(draft))).await?;
            }
        }
        Ok(())
    }

    async fn snapshot_draft(
        &self,
        account_id: i64,
        date: &str,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<Option<SnapshotDraft>> {
        let Some(latest) = store::latest_snapshot_for_account(&self.pool, account_id).await? else {
            return Ok(None);
        };
        let holdings = store::snapshot_holdings_by_snapshot_id(&self.pool, latest.id).await?;
        let mut carried_holdings = Vec::with_capacity(holdings.len());
        for holding in holdings {
            let price = self.resolve_price(&holding.asset, now).await;
            let price = (price > 0.0).then_some(price).or(holding.price);
            let value_usd = holding
                .quantity
                .zip(price)
                .map_or(holding.value_usd.dollars(), |(quantity, price)| quantity * price);
            carried_holdings.push(AssetDailyHolding {
                asset_id: holding.asset.id,
                asset: None,
                adapter_source: None,
                adapter_sources: Vec::new(),
                price_update: None,
                quantity: holding.quantity,
                price,
                value_usd,
                counts_toward_value: holding.counts_toward_value,
                manual: holding.manual,
                line_type: String::new(),
                chain_id: String::new(),
                project_name: None,
                token_id: String::new(),
                identifier: holding.asset.identifier,
                token_symbol: None,
                token_name: None,
                provider_price: None,
            });
        }
        let balance_usd = if carried_holdings.is_empty() {
            latest.balance_usd
        } else {
            Cents::from_dollars(
                carried_holdings
                    .iter()
                    .filter(|holding| holding.counts_toward_value)
                    .map(|holding| holding.value_usd)
                    .sum(),
            )
        };
        Ok(Some(SnapshotDraft {
            snapshot: AccountBalanceSnapshot {
                account_id,
                wallet_address: String::new(),
                source: latest.source,
                date: date.to_owned(),
                synced_at: now.to_rfc3339(),
                balance_usd,
                raw_payload: None,
                holdings: carried_holdings,
                flagged: false,
                flag_reason: String::new(),
            },
            decision: SnapshotDecision::Clean,
            anchor: empty_anchor(),
            review: None,
            provider_state: None,
            carry_usd: Default::default(),
        }))
    }

    async fn resolve_price(&self, asset: &crate::wealth::Asset, now: chrono::DateTime<chrono::Utc>) -> f64 {
        if let Some(price) = asset.forced_usd_price {
            return price;
        }
        if asset.asset_type == AssetType::Security
            && let Ok(price) = self.prices.price_at(asset, now).await
            && price > 0.0
        {
            return price;
        }
        asset.current_price.unwrap_or_default()
    }
}

impl SyncAdapter for ManualSyncAdapter {
    fn source(&self) -> SyncerId {
        SyncerId::Manual
    }

    fn handles(&self, _: &ConnectionRef) -> bool {
        false
    }

    fn sync_due<'a>(&'a self, sink: Arc<dyn PersistSink>) -> BoxFuture<'a, Result<()>> {
        Box::pin(async move {
            run_scheduled_balance_sync(&self.pool, self.source(), sink.now(), || self.emit_all(sink.as_ref()))
                .await
                .map(|_| ())
        })
    }

    fn sync_connection_into<'a>(&'a self, _: ConnectionRef, _: &'a dyn PersistSink) -> BoxFuture<'a, Result<()>> {
        Box::pin(async { Ok(()) })
    }
}

fn empty_anchor() -> LastUnflaggedBalanceResult {
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

    use super::*;
    use crate::{
        accounts::{AccountType, CreateManualAccount},
        clients::yahoo::Yahoo,
        database::dbtest,
        money::Cents,
        testutil::store::create_owner,
        utils::future::BoxFuture,
        wealth::store,
    };
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path_regex},
    };

    struct RecordingSink {
        now: DateTime<Utc>,
        events: Mutex<Vec<PersistEvent>>,
    }

    struct FailingSink {
        now: DateTime<Utc>,
    }

    impl PersistSink for FailingSink {
        fn now(&self) -> DateTime<Utc> {
            self.now
        }

        fn today(&self) -> &str {
            "2026-09-06"
        }

        fn persist<'a>(&'a self, _: PersistEvent) -> BoxFuture<'a, Result<()>> {
            Box::pin(async { Err(anyhow::anyhow!("persist failed")) })
        }
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
    async fn seeds_and_carries_manual_snapshots_without_handling_connections() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "Owner").await?;
        let account = crate::accounts::store::create_manual_account(
            &pool,
            CreateManualAccount {
                connection_id: None,
                name: "Cash".to_owned(),
                owner_id: owner.id,
                account_type: AccountType::Depository,
                notes: None,
                closed: None,
                hidden: None,
            },
        )
        .await?;
        let sink = RecordingSink {
            now: Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
            events: Mutex::new(Vec::new()),
        };
        let adapter = ManualSyncAdapter::new(pool.clone()).unwrap();

        adapter.seed_initial_snapshot(account.id, &sink).await?;
        assert!(!adapter.handles(&crate::wealth::ConnectionRef {
            connection_id: 1,
            source_table: crate::accounts::SourceTable::Assets,
            source_id: 1
        }));
        {
            let events = sink.events.lock().unwrap();
            let PersistEvent::Snapshot(snapshot) = &events[0] else {
                panic!("expected snapshot")
            };
            assert_eq!(snapshot.decision, SnapshotDecision::Clean);
            assert_eq!(snapshot.snapshot.balance_usd, Cents::default());
        }
        store::replace_account_balance_snapshot(
            &pool,
            AccountBalanceSnapshot {
                account_id: account.id,
                wallet_address: String::new(),
                source: "legacy".to_owned(),
                date: "2026-09-05".to_owned(),
                synced_at: "2026-09-05T12:00:00Z".to_owned(),
                balance_usd: Cents(500),
                raw_payload: None,
                holdings: vec![AssetDailyHolding {
                    asset_id: 1,
                    asset: None,
                    adapter_source: None,
                    adapter_sources: Vec::new(),
                    price_update: None,
                    quantity: Some(2.0),
                    price: Some(1.0),
                    value_usd: 2.0,
                    counts_toward_value: true,
                    manual: true,
                    line_type: String::new(),
                    chain_id: String::new(),
                    project_name: None,
                    token_id: String::new(),
                    identifier: "USD".to_owned(),
                    token_symbol: None,
                    token_name: None,
                    provider_price: None,
                }],
                flagged: false,
                flag_reason: String::new(),
            },
        )
        .await?;
        let draft = adapter
            .snapshot_draft(account.id, sink.today(), sink.now())
            .await?
            .expect("manual snapshot draft");
        sink.persist(PersistEvent::Snapshot(Box::new(draft))).await?;
        assert_eq!(sink.events.lock().unwrap().len(), 2);
        {
            let events = sink.events.lock().unwrap();
            let PersistEvent::Snapshot(snapshot) = &events[1] else {
                panic!("expected snapshot")
            };
            assert_eq!(snapshot.snapshot.source, "legacy");
            assert_eq!(snapshot.snapshot.balance_usd, Cents(200));
            assert_eq!(snapshot.snapshot.holdings[0].price, Some(1.0));
        }
        let mut asset = store::asset_by_id(&pool, 1).await?.unwrap();
        asset.forced_usd_price = Some(4.0);
        assert_eq!(adapter.resolve_price(&asset, sink.now()).await, 4.0);
        asset.forced_usd_price = None;
        asset.current_price = Some(3.0);
        assert_eq!(adapter.resolve_price(&asset, sink.now()).await, 3.0);
        adapter
            .sync_connection_into(
                crate::wealth::ConnectionRef {
                    connection_id: 1,
                    source_table: crate::accounts::SourceTable::Assets,
                    source_id: 1,
                },
                &sink,
            )
            .await?;
        sqlx::query(
            "UPDATE balance_sync_schedules SET next_balance_sync_at = '2026-09-05T00:00:00Z' WHERE id = 'manual'",
        )
        .execute(&pool)
        .await?;
        let failing_sink: Arc<dyn PersistSink> = Arc::new(FailingSink { now: sink.now });
        assert!(adapter.sync_due(failing_sink).await.is_err());
        assert!(
            store::balance_sync_schedule_due(&pool, crate::wealth::SyncerId::Manual, sink.now)
                .await?
                .is_some()
        );
        Ok(())
    }

    #[tokio::test]
    async fn carries_stored_values_when_manual_prices_or_quantities_are_unavailable() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "Owner").await?;
        let account = crate::testutil::store::seed_manual_account(&pool, &owner, "Manual").await?;
        let asset_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO assets (asset_type, identifier, classifier, price_connectivity) VALUES ('CRYPTO', 'manual:asset', 'CRYPTOCURRENCY', 'IGNORE') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        let adapter = ManualSyncAdapter::new(pool.clone())?;
        let now = Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap();

        for (quantity, price, value_usd) in [(Some(3.0), Some(7.0), 21.0), (None, Some(50.0), 100.0)] {
            store::replace_account_balance_snapshot(
                &pool,
                AccountBalanceSnapshot {
                    account_id: account.id,
                    wallet_address: String::new(),
                    source: SyncerId::Manual.to_string(),
                    date: "2026-09-05".to_owned(),
                    synced_at: "2026-09-05T12:00:00Z".to_owned(),
                    balance_usd: Cents::from_dollars(value_usd),
                    raw_payload: None,
                    holdings: vec![AssetDailyHolding {
                        asset_id,
                        asset: None,
                        adapter_source: None,
                        adapter_sources: Vec::new(),
                        price_update: None,
                        quantity,
                        price,
                        value_usd,
                        counts_toward_value: true,
                        manual: true,
                        line_type: String::new(),
                        chain_id: String::new(),
                        project_name: None,
                        token_id: String::new(),
                        identifier: "manual:asset".to_owned(),
                        token_symbol: None,
                        token_name: None,
                        provider_price: None,
                    }],
                    flagged: false,
                    flag_reason: String::new(),
                },
            )
            .await?;
            let draft = adapter.snapshot_draft(account.id, "2026-09-06", now).await?.unwrap();
            assert_eq!(draft.snapshot.holdings[0].price, price);
            assert_eq!(draft.snapshot.holdings[0].value_usd, value_usd);
            assert_eq!(draft.snapshot.balance_usd, Cents::from_dollars(value_usd));
        }
        Ok(())
    }

    #[tokio::test]
    async fn sync_due_carries_flat_manual_balances_and_advances_only_due_schedules() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "Owner").await?;
        let account = crate::testutil::store::seed_manual_account(&pool, &owner, "Loan").await?;
        store::replace_account_balance_snapshot(
            &pool,
            AccountBalanceSnapshot {
                account_id: account.id,
                wallet_address: String::new(),
                source: SyncerId::Manual.to_string(),
                date: "2026-09-05".to_owned(),
                synced_at: "2026-09-05T12:00:00Z".to_owned(),
                balance_usd: Cents(-500),
                raw_payload: None,
                holdings: Vec::new(),
                flagged: false,
                flag_reason: String::new(),
            },
        )
        .await?;
        sqlx::query(
            "UPDATE balance_sync_schedules SET balance_sync_cron = '0 9 * * *', next_balance_sync_at = '2026-09-06T00:00:00Z' WHERE id = 'manual'",
        )
        .execute(&pool)
        .await?;
        let sink = Arc::new(RecordingSink {
            now: Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
            events: Mutex::new(Vec::new()),
        });
        let adapter = ManualSyncAdapter::new(pool.clone())?;

        adapter.sync_due(sink.clone()).await?;

        let schedule = store::balance_sync_schedule_due(&pool, SyncerId::Manual, sink.now()).await?;
        assert!(schedule.is_none());
        let events = sink.events.lock().unwrap();
        let snapshot = match &events[0] {
            PersistEvent::Snapshot(snapshot) => snapshot,
            PersistEvent::Asset(_) => panic!("expected snapshot"),
        };
        assert_eq!(snapshot.snapshot.balance_usd, Cents(-500));
        assert!(snapshot.snapshot.holdings.is_empty());
        Ok(())
    }

    #[tokio::test]
    async fn resolves_live_security_prices_and_falls_back_when_the_provider_returns_zero() -> Result<()> {
        let pool = dbtest::open().await?;
        let asset_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO assets (asset_type, identifier, classifier, last_price) VALUES ('SECURITY', 'VTI', 'PUBLIC', 50) RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        let asset = store::asset_by_id(&pool, asset_id).await?.unwrap();
        let now = Utc::now();

        for (provider_price, expected) in [(7, 7.0), (0, 50.0)] {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path_regex("/v8/finance/chart/.*"))
                .respond_with(ResponseTemplate::new(200).set_body_string(format!(
                    r#"{{"chart":{{"result":[{{"meta":{{"regularMarketPrice":{provider_price},"regularMarketTime":1788696000}}}}]}}}}"#
                )))
                .mount(&server)
                .await;
            let adapter = ManualSyncAdapter::with_prices(
                pool.clone(),
                YahooPriceProvider::with_client(pool.clone(), Yahoo::with_base_url(server.uri())?),
            );
            assert_eq!(adapter.resolve_price(&asset, now).await, expected);
        }
        Ok(())
    }
}
