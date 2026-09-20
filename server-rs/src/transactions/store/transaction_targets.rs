use anyhow::Result;
use sqlx::SqlitePool;

use crate::{
    apierror::ApiError,
    database::queries,
    ids::{GlobalId, GlobalIdType},
    schema::TransactionsFilter,
    transactions::Transaction,
};

use super::query::FilterValues;

const BULK_TARGET_REQUIRED: &str = "exactly one of transactionIds or filter is required";

pub(super) async fn resolve_bulk_target_ids(
    pool: &SqlitePool,
    transaction_ids: Option<&[GlobalId]>,
    filter: Option<&TransactionsFilter>,
) -> Result<Vec<i64>> {
    let filter_values = FilterValues::from_filter(filter, Vec::new())?;
    let ids = transaction_ids
        .unwrap_or_default()
        .iter()
        .copied()
        .map(|id| id.i64_of_type(GlobalIdType::Transaction))
        .collect::<Result<Vec<_>>>()?;
    anyhow::ensure!(
        !ids.is_empty() != filter_values.has_criteria(),
        ApiError::bad_input(BULK_TARGET_REQUIRED)
    );
    let values = if filter_values.has_criteria() { filter_values } else { FilterValues::from_filter(filter, ids)? };
    queries::transaction_ids_by_filter(pool, values.ids_params())
        .await
        .map(|rows| rows.into_iter().map(|row| row.id).collect())
        .map_err(Into::into)
}

pub(super) async fn transactions_by_ids(pool: &SqlitePool, ids: &[i64]) -> Result<Vec<Transaction>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let values = FilterValues::from_filter(None, ids.to_vec())?;
    queries::transaction_records(pool, values.records_params(None, None, false, -1))
        .await
        .map(|rows| rows.into_iter().map(Into::into).collect())
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::*;
    use crate::{
        ids::{GlobalId, GlobalIdType},
        money::Cents,
        testutil::transactions::{account, transaction},
    };

    fn filter(search: Option<&str>) -> TransactionsFilter {
        TransactionsFilter {
            datetime_range: None,
            category_ids: None,
            account_ids: None,
            owner_ids: None,
            is_reviewed: None,
            is_recurring: None,
            is_pending: None,
            is_hidden: None,
            merchant_prefix: None,
            original_prefix: None,
            exclude_transfers: None,
            exclude_income: None,
            amount_min: None,
            amount_max: None,
            exact_amount: None,
            tag_ids: None,
            untagged: None,
            search: search.map(str::to_owned),
        }
    }

    #[tokio::test]
    async fn resolves_exactly_one_bulk_target_and_hydrates_transactions() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        let account_id = account(&pool, "target-account").await?;
        let transaction_id = transaction(
            &pool,
            "target merchant",
            account_id,
            0,
            Cents(100),
            "2026-01-01T12:00:00Z".parse()?,
        )
        .await?;
        let ids = [GlobalId::new(GlobalIdType::Transaction, transaction_id)];
        assert_eq!(
            resolve_bulk_target_ids(&pool, Some(&ids), None).await?,
            [transaction_id]
        );
        assert_eq!(
            resolve_bulk_target_ids(&pool, None, Some(&filter(Some("target")))).await?,
            [transaction_id]
        );
        assert_eq!(transactions_by_ids(&pool, &[]).await?, Vec::new());
        assert_eq!(
            transactions_by_ids(&pool, &[transaction_id]).await?[0].id,
            transaction_id
        );
        assert_eq!(
            resolve_bulk_target_ids(&pool, None, None)
                .await
                .unwrap_err()
                .to_string(),
            BULK_TARGET_REQUIRED
        );
        assert_eq!(
            resolve_bulk_target_ids(&pool, Some(&ids), Some(&filter(Some("target"))))
                .await
                .unwrap_err()
                .to_string(),
            BULK_TARGET_REQUIRED
        );
        assert!(
            resolve_bulk_target_ids(&pool, Some(&[GlobalId::new(GlobalIdType::Account, account_id)]), None,)
                .await
                .is_err()
        );
        Ok(())
    }
}
