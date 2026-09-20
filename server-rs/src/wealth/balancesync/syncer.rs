use std::sync::{Arc, RwLock};

use sqlx::SqlitePool;
use tokio_util::sync::CancellationToken;

use crate::{
    utils::cron::run_hourly_cron,
    utils::future::BoxFuture,
    wealth::{SnapshotPersister, SyncAdapter, store},
};

pub trait PortfolioSyncer: Send + Sync {
    fn sync<'a>(&'a self) -> BoxFuture<'a, anyhow::Result<()>>;
}

struct Runtime {
    tracking_disabled: bool,
}

pub struct Syncer {
    pub(super) pool: SqlitePool,
    pub(super) adapters: Vec<Arc<dyn SyncAdapter>>,
    portfolio: Option<Arc<dyn PortfolioSyncer>>,
    runtime: RwLock<Runtime>,
}

impl Syncer {
    pub fn new(
        pool: SqlitePool,
        adapters: Vec<Arc<dyn SyncAdapter>>,
        portfolio: Option<Arc<dyn PortfolioSyncer>>,
    ) -> Self {
        Self {
            pool,
            adapters,
            portfolio,
            runtime: RwLock::new(Runtime {
                tracking_disabled: false,
            }),
        }
    }

    pub fn update_tracking_disabled(&self, tracking_disabled: bool) {
        self.runtime
            .write()
            .expect("wealth balance sync runtime lock poisoned")
            .tracking_disabled = tracking_disabled;
    }

    pub async fn run(self: Arc<Self>, cancel: CancellationToken) {
        run_hourly_cron(cancel, || {
            let syncer = Arc::clone(&self);
            async move { syncer.sync_due().await }
        })
        .await;
    }

    pub async fn sync_due(&self) {
        if self.tracking_disabled() {
            return;
        }
        let sink: Arc<dyn crate::wealth::PersistSink> = Arc::new(SnapshotPersister::new(self.pool.clone()));
        for adapter in &self.adapters {
            if let Err(error) = adapter.sync_due(Arc::clone(&sink)).await {
                tracing::error!(source = %adapter.source(), %error, "balance sync adapter failed");
            }
        }
        self.sweep().await;
        if let Some(portfolio) = &self.portfolio
            && let Err(error) = portfolio.sync().await
        {
            tracing::error!(%error, "portfolio sync failed");
        }
    }

    pub(super) fn tracking_disabled(&self) -> bool {
        self.runtime
            .read()
            .expect("wealth balance sync runtime lock poisoned")
            .tracking_disabled
    }

    pub(super) async fn sweep(&self) {
        if let Err(error) = store::sweep_unreferenced_assets(&self.pool).await {
            tracing::warn!(%error, "sweep unreferenced assets failed");
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    };

    use anyhow::Result;
    use tokio_util::sync::CancellationToken;

    use super::{PortfolioSyncer, Syncer};
    use crate::{
        database::dbtest,
        utils::future::BoxFuture,
        wealth::{ConnectionRef, PersistSink, SyncAdapter, SyncerId},
    };

    struct Adapter {
        name: &'static str,
        calls: Arc<Mutex<Vec<&'static str>>>,
        fails: bool,
    }

    impl SyncAdapter for Adapter {
        fn source(&self) -> SyncerId {
            SyncerId::Manual
        }

        fn handles(&self, _: &ConnectionRef) -> bool {
            false
        }

        fn sync_due<'a>(&'a self, _: Arc<dyn PersistSink>) -> BoxFuture<'a, Result<()>> {
            Box::pin(async move {
                self.calls.lock().unwrap().push(self.name);
                if self.fails {
                    anyhow::bail!("adapter failed");
                }
                Ok(())
            })
        }

        fn sync_connection_into<'a>(&'a self, _: ConnectionRef, _: &'a dyn PersistSink) -> BoxFuture<'a, Result<()>> {
            Box::pin(async { Ok(()) })
        }
    }

    struct Portfolio(AtomicUsize);

    impl PortfolioSyncer for Portfolio {
        fn sync<'a>(&'a self) -> BoxFuture<'a, Result<()>> {
            Box::pin(async move {
                self.0.fetch_add(1, Ordering::Relaxed);
                Ok(())
            })
        }
    }

    #[tokio::test]
    async fn sync_due_runs_adapters_in_order_after_errors_then_sweeps_and_syncs_portfolio() -> Result<()> {
        let pool = dbtest::open().await?;
        let calls = Arc::new(Mutex::new(Vec::new()));
        let portfolio = Arc::new(Portfolio(AtomicUsize::new(0)));
        let syncer = Syncer::new(
            pool,
            vec![
                Arc::new(Adapter {
                    name: "failing",
                    calls: Arc::clone(&calls),
                    fails: true,
                }),
                Arc::new(Adapter {
                    name: "next",
                    calls: Arc::clone(&calls),
                    fails: false,
                }),
            ],
            Some(Arc::clone(&portfolio) as Arc<dyn PortfolioSyncer>),
        );

        syncer.sync_due().await;

        assert_eq!(*calls.lock().unwrap(), ["failing", "next"]);
        assert_eq!(portfolio.0.load(Ordering::Relaxed), 1);
        Ok(())
    }

    #[tokio::test]
    async fn tracking_disabled_skips_due_and_a_cancelled_run_still_performs_the_initial_sync() -> Result<()> {
        let pool = dbtest::open().await?;
        let calls = Arc::new(Mutex::new(Vec::new()));
        let adapter = Arc::new(Adapter {
            name: "adapter",
            calls: Arc::clone(&calls),
            fails: false,
        });
        let syncer = Arc::new(Syncer::new(pool, vec![adapter], None));
        syncer.update_tracking_disabled(true);
        syncer.sync_due().await;
        assert!(calls.lock().unwrap().is_empty());

        syncer.update_tracking_disabled(false);
        let cancel = CancellationToken::new();
        cancel.cancel();
        Arc::clone(&syncer).run(cancel).await;
        assert_eq!(*calls.lock().unwrap(), ["adapter"]);
        Ok(())
    }
}
