use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use crate::{
    database::{Timestamp, queries},
    wealth::SyncerId,
};

pub async fn balance_sync_schedule_due(pool: &SqlitePool, id: SyncerId, now: DateTime<Utc>) -> Result<Option<String>> {
    let id = id.to_string();
    queries::balance_sync_schedule_due_opt(
        pool,
        queries::BalanceSyncScheduleDueParams {
            now: Some(Timestamp::from(now)),
            id: &id,
            due_only: true,
        },
    )
    .await
    .context("read balance sync schedule due")
    .map(|schedule| schedule.map(|schedule| schedule.balance_sync_cron))
}

pub async fn balance_sync_schedule_cron(pool: &SqlitePool, id: SyncerId) -> Result<Option<String>> {
    let id = id.to_string();
    queries::balance_sync_schedule_due_opt(
        pool,
        queries::BalanceSyncScheduleDueParams {
            id: &id,
            due_only: false,
            ..Default::default()
        },
    )
    .await
    .context("read balance sync schedule cron")
    .map(|schedule| schedule.map(|schedule| schedule.balance_sync_cron))
}

pub async fn set_balance_sync_schedule_synced(
    pool: &SqlitePool,
    id: SyncerId,
    next_balance_sync_at: DateTime<Utc>,
) -> Result<()> {
    let id = id.to_string();
    queries::set_balance_sync_schedule_synced(
        pool,
        queries::SetBalanceSyncScheduleSyncedParams {
            next_balance_sync_at: Some(Timestamp::from(next_balance_sync_at)),
            id: &id,
        },
    )
    .await
    .context("set balance sync schedule synced")
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use chrono::{TimeZone, Utc};

    use super::{balance_sync_schedule_cron, balance_sync_schedule_due, set_balance_sync_schedule_synced};
    use crate::{database::dbtest, wealth::SyncerId};

    #[tokio::test]
    async fn reads_and_updates_balance_sync_schedules() -> Result<()> {
        let pool = dbtest::open().await?;
        sqlx::query(
            "INSERT OR REPLACE INTO balance_sync_schedules (id, balance_sync_cron, next_balance_sync_at) VALUES ('plaid', '* * * * *', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await?;
        let now = Utc.with_ymd_and_hms(2026, 1, 2, 0, 0, 0).unwrap();

        assert_eq!(
            balance_sync_schedule_due(&pool, SyncerId::Plaid, now).await?,
            Some("* * * * *".to_owned())
        );
        assert_eq!(
            balance_sync_schedule_cron(&pool, SyncerId::Plaid).await?,
            Some("* * * * *".to_owned())
        );

        set_balance_sync_schedule_synced(
            &pool,
            SyncerId::Plaid,
            Utc.with_ymd_and_hms(2026, 1, 3, 0, 0, 0).unwrap(),
        )
        .await?;
        assert_eq!(balance_sync_schedule_due(&pool, SyncerId::Plaid, now).await?, None);
        Ok(())
    }
}
