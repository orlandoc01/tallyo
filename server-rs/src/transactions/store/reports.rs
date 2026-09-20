use std::collections::HashMap;

use anyhow::Result;
use chrono_tz::Tz;
use sqlx::SqlitePool;

use crate::{
    apierror::ApiError,
    database::{Timestamp, queries},
    ids::GlobalIdType,
    money::Cents,
    schema::{Granularity, SpendingFilter},
    transactions::{
        Category, CategorySpendingAggregate, CategorySpendingPeriod, SpendingAggregatePeriod, SpendingByCategoryReport,
        SpendingMode, SpendingRow,
    },
};

use super::{
    mapping::category_from_row,
    query::{local_ids, option_slice},
    report_periods::{Period, period_count, period_for, report_periods},
};

const MAX_SPENDING_PERIODS: usize = 400;
const REQUIRED_DATE_RANGE: &str = "datetimeRange.from and datetimeRange.to are required";

pub async fn spending_rows(
    pool: &SqlitePool,
    filter: &SpendingFilter,
    mode: SpendingMode,
    timezone: Tz,
) -> Result<Vec<SpendingRow>> {
    let values = SpendingValues::new(filter)?;
    validate_period_count(&values, filter.granularity, timezone)?;
    let rows = queries::spending_transactions(pool, values.params(mode.exclude_income)).await?;
    Ok(aggregate_rows(rows, filter.granularity, timezone, mode.by_category))
}

pub async fn spending_by_category(
    pool: &SqlitePool,
    filter: &SpendingFilter,
    timezone: Tz,
) -> Result<SpendingByCategoryReport> {
    let values = SpendingValues::new(filter)?;
    validate_period_count(&values, filter.granularity, timezone)?;
    let (rows, categories) = tokio::try_join!(
        queries::spending_transactions(pool, values.params(true)),
        queries::list_categories(
            pool,
            queries::ListCategoriesParams {
                category_ids: option_slice(&values.category_ids),
                expense_only: true,
                group_order: true,
                ..Default::default()
            }
        )
    )?;
    build_spending_report(
        rows,
        categories.into_iter().map(Into::into).collect(),
        &values,
        filter.granularity,
        timezone,
    )
}

struct SpendingValues {
    from: Timestamp,
    to: Timestamp,
    category_ids: Vec<i64>,
    owner_ids: Vec<i64>,
    account_ids: Vec<i64>,
    tag_ids: Vec<i64>,
    is_hidden: bool,
    untagged: bool,
}

impl SpendingValues {
    fn new(filter: &SpendingFilter) -> Result<Self> {
        let (Some(from), Some(to)) = (filter.datetime_range.from, filter.datetime_range.to) else {
            return Err(ApiError::bad_input(REQUIRED_DATE_RANGE).into());
        };
        Ok(Self {
            from: from.into(),
            to: to.into(),
            category_ids: local_ids(filter.category_ids.as_deref(), GlobalIdType::Category)?,
            owner_ids: local_ids(filter.owner_ids.as_deref(), GlobalIdType::Owner)?,
            account_ids: local_ids(filter.account_ids.as_deref(), GlobalIdType::Account)?,
            tag_ids: local_ids(filter.tag_ids.as_deref(), GlobalIdType::Tag)?,
            is_hidden: filter.is_hidden.unwrap_or(false),
            untagged: filter.untagged.unwrap_or(false),
        })
    }

    fn params(&self, exclude_income: bool) -> queries::SpendingTransactionsParams<'_> {
        queries::SpendingTransactionsParams {
            datetime_from: self.from,
            datetime_to: self.to,
            is_hidden: self.is_hidden,
            category_ids: option_slice(&self.category_ids),
            tag_ids: option_slice(&self.tag_ids),
            owner_ids: option_slice(&self.owner_ids),
            account_ids: option_slice(&self.account_ids),
            exclude_income,
            untagged: self.untagged,
        }
    }
}

fn aggregate_rows(
    rows: Vec<queries::SpendingTransactionsRow>,
    granularity: Option<Granularity>,
    timezone: Tz,
    by_category: bool,
) -> Vec<SpendingRow> {
    rows.into_iter().fold(Vec::new(), |mut aggregates, row| {
        let category = by_category.then(|| category_from_row(row.category_rows));
        let Period {
            label: period_label,
            start: period_start,
            end: period_end,
        } = period_for(
            row.datetime.into(),
            granularity.unwrap_or(Granularity::Monthly),
            timezone,
        );
        let index = aggregates
            .iter()
            .position(|aggregate| {
                aggregate.period_label == period_label
                    && (!by_category
                        || aggregate.category.as_ref().map(|category| category.id)
                            == category.as_ref().map(|category| category.id))
            })
            .unwrap_or_else(|| {
                aggregates.push(SpendingRow {
                    period_label: period_label.clone(),
                    period_start,
                    period_end,
                    category: category.clone(),
                    total_amount: Cents::default(),
                    transaction_count: 0,
                });
                aggregates.len() - 1
            });
        let aggregate = &mut aggregates[index];
        aggregate.total_amount += row.amount_cents;
        aggregate.transaction_count += 1;
        aggregates
    })
}

fn build_spending_report(
    rows: Vec<queries::SpendingTransactionsRow>,
    categories: Vec<Category>,
    values: &SpendingValues,
    granularity: Option<Granularity>,
    timezone: Tz,
) -> Result<SpendingByCategoryReport> {
    let periods = report_periods(values.from.into(), values.to.into(), granularity, timezone);
    let period_indexes = periods
        .iter()
        .enumerate()
        .map(|(index, period)| (period.period_label.clone(), index))
        .collect::<HashMap<_, _>>();
    let category_periods = periods.iter().cloned().map(category_period).collect::<Vec<_>>();
    let mut report = SpendingByCategoryReport {
        total_amount: Cents::default(),
        transaction_count: 0,
        periods,
        categories: categories
            .into_iter()
            .map(|category| CategorySpendingAggregate {
                category,
                total_amount: Cents::default(),
                transaction_count: 0,
                percent_of_total: 0.0,
                periods: category_periods.clone(),
            })
            .collect(),
    };
    let mut category_indexes = report
        .categories
        .iter()
        .enumerate()
        .map(|(index, category)| (category.category.id, index))
        .collect::<HashMap<_, _>>();
    for row in rows {
        let queries::SpendingTransactionsRow {
            amount_cents,
            datetime,
            category_rows,
        } = row;
        report.total_amount += amount_cents;
        report.transaction_count += 1;
        let category_id = category_rows.cat_id;
        let category_index = match category_indexes.get(&category_id) {
            Some(index) => *index,
            None => {
                let index = report.categories.len();
                report.categories.push(CategorySpendingAggregate {
                    category: category_from_row(category_rows),
                    total_amount: Cents::default(),
                    transaction_count: 0,
                    percent_of_total: 0.0,
                    periods: category_periods.clone(),
                });
                category_indexes.insert(category_id, index);
                index
            }
        };
        let category = &mut report.categories[category_index];
        category.total_amount += amount_cents;
        category.transaction_count += 1;
        if let Some(granularity) = granularity {
            let Period { label, .. } = period_for(datetime.into(), granularity, timezone);
            if let Some(period) = period_indexes
                .get(&label)
                .and_then(|index| report.periods.get_mut(*index))
            {
                period.total_amount += amount_cents;
                period.transaction_count += 1;
            }
            if let Some(period) = category.periods.iter_mut().find(|period| period.period_label == label) {
                period.total_amount += amount_cents;
                period.transaction_count += 1;
            }
        }
    }
    for category in &mut report.categories {
        category.percent_of_total = percentage(category.total_amount, report.total_amount);
        for period in &mut category.periods {
            period.percent_of_total = period_indexes
                .get(&period.period_label)
                .and_then(|index| report.periods.get(*index))
                .map_or(0.0, |total| percentage(period.total_amount, total.total_amount));
        }
    }
    Ok(report)
}

fn validate_period_count(values: &SpendingValues, granularity: Option<Granularity>, timezone: Tz) -> Result<()> {
    if period_count(
        values.from.into(),
        values.to.into(),
        granularity,
        timezone,
        MAX_SPENDING_PERIODS,
    ) <= MAX_SPENDING_PERIODS
    {
        return Ok(());
    }
    Err(ApiError::bad_input(format!(
        "spending report supports at most {MAX_SPENDING_PERIODS} periods"
    ))
    .into())
}

fn category_period(period: SpendingAggregatePeriod) -> CategorySpendingPeriod {
    CategorySpendingPeriod {
        period_label: period.period_label,
        period_start: period.period_start,
        period_end: period.period_end,
        total_amount: Cents::default(),
        transaction_count: 0,
        percent_of_total: 0.0,
    }
}

fn percentage(value: Cents, total: Cents) -> f64 {
    if total.0 == 0 { 0.0 } else { value.0 as f64 / total.0 as f64 * 100.0 }
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use chrono::{DateTime, Utc};

    use super::*;

    fn utc(value: &str) -> DateTime<Utc> {
        value.parse().expect("valid timestamp")
    }

    fn values() -> SpendingValues {
        SpendingValues {
            from: utc("2026-01-01T00:00:00Z").into(),
            to: utc("2026-02-01T00:00:00Z").into(),
            category_ids: Vec::new(),
            owner_ids: Vec::new(),
            account_ids: Vec::new(),
            tag_ids: Vec::new(),
            is_hidden: false,
            untagged: false,
        }
    }

    #[test]
    fn rejects_reports_with_more_than_four_hundred_periods() {
        let values = SpendingValues {
            from: utc("2020-01-01T00:00:00Z").into(),
            to: utc("2030-01-01T00:00:00Z").into(),
            ..values()
        };
        let error = validate_period_count(&values, Some(Granularity::Daily), chrono_tz::UTC).unwrap_err();
        assert_eq!(error.to_string(), "spending report supports at most 400 periods");
    }

    #[test]
    fn discovers_categories_missing_from_the_seeded_category_list() -> Result<()> {
        let report = build_spending_report(
            vec![queries::SpendingTransactionsRow {
                amount_cents: Cents(123),
                datetime: utc("2026-01-15T12:00:00Z").into(),
                category_rows: queries::CategoryRows {
                    cat_id: 42,
                    cat_name: "Food".into(),
                    cat_emoji: "*".into(),
                    group_name: "Essentials".into(),
                    group_emoji: "*".into(),
                    group_kind: "EXPENSE".into(),
                    sort_order: 1,
                    group_id: 7,
                    group_sort_order: 1,
                    plaid_pfc_2_codes: String::new(),
                },
            }],
            Vec::new(),
            &values(),
            Some(Granularity::Monthly),
            chrono_tz::UTC,
        )?;
        assert_eq!(
            (
                report.total_amount,
                report.transaction_count,
                report.periods[0].total_amount
            ),
            (Cents(123), 1, Cents(123))
        );
        assert_eq!(
            (
                report.categories[0].category.id,
                report.categories[0].total_amount,
                report.categories[0].periods[0].total_amount,
            ),
            (42, Cents(123), Cents(123))
        );
        Ok(())
    }

    #[tokio::test]
    async fn spending_reports_exclude_income_and_filter_hidden_transactions() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        let account_id = crate::testutil::transactions::account(&pool, "report-account").await?;
        let expense =
            crate::testutil::transactions::category(&pool, "Report expense", crate::schema::CategoryKind::Expense)
                .await?;
        let income =
            crate::testutil::transactions::category(&pool, "Report income", crate::schema::CategoryKind::Income)
                .await?;
        crate::testutil::transactions::transaction(
            &pool,
            "visible expense",
            account_id,
            expense.id,
            Cents(250),
            utc("2026-01-03T12:00:00Z"),
        )
        .await?;
        let hidden_id = crate::testutil::transactions::transaction(
            &pool,
            "hidden expense",
            account_id,
            expense.id,
            Cents(100),
            utc("2026-01-04T12:00:00Z"),
        )
        .await?;
        crate::transactions::store::update_transaction(
            &pool,
            hidden_id,
            &crate::schema::TransactionUpdates {
                merchant_name: None,
                notes: None,
                is_recurring: None,
                is_hidden: Some(true),
                category_id: None,
                tag_ids: None,
            },
        )
        .await?;
        crate::testutil::transactions::transaction(
            &pool,
            "income",
            account_id,
            income.id,
            Cents(-1000),
            utc("2026-01-05T12:00:00Z"),
        )
        .await?;
        let filter = crate::schema::SpendingFilter {
            datetime_range: crate::schema::DateTimeRange {
                from: Some(utc("2026-01-01T00:00:00Z")),
                to: Some(utc("2026-02-01T00:00:00Z")),
            },
            granularity: Some(Granularity::Monthly),
            category_ids: None,
            owner_ids: None,
            account_ids: None,
            is_hidden: None,
            tag_ids: None,
            untagged: None,
        };
        let visible = spending_by_category(&pool, &filter, chrono_tz::UTC).await?;
        assert_eq!((visible.total_amount, visible.transaction_count), (Cents(250), 1));
        let hidden = spending_by_category(
            &pool,
            &crate::schema::SpendingFilter {
                is_hidden: Some(true),
                ..filter
            },
            chrono_tz::UTC,
        )
        .await?;
        assert_eq!((hidden.total_amount, hidden.transaction_count), (Cents(100), 1));
        Ok(())
    }
}
