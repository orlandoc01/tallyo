use anyhow::{Context, Result, anyhow};
use chrono::{DateTime, TimeZone, Utc};
use serde_json::to_string;
use sqlx::SqlitePool;

use crate::{
    clients::simplefin::SimpleFinTransaction,
    money::Cents,
    transactions::{SyncedTransaction, TransactionSource, store::simplefin_sync},
};

const INITIAL_LOOKBACK_DAYS: i64 = 89;

pub(super) fn start_date(last_synced_at: Option<DateTime<Utc>>, now: DateTime<Utc>) -> DateTime<Utc> {
    let days = if last_synced_at.is_some() { 14 } else { INITIAL_LOOKBACK_DAYS };
    last_synced_at.unwrap_or(now) - chrono::Duration::days(days)
}

pub(super) fn transaction_from_simple_fin(
    account_id: &str,
    transaction: SimpleFinTransaction,
    hidden: bool,
) -> Result<SyncedTransaction> {
    let amount = -Cents::parse_decimal(transaction.amount.trim())
        .with_context(|| format!("parse simplefin amount {:?}", transaction.amount))?;
    let datetime = Utc
        .timestamp_opt(transaction.transacted_at, 0)
        .single()
        .ok_or_else(|| anyhow!("invalid simplefin transaction timestamp {}", transaction.transacted_at))?;
    let posted = if transaction.posted == 0 { transaction.transacted_at } else { transaction.posted };
    let posted_datetime = Utc
        .timestamp_opt(posted, 0)
        .single()
        .ok_or_else(|| anyhow!("invalid simplefin transaction timestamp {posted}"))?;
    let merchant = non_empty(&transaction.payee).or_else(|| non_empty(&transaction.description));
    Ok(SyncedTransaction {
        external_id: transaction.id.clone(),
        account_id: account_id.to_owned(),
        amount,
        datetime,
        posted_datetime,
        merchant_name: merchant,
        original_name: non_empty(&transaction.description),
        logo_url: None,
        plaid_category: None,
        raw_provider_json: Some(
            to_string(&transaction).with_context(|| format!("marshal simplefin transaction {}", transaction.id))?,
        ),
        source: TransactionSource::Simplefin,
        pending: transaction.pending || transaction.posted == 0,
        hidden_by_account: hidden,
        stage_for_llm: false,
    })
}

pub(super) async fn log_sync(
    pool: &SqlitePool,
    token_id: i64,
    start_date: DateTime<Utc>,
    fetched_ids: &[String],
    removed_ids: &[String],
    error: Option<&anyhow::Error>,
) -> Result<()> {
    let start_date = start_date.timestamp().to_string();
    let fetched_ids = to_string(fetched_ids)?;
    let removed_ids = to_string(removed_ids)?;
    let error_message = error.map(ToString::to_string);
    simplefin_sync::log_simple_fin_sync_batch(
        pool,
        crate::database::queries::LogSimpleFinSyncBatchParams {
            access_token_id: token_id,
            start_date: Some(&start_date),
            added: "[]",
            modified: &fetched_ids,
            pending_removed: &removed_ids,
            error: error_message.as_deref(),
        },
    )
    .await
}

pub(super) async fn log_fetch_error(
    pool: &SqlitePool,
    token_id: i64,
    start_date: DateTime<Utc>,
    error: &anyhow::Error,
) {
    if let Err(log_error) = log_sync(pool, token_id, start_date, &[], &[], Some(error)).await {
        tracing::warn!(token_id, %log_error, "log simplefin sync");
    }
}

fn non_empty(value: &str) -> Option<String> {
    (!value.trim().is_empty()).then(|| value.trim().to_owned())
}

#[cfg(test)]
mod tests {
    use anyhow::{Result, anyhow};
    use chrono::{TimeZone, Utc};

    use super::{log_sync, start_date, transaction_from_simple_fin};
    use crate::{
        accounts::store::create_simple_fin_access_token, clients::simplefin::SimpleFinTransaction, database::dbtest,
        testutil::store::create_owner,
    };

    #[test]
    fn applies_simplefin_lookbacks_and_sign_conventions() {
        let now = Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap();
        assert_eq!(
            start_date(None, now),
            Utc.with_ymd_and_hms(2026, 6, 9, 12, 0, 0).unwrap()
        );
        assert_eq!(
            start_date(Some(now), now),
            Utc.with_ymd_and_hms(2026, 8, 23, 12, 0, 0).unwrap()
        );
        let transaction = transaction_from_simple_fin(
            "account",
            SimpleFinTransaction {
                id: "transaction".to_owned(),
                amount: "12.34".to_owned(),
                transacted_at: now.timestamp(),
                description: "Coffee".to_owned(),
                pending: true,
                ..Default::default()
            },
            true,
        )
        .unwrap();
        assert_eq!(transaction.amount.0, -1234);
        assert_eq!(transaction.merchant_name.as_deref(), Some("Coffee"));
        assert!(transaction.pending);
        assert!(transaction.hidden_by_account);
    }

    #[test]
    fn preserves_simplefin_provider_fields_and_posted_fallback() -> Result<()> {
        let transaction = transaction_from_simple_fin(
            "account",
            SimpleFinTransaction {
                id: "transaction".to_owned(),
                amount: "12.34".to_owned(),
                transacted_at: 1_778_000_000,
                posted: 0,
                description: "Original description".to_owned(),
                payee: "Merchant".to_owned(),
                ..Default::default()
            },
            false,
        )?;
        assert_eq!(transaction.merchant_name.as_deref(), Some("Merchant"));
        assert_eq!(transaction.original_name.as_deref(), Some("Original description"));
        assert_eq!(transaction.posted_datetime, transaction.datetime);
        assert!(transaction.raw_provider_json.unwrap().contains("Original description"));
        assert!(transaction_from_simple_fin("account", SimpleFinTransaction::default(), false).is_err());
        Ok(())
    }

    #[tokio::test]
    async fn logs_simplefin_sync_batches_with_ids_and_errors() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "Owner").await?;
        let token = create_simple_fin_access_token(&pool, "https://bridge.example", owner.id, "Bridge").await?;
        let error = anyhow!("persist failed");

        log_sync(
            &pool,
            token.id,
            Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
            &["fetched".to_owned()],
            &["removed".to_owned()],
            Some(&error),
        )
        .await?;

        assert_eq!(
            sqlx::query_as::<_, (String, String, Option<String>)>(
                "SELECT modified, pending_removed, error FROM simplefin_sync_log WHERE access_token_id = ?",
            )
            .bind(token.id)
            .fetch_one(&pool)
            .await?,
            (
                "[\"fetched\"]".to_owned(),
                "[\"removed\"]".to_owned(),
                Some("persist failed".to_owned())
            )
        );
        Ok(())
    }
}
