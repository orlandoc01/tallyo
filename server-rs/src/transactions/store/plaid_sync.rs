use anyhow::Result;
use chrono::{DateTime, Duration, NaiveDate, NaiveTime, Utc};
use sqlx::{Executor, Sqlite};

use crate::{database::queries, transactions::SyncBatchLog};

pub(crate) async fn plaid_transaction_ids_in_window(
    executor: impl Executor<'_, Database = Sqlite>,
    account_external_ids: &[String],
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<Vec<String>> {
    queries::plaid_transaction_ids_in_window(
        executor,
        queries::PlaidTransactionIDsInWindowParams {
            account_external_ids,
            datetime_from: start_date.and_time(NaiveTime::MIN).and_utc().into(),
            datetime_to: (end_date + Duration::days(1)).and_time(NaiveTime::MIN).and_utc().into(),
        },
    )
    .await
    .map(|rows| rows.into_iter().map(|row| row.external_id).collect())
    .map_err(Into::into)
}

pub(crate) async fn sync_cursor(executor: impl Executor<'_, Database = Sqlite>, item_id: i64) -> Result<String> {
    queries::sync_cursor_opt(executor, queries::SyncCursorParams { id: item_id })
        .await
        .map(|row| row.and_then(|row| row.cursor).unwrap_or_default())
        .map_err(Into::into)
}

pub(crate) async fn set_sync_cursor(
    executor: impl Executor<'_, Database = Sqlite>,
    item_id: i64,
    cursor: Option<&str>,
    next_sync_at: DateTime<Utc>,
) -> Result<()> {
    queries::set_sync_cursor(
        executor,
        queries::SetSyncCursorParams {
            set_cursor: cursor.is_some(),
            cursor,
            next_sync_at: Some(next_sync_at.into()),
            id: item_id,
        },
    )
    .await
    .map_err(Into::into)
}

pub(crate) async fn log_sync_batch(executor: impl Executor<'_, Database = Sqlite>, batch: &SyncBatchLog) -> Result<()> {
    let api = batch.api.to_string();
    queries::log_sync_batch(
        executor,
        queries::LogSyncBatchParams {
            item_id: batch.item_id,
            api: &api,
            added: &batch.added,
            modified: &batch.modified,
            removed: &batch.removed,
        },
    )
    .await
    .map_err(Into::into)
}

pub(crate) async fn set_item_recurring_synced(
    executor: impl Executor<'_, Database = Sqlite>,
    item_id: i64,
    next_recurring_sync_at: DateTime<Utc>,
) -> Result<()> {
    queries::set_item_recurring_synced(
        executor,
        queries::SetItemRecurringSyncedParams {
            next_recurring_sync_at: Some(next_recurring_sync_at.into()),
            id: item_id,
        },
    )
    .await
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use chrono::{DateTime, Utc};

    use super::*;
    use crate::{
        accounts::store::plaid_item_secret_by_id,
        money::Cents,
        testutil::{
            store::{create_owner, seed_plaid_account, seed_plaid_item},
            transactions,
        },
        transactions::SyncBatchApi,
    };

    #[tokio::test]
    async fn finds_plaid_transactions_inside_a_half_open_day_window() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        let owner = create_owner(&pool, "Alex").await?;
        let (_, connection) = seed_plaid_item(&pool, &owner, "item").await?;
        let account_id = seed_plaid_account(&pool, &owner, &connection, "invest").await?;
        for (external_id, datetime) in [
            ("before", "2026-06-06T23:59:59Z"),
            ("start", "2026-06-07T00:00:00Z"),
            ("end", "2026-06-20T23:59:59Z"),
            ("after", "2026-06-21T00:00:00Z"),
        ] {
            transactions::transaction(&pool, external_id, account_id, 0, Cents(1), datetime.parse()?).await?;
        }
        sqlx::query("UPDATE transactions SET source = 'plaid' WHERE external_id <> 'end'")
            .execute(&pool)
            .await?;
        let start = NaiveDate::from_ymd_opt(2026, 6, 7).expect("valid date");
        let end = NaiveDate::from_ymd_opt(2026, 6, 20).expect("valid date");

        assert_eq!(
            plaid_transaction_ids_in_window(&pool, &["invest".to_owned()], start, end).await?,
            ["start"]
        );
        sqlx::query("UPDATE transactions SET source = 'plaid'")
            .execute(&pool)
            .await?;
        assert_eq!(
            plaid_transaction_ids_in_window(&pool, &["invest".to_owned()], start, end).await?,
            ["start", "end"]
        );
        assert!(
            plaid_transaction_ids_in_window(&pool, &["other".to_owned()], start, end)
                .await?
                .is_empty()
        );
        Ok(())
    }

    #[tokio::test]
    async fn updates_sync_state_and_writes_batch_logs() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        let owner = create_owner(&pool, "Alex").await?;
        let (item_id, _) = seed_plaid_item(&pool, &owner, "item").await?;
        let timestamp = "2026-09-06T12:00:00Z".parse::<DateTime<Utc>>()?;

        assert_eq!(sync_cursor(&pool, item_id).await?, "");
        set_sync_cursor(&pool, item_id, Some("cursor"), timestamp).await?;
        assert_eq!(sync_cursor(&pool, item_id).await?, "cursor");
        set_sync_cursor(&pool, item_id, None, timestamp).await?;
        assert_eq!(sync_cursor(&pool, item_id).await?, "cursor");
        set_item_recurring_synced(&pool, item_id, timestamp).await?;
        log_sync_batch(
            &pool,
            &SyncBatchLog {
                item_id,
                api: SyncBatchApi::Transactions,
                added: "[]".to_owned(),
                modified: "[]".to_owned(),
                removed: "[]".to_owned(),
            },
        )
        .await?;

        let item = plaid_item_secret_by_id(&pool, item_id, crate::accounts::PlaidSyncKind::Sync)
            .await?
            .expect("item exists");
        assert_eq!(item.next_sync_at(), Some(timestamp));
        assert_eq!(item.next_recurring_sync_at(), Some(timestamp));
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM plaid_sync_log")
                .fetch_one(&pool)
                .await?,
            1
        );
        Ok(())
    }
}
