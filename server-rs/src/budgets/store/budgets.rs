use anyhow::Result;
use sqlx::{Executor, Sqlite};

use crate::{budgets::Budget, database::queries, money::Cents};

pub async fn upsert_budget(
    executor: impl Executor<'_, Database = Sqlite>,
    month: &str,
    category_id: i64,
    amount: Cents,
) -> Result<i64> {
    queries::upsert_budget(
        executor,
        queries::UpsertBudgetParams {
            month,
            category_id,
            amount_cents: amount,
        },
    )
    .await
    .map(|row| row.id)
    .map_err(Into::into)
}

pub async fn delete_budget(executor: impl Executor<'_, Database = Sqlite>, id: i64) -> Result<bool> {
    queries::delete_budget(executor, queries::DeleteBudgetParams { id })
        .await
        .map(|affected| affected > 0)
        .map_err(Into::into)
}

pub async fn budget_by_id(executor: impl Executor<'_, Database = Sqlite>, id: i64) -> Result<Option<Budget>> {
    queries::budget_by_id_opt(executor, queries::BudgetByIdParams { id })
        .await
        .map(|row| row.map(Into::into))
        .map_err(Into::into)
}

pub async fn copy_budgets(
    executor: impl Executor<'_, Database = Sqlite>,
    from_month: &str,
    to_month: &str,
) -> Result<i32> {
    queries::copy_budgets(executor, queries::CopyBudgetsParams { from_month, to_month })
        .await
        .map(|affected| affected as i32)
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::*;
    use crate::{money::Cents, schema::CategoryKind, testutil::transactions::category};

    #[tokio::test]
    async fn upserts_loads_and_deletes_budgets() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        let category = category(&pool, "Budget groceries", CategoryKind::Expense).await?;
        let id = upsert_budget(&pool, "2026-06", category.id, Cents(400)).await?;

        let updated_id = upsert_budget(&pool, "2026-06", category.id, Cents(450)).await?;
        assert_eq!(updated_id, id);
        assert_eq!(
            budget_by_id(&pool, id).await?,
            Some(Budget {
                id,
                month: "2026-06".into(),
                category,
                amount: Cents(450),
            })
        );
        assert_eq!(budget_by_id(&pool, 999_999).await?, None);
        assert!(delete_budget(&pool, id).await?);
        assert!(!delete_budget(&pool, id).await?);
        Ok(())
    }

    #[tokio::test]
    async fn rejects_unknown_categories() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;

        assert!(upsert_budget(&pool, "2026-06", 999_999, Cents(1)).await.is_err());
        Ok(())
    }
}
