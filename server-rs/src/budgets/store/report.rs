use std::collections::HashMap;

use anyhow::Result;
use sqlx::{Executor, Sqlite};

use crate::{budgets::BudgetEntry, database::queries};

pub async fn budgets_in_range(
    executor: impl Executor<'_, Database = Sqlite>,
    start_month: Option<&str>,
    end_month: Option<&str>,
) -> Result<HashMap<String, HashMap<i64, BudgetEntry>>> {
    queries::budgets_in_range(executor, queries::BudgetsInRangeParams { start_month, end_month })
        .await
        .map(|rows| {
            rows.into_iter().fold(
                HashMap::<String, HashMap<i64, BudgetEntry>>::new(),
                |mut by_month, row| {
                    by_month.entry(row.month).or_default().insert(
                        row.category_id,
                        BudgetEntry {
                            id: row.id,
                            amount: row.amount_cents,
                        },
                    );
                    by_month
                },
            )
        })
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::*;
    use crate::{
        budgets::store::{copy_budgets, upsert_budget},
        money::Cents,
        schema::CategoryKind,
        testutil::transactions::category,
    };

    #[tokio::test]
    async fn copies_only_missing_budgets_and_filters_history() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        let first = category(&pool, "First budget", CategoryKind::Expense).await?;
        let second = category(&pool, "Second budget", CategoryKind::Expense).await?;
        upsert_budget(&pool, "2026-05", first.id, Cents(100)).await?;
        upsert_budget(&pool, "2026-05", second.id, Cents(200)).await?;
        upsert_budget(&pool, "2026-06", first.id, Cents(300)).await?;

        assert_eq!(copy_budgets(&pool, "2026-05", "2026-06").await?, 1);
        let all = budgets_in_range(&pool, None, None).await?;
        assert_eq!(all.len(), 2);
        assert_eq!(all["2026-06"][&first.id].amount, Cents(300));
        assert_eq!(all["2026-06"][&second.id].amount, Cents(200));
        assert_eq!(all["2026-05"][&first.id].amount, Cents(100));
        assert_eq!(all["2026-05"][&second.id].amount, Cents(200));
        assert_eq!(
            budgets_in_range(&pool, Some("2026-06"), Some("2026-07")).await?.len(),
            1
        );
        assert!(
            budgets_in_range(&pool, Some("2099-01"), Some("2099-02"))
                .await?
                .is_empty()
        );
        Ok(())
    }
}
