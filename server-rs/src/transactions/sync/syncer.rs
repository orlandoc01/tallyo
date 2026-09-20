use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, RwLock},
    time::Duration,
};

use anyhow::{Context, Result};
use sqlx::SqlitePool;
use tokio::sync::mpsc::Receiver;
use tokio_util::sync::CancellationToken;

use crate::{
    accounts::{AccountsCreated, EventBus, ItemSyncer, SourceTable},
    transactions::{
        ItemReport, ItemSyncResult, Persister, SyncAdapter, SyncReport, SyncResult,
        llm::{CategoryRef, OllamaCategorizer},
        store::llm_store,
    },
    utils::cron::run_hourly_cron,
    utils::future::BoxFuture,
};

use super::llm_worker::LlmWorker;

const NO_TRANSACTION_SYNC_ADAPTER: &str = "no transaction sync adapter for provider";

pub struct Syncer {
    pool: SqlitePool,
    adapters: Vec<Box<dyn SyncAdapter>>,
    persister: Persister,
    llm: Arc<LlmWorker>,
    tracking_disabled: RwLock<bool>,
    initial_sync_delay: Duration,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LlmSettings {
    pub url: String,
    pub model: String,
}

impl LlmSettings {
    fn validate(&self) -> Result<()> {
        anyhow::ensure!(!self.url.trim().is_empty(), "llm URL must not be empty");
        anyhow::ensure!(!self.model.trim().is_empty(), "llm model must not be empty");
        url::Url::parse(&self.url).context("validate llm URL")?;
        Ok(())
    }
}

impl Syncer {
    pub fn new(pool: SqlitePool, adapters: Vec<Box<dyn SyncAdapter>>) -> Self {
        let llm = Arc::new(LlmWorker::new(pool.clone()));
        Self {
            pool: pool.clone(),
            adapters,
            persister: Persister::new(pool.clone(), Arc::clone(&llm)),
            llm,
            tracking_disabled: RwLock::new(false),
            initial_sync_delay: Duration::ZERO,
        }
    }

    pub fn update_tracking_disabled(&self, disabled: bool) {
        *self
            .tracking_disabled
            .write()
            .expect("transaction sync runtime lock poisoned") = disabled;
    }

    pub fn with_initial_sync_delay(mut self, initial_sync_delay: Duration) -> Self {
        self.initial_sync_delay = initial_sync_delay;
        self
    }

    pub async fn sync_due(&self) -> SyncResult {
        if self.tracking_disabled() {
            return SyncResult::default();
        }
        let mut report = SyncReport::default();
        for adapter in &self.adapters {
            report.items.extend(adapter.sync_due(&self.persister).await.items);
        }
        self.llm.signal();
        self.sync_result(report)
    }

    pub async fn sync_item(&self, item_id: i64) -> Result<()> {
        let Some(adapter) = self.adapter_for(SourceTable::PlaidItems) else {
            anyhow::bail!("{NO_TRANSACTION_SYNC_ADAPTER} \"{}\"", SourceTable::PlaidItems);
        };
        let report = adapter.sync_connection_into(item_id, &self.persister).await;
        self.llm.signal();
        report.error.map_or(Ok(()), Err)
    }

    pub async fn sync_recurring_due(&self) -> SyncResult {
        if self.tracking_disabled() {
            return SyncResult::default();
        }
        let mut report = SyncReport::default();
        for adapter in &self.adapters {
            report
                .items
                .extend(adapter.sync_recurring_due(&self.persister).await.items);
        }
        self.sync_result(report)
    }

    pub async fn run(&self, cancel: CancellationToken) {
        if let Err(error) = self.llm.prepare_startup().await {
            tracing::error!(%error, "clear staged transactions on startup");
        }
        run_hourly_cron(cancel, || async {
            let report = self.sync_due().await;
            tracing::info!(
                added = report.total_added,
                modified = report.total_modified,
                removed = report.total_removed,
                items = report.items.len(),
                "plaid sync completed"
            );
        })
        .await;
    }

    pub async fn run_recurring(&self, cancel: CancellationToken) {
        run_hourly_cron(cancel, || async {
            self.sync_recurring_due().await;
        })
        .await;
    }

    pub async fn set_llm(&self, categorizer: Option<OllamaCategorizer>) -> Result<()> {
        self.llm.set_categorizer(categorizer).await
    }

    pub async fn prepare_llm(
        &self,
        settings: LlmSettings,
    ) -> Result<impl FnOnce() -> Pin<Box<dyn Future<Output = ()> + Send>> + Send> {
        settings.validate()?;
        let categories = llm_categories(&self.pool).await?;
        let categorizer = OllamaCategorizer::with_categories(settings.url, settings.model, categories)?;
        let category_count = categorizer.category_count();
        let llm = Arc::clone(&self.llm);
        Ok(move || {
            Box::pin(async move {
                llm.enable(categorizer).await;
                tracing::info!(provider = "ollama", category_count, "llm categorization enabled");
            }) as Pin<Box<dyn Future<Output = ()> + Send>>
        })
    }

    pub async fn disable_llm(&self) {
        self.llm.disable().await;
    }

    pub(super) fn llm(&self) -> &LlmWorker {
        self.llm.as_ref()
    }

    pub async fn run_llm_worker(&self, cancel: CancellationToken) {
        self.llm().run(cancel).await;
    }

    pub async fn reprocess_uncategorized(&self) -> Result<u64> {
        self.llm.reprocess_uncategorized().await
    }

    pub async fn run_account_events(&self, mut events: Receiver<AccountsCreated>, cancel: CancellationToken) {
        loop {
            tokio::select! {
                _ = cancel.cancelled() => return,
                event = events.recv() => match event {
                    Some(event) => self.sync_account_created(event, &cancel).await,
                    None => return,
                },
            }
        }
    }

    pub fn subscribe(&self, events: &EventBus) -> Receiver<AccountsCreated> {
        events.register_subscriber("transaction-sync")
    }

    fn tracking_disabled(&self) -> bool {
        *self
            .tracking_disabled
            .read()
            .expect("transaction sync runtime lock poisoned")
    }

    fn sync_result(&self, report: SyncReport) -> SyncResult {
        report.items.into_iter().map(|report| self.item_result(report)).fold(
            SyncResult::default(),
            |mut result, item| {
                result.total_added += item.added;
                result.total_modified += item.modified;
                result.total_removed += item.removed;
                result.items.push(item);
                result
            },
        )
    }

    fn item_result(&self, report: ItemReport) -> ItemSyncResult {
        let counts = report.counts;
        let error = report.error.map(|error| {
            tracing::warn!(
                added = counts.added,
                modified = counts.modified,
                removed = counts.removed,
                %error,
                "transaction sync item failed"
            );
            "sync failed".to_owned()
        });
        ItemSyncResult {
            added: counts.added,
            modified: counts.modified,
            removed: counts.removed,
            error,
        }
    }

    async fn sync_account_created(&self, event: AccountsCreated, cancel: &CancellationToken) {
        let Some(adapter) = self.adapter_for(event.provider) else {
            return;
        };
        if !self.initial_sync_delay.is_zero() {
            tokio::select! {
                _ = tokio::time::sleep(self.initial_sync_delay) => {}
                _ = cancel.cancelled() => return,
            }
        }
        if self.tracking_disabled() {
            return;
        }
        let report = adapter.sync_connection_into(event.source_id, &self.persister).await;
        self.llm.signal();
        if let Some(error) = report.error {
            tracing::error!(item_id = event.source_id, %error, "delayed initial sync failed");
        }
    }

    fn adapter_for(&self, provider: SourceTable) -> Option<&dyn SyncAdapter> {
        self.adapters
            .iter()
            .find(|adapter| adapter.handles(provider))
            .map(AsRef::as_ref)
    }
}

impl ItemSyncer for Syncer {
    fn sync_item<'a>(&'a self, item_id: i64) -> BoxFuture<'a, Result<()>> {
        Box::pin(self.sync_item(item_id))
    }
}

async fn llm_categories(pool: &SqlitePool) -> Result<Vec<CategoryRef>> {
    llm_store::categories_for_llm(pool).await.context("load llm categories")
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
        time::Duration,
    };

    use anyhow::{Result, anyhow};
    use tokio_util::sync::CancellationToken;

    use super::{LlmSettings, NO_TRANSACTION_SYNC_ADAPTER, Syncer};
    use crate::{
        accounts::{AccountsCreated, ItemSyncer, PlaidClientFactory, SourceTable},
        clients::simplefin::SimpleFinClient,
        database::dbtest,
        transactions::{ItemCounts, ItemReport, Persister, PlaidSync, SimpleFinSync, SyncAdapter, SyncReport},
        utils::future::BoxFuture,
    };

    struct FakeSyncAdapter {
        due_calls: Arc<AtomicUsize>,
        recurring_calls: Arc<AtomicUsize>,
    }

    impl SyncAdapter for FakeSyncAdapter {
        fn handles(&self, _provider: SourceTable) -> bool {
            false
        }

        fn sync_due<'a>(&'a self, _sink: &'a Persister) -> BoxFuture<'a, SyncReport> {
            Box::pin(async move {
                self.due_calls.fetch_add(1, Ordering::Relaxed);
                SyncReport::default()
            })
        }

        fn sync_connection_into<'a>(&'a self, _source_id: i64, _sink: &'a Persister) -> BoxFuture<'a, ItemReport> {
            Box::pin(async { ItemReport::success(ItemCounts::default()) })
        }

        fn sync_recurring_due<'a>(&'a self, _sink: &'a Persister) -> BoxFuture<'a, SyncReport> {
            Box::pin(async move {
                self.recurring_calls.fetch_add(1, Ordering::Relaxed);
                SyncReport::default()
            })
        }
    }

    #[test]
    fn implements_accounts_item_syncer() {
        fn assert_item_syncer<T: ItemSyncer>() {}

        assert_item_syncer::<Syncer>();
    }

    #[tokio::test]
    async fn prepares_then_commits_and_disables_llm_configuration() -> Result<()> {
        let pool = dbtest::open().await?;
        let syncer = Syncer::new(
            pool.clone(),
            vec![
                Box::new(PlaidSync::new(pool.clone(), PlaidClientFactory::new(pool.clone()))),
                Box::new(SimpleFinSync::new(pool.clone(), SimpleFinClient::new()?)),
            ],
        );

        let commit = syncer
            .prepare_llm(LlmSettings {
                url: "http://localhost:11434".to_owned(),
                model: "test".to_owned(),
            })
            .await?;
        assert!(!syncer.llm().enabled().await);

        commit().await;
        assert!(syncer.llm().enabled().await);

        syncer.disable_llm().await;
        assert!(!syncer.llm().enabled().await);
        Ok(())
    }

    #[tokio::test]
    async fn folds_item_counts_and_sanitizes_item_errors() -> Result<()> {
        let pool = dbtest::open().await?;
        let syncer = Syncer::new(
            pool.clone(),
            vec![
                Box::new(PlaidSync::new(pool.clone(), PlaidClientFactory::new(pool.clone()))),
                Box::new(SimpleFinSync::new(pool.clone(), SimpleFinClient::new()?)),
            ],
        );
        let result = syncer.sync_result(SyncReport {
            items: vec![
                ItemReport::success(ItemCounts {
                    added: 2,
                    modified: 3,
                    removed: 5,
                    ..Default::default()
                }),
                ItemReport::failure(
                    ItemCounts {
                        added: 7,
                        modified: 11,
                        removed: 13,
                        ..Default::default()
                    },
                    anyhow!("provider secret"),
                ),
            ],
        });

        assert_eq!(
            (result.total_added, result.total_modified, result.total_removed),
            (9, 14, 18)
        );
        assert_eq!(result.items[1].error.as_deref(), Some("sync failed"));
        Ok(())
    }

    #[tokio::test]
    async fn tracking_disabled_skips_due_recurring_and_account_created_syncs() -> Result<()> {
        let pool = dbtest::open().await?;
        let syncer = Syncer::new(
            pool.clone(),
            vec![
                Box::new(PlaidSync::new(pool.clone(), PlaidClientFactory::new(pool.clone()))),
                Box::new(SimpleFinSync::new(pool.clone(), SimpleFinClient::new()?)),
            ],
        );
        syncer.update_tracking_disabled(true);

        assert!(syncer.sync_due().await.items.is_empty());
        assert!(syncer.sync_recurring_due().await.items.is_empty());
        syncer
            .sync_account_created(
                AccountsCreated {
                    connection_id: 1,
                    provider: SourceTable::PlaidItems,
                    source_id: 1,
                },
                &CancellationToken::new(),
            )
            .await;
        Ok(())
    }

    #[tokio::test]
    async fn sync_loops_and_delayed_account_syncs_honor_cancellation() -> Result<()> {
        let pool = dbtest::open().await?;
        let syncer = Syncer::new(
            pool.clone(),
            vec![
                Box::new(PlaidSync::new(pool.clone(), PlaidClientFactory::new(pool.clone()))),
                Box::new(SimpleFinSync::new(pool.clone(), SimpleFinClient::new()?)),
            ],
        )
        .with_initial_sync_delay(Duration::from_secs(60));
        let cancel = CancellationToken::new();
        cancel.cancel();

        syncer.run(cancel.clone()).await;
        syncer
            .sync_account_created(
                AccountsCreated {
                    connection_id: 1,
                    provider: SourceTable::PlaidItems,
                    source_id: 1,
                },
                &cancel,
            )
            .await;
        let (sender, receiver) = tokio::sync::mpsc::channel(1);
        drop(sender);
        syncer.run_account_events(receiver, CancellationToken::new()).await;
        assert!(syncer.sync_item(1).await.is_err());
        Ok(())
    }

    #[tokio::test]
    async fn injected_adapters_handle_all_syncs_and_missing_plaid_adapter_errors() -> Result<()> {
        let pool = dbtest::open().await?;
        let due_calls = Arc::new(AtomicUsize::new(0));
        let recurring_calls = Arc::new(AtomicUsize::new(0));
        let syncer = Syncer::new(
            pool,
            (0..2)
                .map(|_| {
                    Box::new(FakeSyncAdapter {
                        due_calls: Arc::clone(&due_calls),
                        recurring_calls: Arc::clone(&recurring_calls),
                    }) as Box<dyn SyncAdapter>
                })
                .collect(),
        );

        assert!(syncer.sync_due().await.items.is_empty());
        assert!(syncer.sync_recurring_due().await.items.is_empty());
        assert_eq!(due_calls.load(Ordering::Relaxed), 2);
        assert_eq!(recurring_calls.load(Ordering::Relaxed), 2);
        let error = syncer
            .sync_item(1)
            .await
            .expect_err("missing Plaid adapter should fail");
        assert_eq!(
            error.to_string(),
            format!("{NO_TRANSACTION_SYNC_ADAPTER} \"plaid_items\"")
        );
        Ok(())
    }
}
