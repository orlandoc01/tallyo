use std::collections::HashMap;

use anyhow::Result;
use sqlx::SqlitePool;
use tokio::sync::{Mutex, RwLock, RwLockReadGuard, mpsc};
use tokio_util::sync::CancellationToken;

use crate::{
    apierror::ApiError,
    transactions::{
        llm::{Confidence, LlmTransaction, OllamaCategorizer},
        store::llm_store,
    },
};

const LLM_BATCH_LIMIT: i64 = 200;

pub(super) struct LlmWorker {
    pool: SqlitePool,
    categorizer: RwLock<Option<OllamaCategorizer>>,
    trigger: mpsc::Sender<()>,
    receiver: Mutex<Option<mpsc::Receiver<()>>>,
}

impl LlmWorker {
    pub(super) fn new(pool: SqlitePool) -> Self {
        let (trigger, receiver) = mpsc::channel(1);
        Self {
            pool,
            categorizer: RwLock::new(None),
            trigger,
            receiver: Mutex::new(Some(receiver)),
        }
    }

    pub(super) async fn set_categorizer(&self, categorizer: Option<OllamaCategorizer>) -> Result<()> {
        match categorizer {
            Some(categorizer) => self.enable(categorizer).await,
            None => self.disable().await,
        }
        Ok(())
    }

    pub(super) async fn enable(&self, categorizer: OllamaCategorizer) {
        let mut current = self.categorizer.write().await;
        *current = Some(categorizer);
        drop(current);
        self.signal();
    }

    pub(super) async fn disable(&self) {
        let mut current = self.categorizer.write().await;
        if current.take().is_none() {
            return;
        }
        if let Err(error) = llm_store::clear_staged(&self.pool, None).await {
            tracing::error!(%error, "clear staged transactions on llm disable");
        } else {
            tracing::info!("llm categorization disabled; cleared staged transactions");
        }
    }

    pub(super) async fn enabled(&self) -> bool {
        self.categorizer.read().await.is_some()
    }

    pub(super) async fn staging_guard(&self) -> RwLockReadGuard<'_, Option<OllamaCategorizer>> {
        self.categorizer.read().await
    }

    pub(super) fn signal(&self) {
        let _ = self.trigger.try_send(());
    }

    pub(super) async fn prepare_startup(&self) -> Result<()> {
        if self.enabled().await {
            self.signal();
            return Ok(());
        }
        llm_store::clear_staged(&self.pool, None).await
    }

    pub(super) async fn reprocess_uncategorized(&self) -> Result<u64> {
        let categorizer = self.staging_guard().await;
        if categorizer.is_none() {
            return Err(ApiError::bad_input("LLM categorization is not enabled").into());
        }
        let staged = llm_store::stage_uncategorized(&self.pool).await?;
        drop(categorizer);
        self.signal();
        Ok(staged)
    }

    pub(super) async fn run(&self, cancel: CancellationToken) {
        let Some(mut receiver) = self.receiver.lock().await.take() else {
            tracing::warn!("llm worker already running");
            return;
        };
        loop {
            tokio::select! {
                _ = cancel.cancelled() => return,
                trigger = receiver.recv() => match trigger {
                    Some(()) => {
                        if self.enabled().await {
                            self.drain().await;
                        }
                    }
                    None => return,
                },
            }
        }
    }

    async fn drain(&self) {
        loop {
            match self.categorize().await {
                Ok(0) => return,
                Ok(_) => {}
                Err(error) => {
                    tracing::error!(%error, "llm categorization failed");
                    return;
                }
            }
        }
    }

    async fn categorize(&self) -> Result<usize> {
        let transactions = llm_store::uncategorized_for_llm(&self.pool, LLM_BATCH_LIMIT).await?;
        if transactions.is_empty() {
            return Ok(0);
        }
        let global_examples = llm_store::top_merchant_examples(&self.pool, 20)
            .await
            .unwrap_or_else(|error| {
                tracing::error!(%error, "fetch global llm examples");
                Vec::new()
            });
        let transactions = self.annotate_similar_examples(transactions).await;
        let Some(categorizer) = self.categorizer.read().await.as_ref().cloned() else {
            return Ok(0);
        };
        let pfc2_matches = transactions
            .iter()
            .map(|transaction| (transaction.id, transaction.has_pfc2_match))
            .collect::<HashMap<_, _>>();
        let total = transactions.len();
        let batches = total.div_ceil(categorizer.batch_size());
        let mut applied = 0;
        tracing::info!(
            uncategorized = total,
            global_examples = global_examples.len(),
            "running llm categorization"
        );
        for (index, batch) in transactions.chunks(categorizer.batch_size()).enumerate() {
            let results = categorizer.categorize_batch(batch, &global_examples).await?;
            applied += self.apply_results(results, &pfc2_matches).await?;
            llm_store::clear_staged(
                &self.pool,
                Some(&batch.iter().map(|transaction| transaction.id).collect::<Vec<_>>()),
            )
            .await?;
            tracing::info!(
                batch = index + 1,
                batches,
                processed = ((index + 1) * categorizer.batch_size()).min(total),
                total,
                categorized = applied,
                "llm categorization progress"
            );
        }
        tracing::info!(submitted = total, categorized = applied, "llm categorization complete");
        Ok(transactions.len())
    }

    async fn annotate_similar_examples(&self, mut transactions: Vec<LlmTransaction>) -> Vec<LlmTransaction> {
        let merchants = transactions
            .iter()
            .map(|transaction| transaction.merchant_name.clone())
            .collect::<Vec<_>>();
        let examples_by_merchant = llm_store::similar_examples_by_merchant(&self.pool, &merchants)
            .await
            .unwrap_or_else(|error| {
                tracing::error!(%error, "fetch similar llm examples");
                HashMap::new()
            });
        for transaction in &mut transactions {
            transaction.similar_examples = examples_by_merchant
                .get(&transaction.merchant_name.to_lowercase())
                .cloned()
                .unwrap_or_default();
        }
        transactions
    }

    async fn apply_results(
        &self,
        results: Vec<crate::transactions::llm::LlmResult>,
        pfc2_matches: &HashMap<i64, bool>,
    ) -> Result<usize> {
        let mut applied = 0;
        for result in results {
            if pfc2_matches.get(&result.transaction_id).copied().unwrap_or_default()
                && result.confidence != Confidence::High
            {
                continue;
            }
            llm_store::apply_category(&self.pool, result.transaction_id, result.category_id).await?;
            applied += 1;
            tracing::info!(
                transaction_id = result.transaction_id,
                category = result.category_name,
                confidence = ?result.confidence,
                "llm categorized transaction"
            );
        }
        Ok(applied)
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use anyhow::Result;
    use chrono::{TimeZone, Utc};

    use super::LlmWorker;
    use crate::{
        database::{dbtest, queries},
        money::Cents,
        testutil::transactions,
        transactions::llm::{Confidence, LlmResult, OllamaCategorizer},
    };

    #[tokio::test]
    async fn requires_high_confidence_to_override_a_pfc2_match() -> Result<()> {
        let pool = dbtest::open().await?;
        let categories = queries::categories_for_llm(&pool).await?;
        let original_category_id = categories[0].id;
        let target_category_id = categories
            .iter()
            .find(|category| category.id != original_category_id)
            .expect("seeded distinct expense category")
            .id;
        let account_id = transactions::account(&pool, "checking").await?;
        let transaction_id = transactions::transaction(
            &pool,
            "Coffee",
            account_id,
            original_category_id,
            Cents(500),
            Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
        )
        .await?;
        sqlx::query("UPDATE transactions SET pfc2_categorized = 1 WHERE id = ?")
            .bind(transaction_id)
            .execute(&pool)
            .await?;
        let worker = LlmWorker::new(pool.clone());
        let pfc2_matches = [(transaction_id, true)].into_iter().collect();

        worker
            .apply_results(
                vec![LlmResult {
                    transaction_id,
                    category_id: target_category_id,
                    category_name: "Target".to_owned(),
                    confidence: Confidence::Medium,
                }],
                &pfc2_matches,
            )
            .await?;
        assert_eq!(transaction_category(&pool, transaction_id).await?, original_category_id);

        worker
            .apply_results(
                vec![LlmResult {
                    transaction_id,
                    category_id: target_category_id,
                    category_name: "Target".to_owned(),
                    confidence: Confidence::High,
                }],
                &pfc2_matches,
            )
            .await?;
        assert_eq!(transaction_category(&pool, transaction_id).await?, target_category_id);
        Ok(())
    }

    #[tokio::test]
    async fn disabling_waits_for_in_flight_staging() -> Result<()> {
        let pool = dbtest::open().await?;
        let worker = configured_worker(&pool).await?;
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
        sqlx::query("UPDATE transactions SET staged_for_llm = 1 WHERE id = ?")
            .bind(transaction_id)
            .execute(&pool)
            .await?;

        let staging = worker.staging_guard().await;
        let mut disabling = tokio::spawn({
            let worker = Arc::clone(&worker);
            async move { worker.set_categorizer(None).await }
        });
        assert!(
            tokio::time::timeout(Duration::from_millis(20), &mut disabling)
                .await
                .is_err()
        );
        drop(staging);

        disabling.await??;
        assert_eq!(staged_count(&pool).await?, 0);
        Ok(())
    }

    #[tokio::test]
    async fn disabling_waits_for_reprocess_staging() -> Result<()> {
        let pool = dbtest::open().await?;
        let worker = configured_worker(&pool).await?;
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

        let connection = pool.acquire().await?;
        let reprocess = tokio::spawn({
            let worker = Arc::clone(&worker);
            async move { worker.reprocess_uncategorized().await }
        });
        tokio::task::yield_now().await;
        let mut disabling = tokio::spawn({
            let worker = Arc::clone(&worker);
            async move { worker.set_categorizer(None).await }
        });
        assert!(
            tokio::time::timeout(Duration::from_millis(20), &mut disabling)
                .await
                .is_err()
        );
        drop(connection);

        assert_eq!(reprocess.await??, 1);
        disabling.await??;
        assert_eq!(staged_count(&pool).await?, 0);
        Ok(())
    }

    async fn configured_worker(pool: &sqlx::SqlitePool) -> Result<Arc<LlmWorker>> {
        let worker = Arc::new(LlmWorker::new(pool.clone()));
        worker
            .set_categorizer(Some(
                OllamaCategorizer::new(pool, "http://localhost:11434", "test").await?,
            ))
            .await?;
        Ok(worker)
    }

    async fn staged_count(pool: &sqlx::SqlitePool) -> Result<i64> {
        crate::transactions::store::llm_store::count_staged(pool).await
    }

    async fn transaction_category(pool: &sqlx::SqlitePool, id: i64) -> Result<i64> {
        Ok(sqlx::query_scalar("SELECT category_id FROM transactions WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await?)
    }
}
