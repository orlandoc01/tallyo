use anyhow::Result;
use async_graphql::ID;
use chrono::{Months, NaiveDate};

use super::*;
use crate::{
    ids::{GlobalId, GlobalIdType},
    money::Cents,
    schema::CategoryKind,
    testutil::transactions::{account, category, transaction},
};

fn set_input(month: &str, category_id: i64, amount: Cents) -> SetBudgetInput {
    SetBudgetInput {
        month: month.into(),
        category_id: ID::from(GlobalId::new(GlobalIdType::Category, category_id).encoded_string()),
        amount,
    }
}

#[tokio::test]
async fn report_rolls_up_income_and_expenses_while_skipping_transfers() -> Result<()> {
    let pool = crate::database::dbtest::open().await?;
    let account_id = account(&pool, "budget-report-account").await?;
    let expense = category(&pool, "Budget groceries", CategoryKind::Expense).await?;
    let actual_only = category(&pool, "Budget actual only", CategoryKind::Expense).await?;
    let income = category(&pool, "Budget paycheck", CategoryKind::Income).await?;
    let transfer = category(&pool, "Budget transfer", CategoryKind::Transfer).await?;
    let empty = category(&pool, "Budget empty", CategoryKind::Expense).await?;
    set_budget(&pool, set_input("2026-06", expense.id, Cents(40_000))).await?;
    set_budget(&pool, set_input("2026-06", income.id, Cents(200_000))).await?;
    set_budget(&pool, set_input("2026-06", transfer.id, Cents(600))).await?;
    set_budget(&pool, set_input("2026-06", empty.id, Cents::default())).await?;
    let datetime = "2026-06-15T12:00:00Z".parse()?;
    transaction(&pool, "budget expense", account_id, expense.id, Cents(12_500), datetime).await?;
    transaction(
        &pool,
        "budget actual only",
        account_id,
        actual_only.id,
        Cents(50),
        datetime,
    )
    .await?;
    transaction(&pool, "budget income", account_id, income.id, Cents(-200_000), datetime).await?;
    transaction(&pool, "budget transfer", account_id, transfer.id, Cents(300), datetime).await?;

    let report = budget_report(
        &pool,
        BudgetReportInput {
            month: "2026-06".into(),
        },
        chrono_tz::UTC,
    )
    .await?;
    assert_eq!(
        (
            report.expenses_budgeted,
            report.expenses_actual,
            report.income_budgeted,
            report.income_actual,
            report.remaining_budgeted,
            report.remaining_actual,
        ),
        (
            Cents(40_000),
            Cents(12_550),
            Cents(200_000),
            Cents(200_000),
            Cents(160_000),
            Cents(187_450),
        )
    );
    assert!(
        report
            .sections
            .iter()
            .all(|section| section.group.kind != CategoryKind::Transfer)
    );
    assert!(
        report
            .sections
            .iter()
            .all(|section| section.label != "Budget empty group")
    );
    let actual_only_line = report
        .sections
        .iter()
        .flat_map(|section| &section.lines)
        .find(|line| line.category.id == actual_only.id)
        .expect("actual-only categories produce a line");
    assert_eq!(
        (
            actual_only_line.id.clone(),
            actual_only_line.budgeted,
            actual_only_line.actual
        ),
        (None, Cents::default(), Cents(50))
    );
    Ok(())
}

#[tokio::test]
async fn history_is_descending_and_scoped_to_budgeted_months() -> Result<()> {
    let pool = crate::database::dbtest::open().await?;
    let account_id = account(&pool, "budget-history-account").await?;
    let category = category(&pool, "Budget history", CategoryKind::Expense).await?;
    set_budget(&pool, set_input("2026-05", category.id, Cents(100))).await?;
    set_budget(&pool, set_input("2026-06", category.id, Cents(200))).await?;
    transaction(
        &pool,
        "budget may",
        account_id,
        category.id,
        Cents(10),
        "2026-05-15T12:00:00Z".parse()?,
    )
    .await?;
    transaction(
        &pool,
        "budget june",
        account_id,
        category.id,
        Cents(20),
        "2026-06-15T12:00:00Z".parse()?,
    )
    .await?;

    let history = budget_report_history(
        &pool,
        BudgetReportHistoryInput {
            start_month: None,
            end_month: None,
        },
        chrono_tz::UTC,
    )
    .await?;
    assert_eq!(
        history
            .items
            .iter()
            .map(|report| (report.month.as_str(), report.expenses_actual))
            .collect::<Vec<_>>(),
        [("2026-06", Cents(20)), ("2026-05", Cents(10))]
    );
    let scoped = budget_report_history(
        &pool,
        BudgetReportHistoryInput {
            start_month: Some("2026-06".into()),
            end_month: Some("2026-07".into()),
        },
        chrono_tz::UTC,
    )
    .await?;
    assert_eq!(scoped.items.len(), 1);
    assert_eq!(scoped.items[0].month, "2026-06");
    Ok(())
}

#[tokio::test]
async fn history_returns_empty_without_budgets_and_enforces_its_month_cap() -> Result<()> {
    let empty_pool = crate::database::dbtest::open().await?;
    assert!(
        budget_report_history(
            &empty_pool,
            BudgetReportHistoryInput {
                start_month: None,
                end_month: None,
            },
            chrono_tz::UTC,
        )
        .await?
        .items
        .is_empty()
    );

    let pool = crate::database::dbtest::open().await?;
    let category = category(&pool, "Budget cap", CategoryKind::Expense).await?;
    let start = NaiveDate::from_ymd_opt(2000, 1, 1).expect("valid fixed date");
    for index in 0..super::service::MAX_BUDGET_REPORT_HISTORY_MONTHS as u32 {
        let month = start
            .checked_add_months(Months::new(index))
            .expect("month remains valid")
            .format("%Y-%m")
            .to_string();
        store::upsert_budget(&pool, &month, category.id, Cents(1)).await?;
    }
    assert_eq!(
        budget_report_history(
            &pool,
            BudgetReportHistoryInput {
                start_month: None,
                end_month: None,
            },
            chrono_tz::UTC,
        )
        .await?
        .items
        .len(),
        super::service::MAX_BUDGET_REPORT_HISTORY_MONTHS
    );
    let month = start
        .checked_add_months(Months::new(super::service::MAX_BUDGET_REPORT_HISTORY_MONTHS as u32))
        .expect("month remains valid")
        .format("%Y-%m")
        .to_string();
    store::upsert_budget(&pool, &month, category.id, Cents(1)).await?;
    assert_eq!(
        budget_report_history(
            &pool,
            BudgetReportHistoryInput {
                start_month: None,
                end_month: None,
            },
            chrono_tz::UTC,
        )
        .await
        .unwrap_err()
        .to_string(),
        "budget report history spans 121 months (max 120); narrow the startMonth/endMonth range"
    );
    Ok(())
}
