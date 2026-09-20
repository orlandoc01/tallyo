use std::collections::HashMap;

use anyhow::{Context, Result};
use chrono::{DateTime, Months, TimeZone, Utc};
use chrono_tz::Tz;
use sqlx::SqlitePool;

use crate::{
    apierror::ApiError,
    budgets::{
        Budget, BudgetEntry, BudgetLine, BudgetReport, BudgetReportHistory, BudgetReportHistoryInput,
        BudgetReportInput, BudgetSection, CopyBudgetsInput, DeleteBudgetInput, SetBudgetInput, store,
    },
    database,
    ids::{GlobalId, GlobalIdType},
    money::Cents,
    schema::{CategoryKind, DateTimeRange, Granularity, SpendingFilter},
    transactions::{
        CategoryGroup, SpendingMode, SpendingRow,
        store::{category_by_id, category_groups, spending_rows},
    },
};

pub(super) const MAX_BUDGET_REPORT_HISTORY_MONTHS: usize = 120;

pub async fn set_budget(pool: &SqlitePool, input: SetBudgetInput) -> Result<Budget> {
    validate_month(&input.month).map_err(ApiError::public)?;
    anyhow::ensure!(
        input.amount >= Cents::default(),
        ApiError::bad_input("budget amount must be non-negative")
    );
    let category_id = GlobalId::decode(input.category_id.as_str())?.i64_of_type(GlobalIdType::Category)?;
    let month = input.month;
    let amount = input.amount;

    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let category = category_by_id(&mut **transaction, category_id)
                .await
                .context("load budget category")?
                .ok_or_else(|| ApiError::bad_input(format!("category {category_id} not found")))?;
            let id = store::upsert_budget(&mut **transaction, &month, category_id, amount).await?;
            Ok(Budget {
                id,
                month,
                category,
                amount,
            })
        })
    })
    .await
}

pub async fn delete_budget(pool: &SqlitePool, input: DeleteBudgetInput) -> Result<bool> {
    let id = GlobalId::decode(input.id.as_str())?.i64_of_type(GlobalIdType::Budget)?;
    store::delete_budget(pool, id).await
}

pub async fn copy_budgets(pool: &SqlitePool, input: CopyBudgetsInput) -> Result<i32> {
    validate_month(&input.from_month).map_err(|error| ApiError::bad_input(format!("fromMonth: {error}")))?;
    validate_month(&input.to_month).map_err(|error| ApiError::bad_input(format!("toMonth: {error}")))?;
    anyhow::ensure!(
        input.from_month != input.to_month,
        ApiError::bad_input("fromMonth and toMonth must differ")
    );
    store::copy_budgets(pool, &input.from_month, &input.to_month).await
}

pub async fn budget_report(pool: &SqlitePool, input: BudgetReportInput, timezone: Tz) -> Result<BudgetReport> {
    validate_month(&input.month).map_err(ApiError::public)?;
    let (from, to) = month_range(&input.month, timezone)?;
    let actual = actual_amounts_by_category(pool, &input.month, spending_filter(from, to, None), timezone)
        .await
        .context("compute actual spend")?;
    let groups = category_groups(pool).await.context("load category groups")?;
    let end_month = to.with_timezone(&timezone).format("%Y-%m").to_string();
    let budgeted = store::budgets_in_range(pool, Some(&input.month), Some(&end_month))
        .await
        .context("load budgets")?
        .remove(&input.month)
        .unwrap_or_default();
    Ok(assemble_budget_report(&input.month, &groups, &budgeted, &actual))
}

pub async fn budget_report_history(
    pool: &SqlitePool,
    input: BudgetReportHistoryInput,
    timezone: Tz,
) -> Result<BudgetReportHistory> {
    validate_history_month("startMonth", input.start_month.as_deref())?;
    validate_history_month("endMonth", input.end_month.as_deref())?;
    if let (Some(start), Some(end)) = (input.start_month.as_deref(), input.end_month.as_deref()) {
        anyhow::ensure!(start < end, ApiError::bad_input("startMonth must be before endMonth"));
    }

    let budgeted_by_month = store::budgets_in_range(pool, input.start_month.as_deref(), input.end_month.as_deref())
        .await
        .context("load budgets")?;
    if budgeted_by_month.is_empty() {
        return Ok(BudgetReportHistory { items: Vec::new() });
    }

    let mut months = budgeted_by_month.keys().cloned().collect::<Vec<_>>();
    months.sort();
    anyhow::ensure!(
        months.len() <= MAX_BUDGET_REPORT_HISTORY_MONTHS,
        ApiError::bad_input(format!(
            "budget report history spans {} months (max {MAX_BUDGET_REPORT_HISTORY_MONTHS}); narrow the startMonth/endMonth range",
            months.len()
        ))
    );
    let (from, _) = month_range(&months[0], timezone)?;
    let (_, to) = month_range(months.last().expect("budgeted months cannot be empty"), timezone)?;
    let actual_by_month =
        actual_amounts_by_month_category(pool, spending_filter(from, to, Some(Granularity::Monthly)), timezone)
            .await
            .context("compute actual spend")?;
    let groups = category_groups(pool).await.context("load category groups")?;
    let items = months
        .into_iter()
        .rev()
        .map(|month| {
            assemble_budget_report(
                &month,
                &groups,
                budgeted_by_month.get(&month).expect("month comes from budget map"),
                actual_by_month.get(&month).unwrap_or(&HashMap::new()),
            )
        })
        .collect();
    Ok(BudgetReportHistory { items })
}

async fn actual_amounts_by_category(
    pool: &SqlitePool,
    month: &str,
    filter: SpendingFilter,
    timezone: Tz,
) -> Result<HashMap<i64, Cents>> {
    Ok(actual_amounts_by_month_category(pool, filter, timezone)
        .await?
        .remove(month)
        .unwrap_or_default())
}

async fn actual_amounts_by_month_category(
    pool: &SqlitePool,
    filter: SpendingFilter,
    timezone: Tz,
) -> Result<HashMap<String, HashMap<i64, Cents>>> {
    spending_rows(
        pool,
        &filter,
        SpendingMode {
            by_category: true,
            ..Default::default()
        },
        timezone,
    )
    .await
    .map(|rows| {
        rows.into_iter()
            .filter_map(
                |SpendingRow {
                     period_label,
                     category,
                     total_amount,
                     ..
                 }| {
                    category.map(|category| {
                        let amount = if category.kind == CategoryKind::Income { -total_amount } else { total_amount };
                        (period_label, category.id, amount)
                    })
                },
            )
            .fold(
                HashMap::<String, HashMap<i64, Cents>>::new(),
                |mut by_month, (month, category_id, amount)| {
                    by_month.entry(month).or_default().insert(category_id, amount);
                    by_month
                },
            )
    })
}

fn assemble_budget_report(
    month: &str,
    groups: &[CategoryGroup],
    budgeted: &HashMap<i64, BudgetEntry>,
    actual: &HashMap<i64, Cents>,
) -> BudgetReport {
    let sections = groups
        .iter()
        .filter(|group| group.kind != CategoryKind::Transfer)
        .filter_map(|group| {
            let lines = group
                .categories
                .iter()
                .filter_map(|category| {
                    let entry = budgeted.get(&category.id).copied().unwrap_or_default();
                    let actual = actual.get(&category.id).copied().unwrap_or_default();
                    (entry.amount != Cents::default() || actual != Cents::default()).then(|| BudgetLine {
                        id: (entry.id != 0).then(|| super::types::budget_global_id(entry.id)),
                        category: category.clone(),
                        budgeted: entry.amount,
                        actual,
                        remaining: entry.amount - actual,
                    })
                })
                .collect::<Vec<_>>();
            let budgeted = lines.iter().map(|line| line.budgeted).sum();
            let actual = lines.iter().map(|line| line.actual).sum();
            (!lines.is_empty() || budgeted != Cents::default()).then_some((
                group.kind,
                BudgetSection {
                    label: group.name.clone(),
                    group: group.clone(),
                    budgeted,
                    actual,
                    remaining: budgeted - actual,
                    lines,
                },
            ))
        })
        .collect::<Vec<_>>();
    let (income_budgeted, income_actual, expenses_budgeted, expenses_actual) = sections.iter().fold(
        (Cents::default(), Cents::default(), Cents::default(), Cents::default()),
        |totals, (kind, section)| match kind {
            CategoryKind::Income => (
                totals.0 + section.budgeted,
                totals.1 + section.actual,
                totals.2,
                totals.3,
            ),
            CategoryKind::Expense => (
                totals.0,
                totals.1,
                totals.2 + section.budgeted,
                totals.3 + section.actual,
            ),
            CategoryKind::Transfer => totals,
        },
    );
    BudgetReport {
        month: month.into(),
        expenses_budgeted,
        expenses_actual,
        income_budgeted,
        income_actual,
        remaining_budgeted: income_budgeted - expenses_budgeted,
        remaining_actual: income_actual - expenses_actual,
        sections: sections.into_iter().map(|(_, section)| section).collect(),
    }
}

fn validate_history_month(label: &str, month: Option<&str>) -> Result<()> {
    month
        .map(validate_month)
        .transpose()
        .map_err(|error| ApiError::bad_input(format!("{label}: {error}")))?;
    Ok(())
}

fn validate_month(month: &str) -> Result<()> {
    let valid = month.len() == 7
        && month.as_bytes()[..4].iter().all(u8::is_ascii_digit)
        && month.as_bytes()[4] == b'-'
        && matches!(
            &month[5..],
            "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12"
        );
    anyhow::ensure!(valid, "month must be in YYYY-MM format, got {month:?}");
    Ok(())
}

fn month_range(month: &str, timezone: Tz) -> Result<(DateTime<Utc>, DateTime<Utc>)> {
    let (year, month_number) = month.split_once('-').context(format!("parse month {month:?}"))?;
    let year = year.parse().context(format!("parse month {month:?}"))?;
    let month_number = month_number.parse().context(format!("parse month {month:?}"))?;
    let start = timezone
        .with_ymd_and_hms(year, month_number, 1, 0, 0, 0)
        .single()
        .context(format!("parse month {month:?}"))?;
    let end = start
        .checked_add_months(Months::new(1))
        .context(format!("parse month {month:?}"))?;
    Ok((start.with_timezone(&Utc), end.with_timezone(&Utc)))
}

fn spending_filter(from: DateTime<Utc>, to: DateTime<Utc>, granularity: Option<Granularity>) -> SpendingFilter {
    SpendingFilter {
        datetime_range: DateTimeRange {
            from: Some(from),
            to: Some(to),
        },
        granularity,
        category_ids: None,
        owner_ids: None,
        account_ids: None,
        is_hidden: None,
        tag_ids: None,
        untagged: None,
    }
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use async_graphql::ID;

    use super::*;
    use crate::{
        ids::{GlobalId, GlobalIdType},
        schema::CategoryKind,
        testutil::transactions::category,
    };

    #[tokio::test]
    async fn validates_and_mutates_budgets() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        let category = category(&pool, "Service budget", CategoryKind::Expense).await?;
        let category_id = ID::from(GlobalId::new(GlobalIdType::Category, category.id).encoded_string());
        let budget = set_budget(
            &pool,
            SetBudgetInput {
                month: "2026-06".into(),
                category_id: category_id.clone(),
                amount: Cents::default(),
            },
        )
        .await?;

        assert_eq!(
            (budget.month.as_str(), budget.category, budget.amount),
            ("2026-06", category, Cents::default())
        );
        assert_eq!(
            set_budget(
                &pool,
                SetBudgetInput {
                    month: "bad".into(),
                    category_id: category_id.clone(),
                    amount: Cents(1),
                },
            )
            .await
            .unwrap_err()
            .to_string(),
            "month must be in YYYY-MM format, got \"bad\""
        );
        assert_eq!(
            set_budget(
                &pool,
                SetBudgetInput {
                    month: "2026-06".into(),
                    category_id: category_id.clone(),
                    amount: Cents(-1),
                },
            )
            .await
            .unwrap_err()
            .to_string(),
            "budget amount must be non-negative"
        );
        assert_eq!(
            set_budget(
                &pool,
                SetBudgetInput {
                    month: "2026-06".into(),
                    category_id: ID::from(GlobalId::new(GlobalIdType::Category, 999_999).encoded_string()),
                    amount: Cents(1),
                },
            )
            .await
            .unwrap_err()
            .to_string(),
            "category 999999 not found"
        );
        assert_eq!(
            copy_budgets(
                &pool,
                CopyBudgetsInput {
                    from_month: "2026-06".into(),
                    to_month: "2026-07".into(),
                },
            )
            .await?,
            1
        );
        assert!(
            delete_budget(
                &pool,
                DeleteBudgetInput {
                    id: ID::from(GlobalId::new(GlobalIdType::Budget, budget.id).encoded_string()),
                },
            )
            .await?
        );
        assert!(
            !delete_budget(
                &pool,
                DeleteBudgetInput {
                    id: ID::from(GlobalId::new(GlobalIdType::Budget, budget.id).encoded_string()),
                },
            )
            .await?
        );
        Ok(())
    }

    #[tokio::test]
    async fn keeps_budget_month_errors_public() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        let invalid = "month must be in YYYY-MM format, got \"bad\"";

        assert_eq!(
            copy_budgets(
                &pool,
                CopyBudgetsInput {
                    from_month: "bad".into(),
                    to_month: "2026-06".into(),
                },
            )
            .await
            .unwrap_err()
            .to_string(),
            format!("fromMonth: {invalid}")
        );
        assert_eq!(
            copy_budgets(
                &pool,
                CopyBudgetsInput {
                    from_month: "2026-05".into(),
                    to_month: "bad".into(),
                },
            )
            .await
            .unwrap_err()
            .to_string(),
            format!("toMonth: {invalid}")
        );
        assert_eq!(
            copy_budgets(
                &pool,
                CopyBudgetsInput {
                    from_month: "2026-06".into(),
                    to_month: "2026-06".into(),
                },
            )
            .await
            .unwrap_err()
            .to_string(),
            "fromMonth and toMonth must differ"
        );
        assert_eq!(
            budget_report(&pool, BudgetReportInput { month: "bad".into() }, chrono_tz::UTC,)
                .await
                .unwrap_err()
                .to_string(),
            invalid
        );
        assert_eq!(
            budget_report_history(
                &pool,
                BudgetReportHistoryInput {
                    start_month: Some("bad".into()),
                    end_month: None,
                },
                chrono_tz::UTC,
            )
            .await
            .unwrap_err()
            .to_string(),
            format!("startMonth: {invalid}")
        );
        assert_eq!(
            budget_report_history(
                &pool,
                BudgetReportHistoryInput {
                    start_month: None,
                    end_month: Some("bad".into()),
                },
                chrono_tz::UTC,
            )
            .await
            .unwrap_err()
            .to_string(),
            format!("endMonth: {invalid}")
        );
        assert_eq!(
            budget_report_history(
                &pool,
                BudgetReportHistoryInput {
                    start_month: Some("2026-06".into()),
                    end_month: Some("2026-06".into()),
                },
                chrono_tz::UTC,
            )
            .await
            .unwrap_err()
            .to_string(),
            "startMonth must be before endMonth"
        );
        Ok(())
    }

    #[test]
    fn month_ranges_start_at_local_midnight() -> Result<()> {
        assert_eq!(
            month_range("2026-06", chrono_tz::America::Los_Angeles)?,
            ("2026-06-01T07:00:00Z".parse()?, "2026-07-01T07:00:00Z".parse()?,)
        );
        Ok(())
    }
}
