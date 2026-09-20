use std::sync::Arc;

use anyhow::{Context, Result, anyhow};
use sqlx::SqlitePool;

use crate::{
    accounts::SourceTable,
    utils::future::BoxFuture,
    wealth::{
        ConnectionRef, LastUnflaggedBalanceResult, PersistEvent, PersistSink, RealEstate, SnapshotDecision,
        SnapshotDraft, SyncAdapter, SyncerId, new_real_estate_snapshot, run_scheduled_balance_sync, store,
    },
};

pub struct RealEstateSyncAdapter {
    pool: SqlitePool,
}

impl RealEstateSyncAdapter {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn emit_snapshot(&self, real_estate: RealEstate, sink: &dyn PersistSink) -> Result<()> {
        let Some(draft) = self.snapshot_draft(real_estate, sink.today(), sink.now()).await? else {
            return Ok(());
        };
        sink.persist(PersistEvent::Snapshot(Box::new(draft))).await
    }

    async fn snapshot_draft(
        &self,
        real_estate: RealEstate,
        date: &str,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<Option<SnapshotDraft>> {
        let Some(latest) = store::latest_snapshot_for_account(&self.pool, real_estate.account_id).await? else {
            return Ok(None);
        };
        Ok(Some(SnapshotDraft {
            snapshot: new_real_estate_snapshot(&real_estate, latest.balance_usd, self.source(), date.to_owned(), now),
            decision: SnapshotDecision::Clean,
            anchor: LastUnflaggedBalanceResult {
                found: false,
                amount_usd: Default::default(),
                date: String::new(),
            },
            review: None,
            provider_state: None,
            carry_usd: Default::default(),
        }))
    }

    async fn emit_all(&self, sink: &dyn PersistSink) -> Result<()> {
        for real_estate in store::active_real_estate(&self.pool).await? {
            let draft = match self.snapshot_draft(real_estate.clone(), sink.today(), sink.now()).await {
                Ok(draft) => draft,
                Err(error) => {
                    tracing::error!(account_id = real_estate.account_id, %error, "real estate balance sync failed");
                    continue;
                }
            };
            if let Some(draft) = draft {
                sink.persist(PersistEvent::Snapshot(Box::new(draft))).await?;
            }
        }
        Ok(())
    }
}

impl SyncAdapter for RealEstateSyncAdapter {
    fn source(&self) -> SyncerId {
        SyncerId::Realestate
    }

    fn handles(&self, connection: &ConnectionRef) -> bool {
        connection.source_table == SourceTable::Assets
    }

    fn sync_due<'a>(&'a self, sink: Arc<dyn PersistSink>) -> BoxFuture<'a, Result<()>> {
        Box::pin(async move {
            run_scheduled_balance_sync(&self.pool, self.source(), sink.now(), || self.emit_all(sink.as_ref()))
                .await
                .map(|_| ())
        })
    }

    fn sync_connection_into<'a>(
        &'a self,
        connection: ConnectionRef,
        sink: &'a dyn PersistSink,
    ) -> BoxFuture<'a, Result<()>> {
        Box::pin(async move {
            let real_estate = store::real_estate_by_connection_id(&self.pool, connection.connection_id)
                .await?
                .ok_or_else(|| anyhow!("real estate for connection {} not found", connection.connection_id))?;
            self.emit_snapshot(real_estate, sink).await.with_context(|| {
                format!(
                    "persist real estate snapshot for connection {}",
                    connection.connection_id
                )
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use anyhow::Result;
    use chrono::{DateTime, TimeZone, Utc};

    use super::{ConnectionRef, PersistEvent, PersistSink, RealEstateSyncAdapter, SyncAdapter};
    use crate::{
        accounts::SourceTable,
        database::dbtest,
        money::Cents,
        utils::future::BoxFuture,
        wealth::{CreateRealEstate, RealEstateDetails, RealEstateValuation, SyncerId, store},
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
            "2026-07-02"
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
            "2026-07-02"
        }

        fn persist<'a>(&'a self, event: PersistEvent) -> BoxFuture<'a, Result<()>> {
            self.events.lock().unwrap().push(event);
            Box::pin(async { Ok(()) })
        }
    }

    #[tokio::test]
    async fn syncs_a_linked_home_from_its_last_valuation() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = crate::testutil::store::create_owner(&pool, "Owner").await?;
        let (connection, account) = store::create_real_estate(
            &pool,
            CreateRealEstate {
                owner_id: owner.id,
                label: "Home".to_owned(),
                details: RealEstateDetails {
                    street: None,
                    city: None,
                    state: None,
                    zip: None,
                    home_type: None,
                },
                initial_valuation: Some(RealEstateValuation {
                    value_usd: Cents(100_000),
                    date: "2026-07-01".to_owned(),
                    synced_at: Utc.with_ymd_and_hms(2026, 7, 1, 12, 0, 0).unwrap(),
                    source: SyncerId::Realestate,
                }),
            },
        )
        .await?;
        let adapter = RealEstateSyncAdapter::new(pool.clone());
        let sink = RecordingSink {
            now: Utc.with_ymd_and_hms(2026, 7, 2, 12, 0, 0).unwrap(),
            events: Mutex::new(Vec::new()),
        };

        assert!(adapter.handles(&ConnectionRef {
            connection_id: connection.connection.id,
            source_table: SourceTable::Assets,
            source_id: connection.source_id,
        }));
        adapter
            .sync_connection_into(
                ConnectionRef {
                    connection_id: connection.connection.id,
                    source_table: SourceTable::Assets,
                    source_id: connection.source_id,
                },
                &sink,
            )
            .await?;
        {
            let events = sink.events.lock().unwrap();
            let PersistEvent::Snapshot(snapshot) = &events[0] else {
                panic!("expected snapshot event");
            };
            assert_eq!(snapshot.snapshot.account_id, account.id);
            assert_eq!(snapshot.snapshot.balance_usd, Cents(100_000));
            assert!(snapshot.snapshot.holdings[0].manual);
        }

        sqlx::query(
            "UPDATE balance_sync_schedules SET next_balance_sync_at = '2026-07-01T00:00:00Z' WHERE id = 'realestate'",
        )
        .execute(&pool)
        .await?;
        let failing_sink: Arc<dyn PersistSink> = Arc::new(FailingSink { now: sink.now });
        assert!(adapter.sync_due(failing_sink).await.is_err());
        assert!(
            store::balance_sync_schedule_due(&pool, SyncerId::Realestate, sink.now)
                .await?
                .is_some()
        );
        Ok(())
    }

    #[tokio::test]
    async fn sync_due_skips_future_work_then_carries_the_latest_valuation_and_schedules() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = crate::testutil::store::create_owner(&pool, "Owner").await?;
        let (_, account) = store::create_real_estate(
            &pool,
            CreateRealEstate {
                owner_id: owner.id,
                label: "Home".to_owned(),
                details: RealEstateDetails {
                    street: None,
                    city: None,
                    state: None,
                    zip: None,
                    home_type: None,
                },
                initial_valuation: Some(RealEstateValuation {
                    value_usd: Cents(100_000),
                    date: "2026-07-01".to_owned(),
                    synced_at: Utc.with_ymd_and_hms(2026, 7, 1, 12, 0, 0).unwrap(),
                    source: SyncerId::Realestate,
                }),
            },
        )
        .await?;
        let now = Utc.with_ymd_and_hms(2026, 7, 2, 12, 0, 0).unwrap();
        let sink = Arc::new(RecordingSink {
            now,
            events: Mutex::new(Vec::new()),
        });
        let adapter = RealEstateSyncAdapter::new(pool.clone());
        sqlx::query(
            "UPDATE balance_sync_schedules SET balance_sync_cron = '0 9 * * *', next_balance_sync_at = '2026-07-03T00:00:00Z' WHERE id = 'realestate'",
        )
        .execute(&pool)
        .await?;

        adapter.sync_due(sink.clone()).await?;
        assert!(sink.events.lock().unwrap().is_empty());

        sqlx::query(
            "UPDATE balance_sync_schedules SET next_balance_sync_at = '2026-07-01T00:00:00Z' WHERE id = 'realestate'",
        )
        .execute(&pool)
        .await?;
        adapter.sync_due(sink.clone()).await?;
        {
            let events = sink.events.lock().unwrap();
            let PersistEvent::Snapshot(snapshot) = &events[0] else {
                panic!("expected snapshot event")
            };
            assert_eq!(snapshot.snapshot.account_id, account.id);
            assert_eq!(snapshot.snapshot.balance_usd, Cents(100_000));
        }
        assert!(
            store::balance_sync_schedule_due(&pool, SyncerId::Realestate, now)
                .await?
                .is_none()
        );
        Ok(())
    }
}
