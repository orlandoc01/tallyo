use std::{future::Future, time::Duration};

use anyhow::{Context, Result};
use sqlx::SqlitePool;
use tokio_util::sync::CancellationToken;

use super::queries;

pub const RETENTION_SWEEP_INTERVAL: Duration = Duration::from_secs(60 * 60);
pub const SQLITE_OPTIMIZE_INTERVAL: Duration = Duration::from_secs(4 * 60 * 60);

/// Run a fallible job immediately and then at each interval until cancellation.
pub async fn run_periodic<F, Fut>(cancellation: CancellationToken, interval: Duration, job: F)
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<()>>,
{
    if let Err(error) = job().await {
        tracing::error!(%error, "periodic database job failed");
    }

    let mut ticker = tokio::time::interval(interval);
    ticker.tick().await;
    loop {
        if cancellation.is_cancelled() {
            return;
        }

        tokio::select! {
            () = cancellation.cancelled() => return,
            _ = ticker.tick() => {
                if let Err(error) = job().await {
                    tracing::error!(%error, "periodic database job failed");
                }
            }
        }
    }
}

/// Sweep expired database records hourly until cancellation.
pub async fn run_retention_sweep(cancellation: CancellationToken, pool: &SqlitePool) {
    run_periodic(cancellation, RETENTION_SWEEP_INTERVAL, || async {
        queries::trigger_retention_sweep(pool).await?;
        Ok(())
    })
    .await;
}

/// Run SQLite's recommended optimizer every four hours until cancellation.
pub async fn run_sqlite_optimize(cancellation: CancellationToken, pool: &SqlitePool) {
    run_periodic(cancellation, SQLITE_OPTIMIZE_INTERVAL, || optimize(pool)).await;
}

/// Run SQLite's recommended optimizer once.
pub async fn optimize(pool: &SqlitePool) -> Result<()> {
    sqlx::query("PRAGMA optimize")
        .execute(pool)
        .await
        .context("optimize SQLite")?;
    Ok(())
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

    use anyhow::Result;
    use tokio_util::sync::CancellationToken;

    use super::{optimize, run_periodic};
    use crate::database::{dbtest, queries};

    #[tokio::test]
    async fn retention_sweep_removes_expired_records() -> Result<()> {
        let pool = dbtest::open().await?;
        sqlx::query("INSERT INTO plaid_credentials (id, client_id, secret) VALUES (1, 'client', 'secret')")
            .execute(&pool)
            .await?;
        sqlx::query(
            "INSERT INTO plaid_items (id, credential_id, access_token, external_id) VALUES (1, 1, 'access', 'item')",
        )
        .execute(&pool)
        .await?;
        sqlx::query("INSERT INTO plaid_sync_log (item_id, synced_at) VALUES (1, '2000-01-01T00:00:00Z'), (1, '2999-01-01T00:00:00Z')")
            .execute(&pool)
            .await?;

        queries::trigger_retention_sweep(&pool).await?;

        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM plaid_sync_log")
                .fetch_one(&pool)
                .await?,
            1
        );
        Ok(())
    }

    #[tokio::test]
    async fn periodic_jobs_run_immediately_and_stop_on_cancellation() -> Result<()> {
        let cancellation = CancellationToken::new();
        let runs = Arc::new(AtomicUsize::new(0));
        let job_runs = Arc::clone(&runs);
        let job_cancellation = cancellation.clone();

        run_periodic(cancellation, Duration::from_millis(1), move || {
            let job_runs = Arc::clone(&job_runs);
            let job_cancellation = job_cancellation.clone();
            async move {
                if job_runs.fetch_add(1, Ordering::SeqCst) == 1 {
                    job_cancellation.cancel();
                }
                Ok(())
            }
        })
        .await;

        assert_eq!(runs.load(Ordering::SeqCst), 2);
        Ok(())
    }

    #[tokio::test]
    async fn optimize_succeeds_on_an_open_database() -> Result<()> {
        let pool = dbtest::open().await?;
        optimize(&pool).await
    }
}
