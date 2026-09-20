use std::future::Future;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use crate::{
    utils::cron::next_after_in_zone,
    wealth::{SyncerId, store},
};

const BALANCE_SYNC_TIMEZONE: &str = "America/New_York";
pub async fn run_scheduled_balance_sync<F, Fut>(
    pool: &SqlitePool,
    id: SyncerId,
    now: DateTime<Utc>,
    sync: F,
) -> Result<bool>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<()>>,
{
    let Some(cron) = store::balance_sync_schedule_due(pool, id, now).await? else {
        return Ok(false);
    };
    sync().await?;
    let next = next_balance_sync_after(&cron, now)?;
    store::set_balance_sync_schedule_synced(pool, id, next).await?;
    Ok(true)
}

pub fn next_balance_sync_after(cron: &str, now: DateTime<Utc>) -> Result<DateTime<Utc>> {
    next_after_in_zone(cron, BALANCE_SYNC_TIMEZONE, now).context("compute next balance sync")
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use anyhow::Result;
    use chrono::{TimeZone, Utc};

    use super::{next_balance_sync_after, run_scheduled_balance_sync};
    use crate::{database::dbtest, wealth::SyncerId};

    #[tokio::test]
    async fn only_runs_due_schedules_and_advances_them_after_success() -> Result<()> {
        let pool = dbtest::open().await?;
        sqlx::query(
            "INSERT OR REPLACE INTO balance_sync_schedules (id, balance_sync_cron, next_balance_sync_at) VALUES ('manual', '0 * * * *', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await?;
        let now = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();
        let calls = Arc::new(AtomicUsize::new(0));

        assert!(
            run_scheduled_balance_sync(&pool, SyncerId::Manual, now, || {
                let calls = Arc::clone(&calls);
                async move {
                    calls.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                }
            })
            .await?
        );
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        assert!(!run_scheduled_balance_sync(&pool, SyncerId::Manual, now, || async { Ok(()) }).await?);
        sqlx::query(
            "UPDATE balance_sync_schedules SET balance_sync_cron = '*/5 * * * *', next_balance_sync_at = '2026-01-01T00:00:00Z' WHERE id = 'manual'",
        )
        .execute(&pool)
        .await?;
        assert!(run_scheduled_balance_sync(&pool, SyncerId::Manual, now, || async { Ok(()) }).await?);
        Ok(())
    }

    #[test]
    fn computes_next_balance_syncs_in_new_york() -> Result<()> {
        let now = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();
        assert_eq!(
            next_balance_sync_after("0 9 * * *", now)?,
            Utc.with_ymd_and_hms(2026, 1, 1, 14, 0, 0).unwrap()
        );
        Ok(())
    }
}
