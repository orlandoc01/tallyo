use std::collections::HashMap;

use anyhow::Result;
use chrono::{Duration, Months, NaiveDate};
use sqlx::{Executor, Sqlite, SqlitePool};

use crate::{
    database::queries,
    ids::Date,
    schema::{RecurrenceInterval, RecurringStreamStatus},
    transactions::RecurringCharge,
};

use super::{mapping::category_from_row, transaction_targets::transactions_by_ids};

pub async fn recurring_charges(pool: &SqlitePool) -> Result<Vec<RecurringCharge>> {
    charges(pool, None).await
}

pub async fn recurring_charge_by_id(pool: &SqlitePool, id: i64) -> Result<Option<RecurringCharge>> {
    charges(pool, Some(id)).await.map(|mut charges| charges.pop())
}

async fn charges(pool: &SqlitePool, id: Option<i64>) -> Result<Vec<RecurringCharge>> {
    let rows = queries::list_recurring_charges(pool, queries::ListRecurringChargesParams { id }).await?;
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let charge_ids = rows.iter().map(|row| row.id).collect::<Vec<_>>();
    let transaction_ids_by_charge = transaction_ids_by_charge(pool, &charge_ids).await?;
    let transactions_by_id = transactions_by_ids(
        pool,
        &transaction_ids_by_charge
            .values()
            .flatten()
            .copied()
            .collect::<Vec<_>>(),
    )
    .await?
    .into_iter()
    .map(|transaction| (transaction.id, transaction))
    .collect::<HashMap<_, _>>();
    let categories_by_charge = categories_by_charge(pool, &charge_ids).await?;
    rows.into_iter()
        .map(|row| {
            let interval = interval(&row.frequency);
            let last_date = Date::new(&row.last_date)?;
            Ok(RecurringCharge {
                id: row.id,
                merchant_name: row
                    .merchant_name
                    .filter(|name| !name.is_empty())
                    .unwrap_or(row.description),
                estimated_amount: row.average_amount_cents,
                interval,
                category: categories_by_charge.get(&row.id).cloned(),
                transactions: transaction_ids_by_charge
                    .get(&row.id)
                    .into_iter()
                    .flatten()
                    .filter_map(|id| transactions_by_id.get(id).cloned())
                    .collect(),
                first_date: Date::new(&row.first_date)?,
                last_date: last_date.clone(),
                last_amount: row.last_amount_cents,
                is_user_modified: row.is_user_modified,
                next_expected_date: next_expected_date(&last_date, interval),
                status: status(&row.status),
                is_active: row.is_active,
            })
        })
        .collect()
}

async fn transaction_ids_by_charge(
    executor: impl Executor<'_, Database = Sqlite>,
    charge_ids: &[i64],
) -> Result<HashMap<i64, Vec<i64>>> {
    queries::recurring_charge_transaction_ids_by_charge_ids(
        executor,
        queries::RecurringChargeTransactionIDsByChargeIDsParams { charge_ids },
    )
    .await
    .map(|rows| {
        rows.into_iter()
            .fold(HashMap::<i64, Vec<i64>>::new(), |mut ids_by_charge, row| {
                ids_by_charge.entry(row.charge_id).or_default().push(row.transaction_id);
                ids_by_charge
            })
    })
    .map_err(Into::into)
}

async fn categories_by_charge(
    executor: impl Executor<'_, Database = Sqlite>,
    charge_ids: &[i64],
) -> Result<HashMap<i64, crate::transactions::Category>> {
    queries::majority_categories_for_recurring_charges(
        executor,
        queries::MajorityCategoriesForRecurringChargesParams { charge_ids },
    )
    .await
    .map(|rows| {
        rows.into_iter()
            .map(|row| (row.charge_id, category_from_row(row.category_rows)))
            .collect()
    })
    .map_err(Into::into)
}

fn interval(frequency: &str) -> Option<RecurrenceInterval> {
    match frequency {
        "WEEKLY" => Some(RecurrenceInterval::Weekly),
        "BIWEEKLY" | "SEMI_MONTHLY" => Some(RecurrenceInterval::Biweekly),
        "MONTHLY" => Some(RecurrenceInterval::Monthly),
        "ANNUALLY" => Some(RecurrenceInterval::Yearly),
        _ => None,
    }
}

fn next_expected_date(last_date: &Date, interval: Option<RecurrenceInterval>) -> Option<Date> {
    let date = NaiveDate::parse_from_str(last_date.as_str(), "%Y-%m-%d").ok()?;
    let next = match interval? {
        RecurrenceInterval::Weekly => date + Duration::days(7),
        RecurrenceInterval::Biweekly => date + Duration::days(14),
        RecurrenceInterval::Monthly => date.checked_add_months(Months::new(1))?,
        RecurrenceInterval::Quarterly => date.checked_add_months(Months::new(3))?,
        RecurrenceInterval::Yearly => date.checked_add_months(Months::new(12))?,
    };
    Date::new(next.to_string()).ok()
}

fn status(value: &str) -> RecurringStreamStatus {
    match value {
        "MATURE" => RecurringStreamStatus::Mature,
        "EARLY_DETECTION" => RecurringStreamStatus::EarlyDetection,
        "TOMBSTONED" => RecurringStreamStatus::Tombstoned,
        _ => RecurringStreamStatus::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::*;
    use crate::{
        database::queries,
        money::Cents,
        schema::CategoryKind,
        testutil::transactions::{account, category},
    };

    #[test]
    fn maps_recurring_intervals_statuses_and_expected_dates() -> Result<()> {
        let date = Date::new("2026-01-31")?;
        assert_eq!(interval("WEEKLY"), Some(RecurrenceInterval::Weekly));
        assert_eq!(interval("SEMI_MONTHLY"), Some(RecurrenceInterval::Biweekly));
        assert_eq!(interval("unknown"), None);
        assert_eq!(
            next_expected_date(&date, Some(RecurrenceInterval::Monthly)),
            Some(Date::new("2026-02-28")?)
        );
        assert!(Date::new("bad").is_err());
        assert_eq!(status("MATURE"), RecurringStreamStatus::Mature);
        assert_eq!(status("EARLY_DETECTION"), RecurringStreamStatus::EarlyDetection);
        assert_eq!(status("TOMBSTONED"), RecurringStreamStatus::Tombstoned);
        assert_eq!(status("unknown"), RecurringStreamStatus::Unknown);
        Ok(())
    }

    #[tokio::test]
    async fn hydrates_recurring_charges_with_transactions_and_categories() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        let account_id = account(&pool, "recurring-account").await?;
        let category = category(&pool, "Utilities", CategoryKind::Expense).await?;
        let transaction_id = queries::insert_transaction(
            &pool,
            queries::InsertTransactionParams {
                source: "plaid",
                external_id: "recurring-transaction",
                account_id,
                amount_cents: Cents(500),
                datetime: "2026-01-15T12:00:00Z".parse::<chrono::DateTime<chrono::Utc>>()?.into(),
                posted_datetime: "2026-01-15T12:00:00Z".parse::<chrono::DateTime<chrono::Utc>>()?.into(),
                merchant_name: None,
                original_name: Some("Power company"),
                category_id: category.id,
                is_reviewed: true,
                is_recurring: true,
                is_hidden: false,
                notes: None,
            },
        )
        .await?
        .id;
        let charge_id = queries::upsert_recurring_charge(
            &pool,
            queries::UpsertRecurringChargeParams {
                external_id: "charge",
                account_id,
                description: "Power company",
                merchant_name: Some(""),
                frequency: "MONTHLY",
                status: "MATURE",
                is_active: true,
                average_amount_cents: Cents(500),
                last_amount_cents: Cents(500),
                first_date: "2026-01-01",
                last_date: "2026-01-31",
                is_user_modified: true,
            },
        )
        .await?
        .id;
        queries::insert_recurring_charge_transactions(
            &pool,
            queries::InsertRecurringChargeTransactionsParams {
                charge_id,
                plaid_txn_ids: &["recurring-transaction".into()],
            },
        )
        .await?;

        let charge = recurring_charge_by_id(&pool, charge_id).await?.expect("charge exists");
        assert_eq!(charge.merchant_name, "Power company");
        assert_eq!(charge.category, Some(category));
        assert_eq!(charge.transactions[0].id, transaction_id);
        assert_eq!(charge.next_expected_date, Some(Date::new("2026-02-28")?));
        assert_eq!(recurring_charges(&pool).await?.len(), 1);
        assert_eq!(recurring_charge_by_id(&pool, 999).await?, None);
        Ok(())
    }
}
