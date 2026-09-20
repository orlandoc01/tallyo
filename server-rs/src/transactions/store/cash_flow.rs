use anyhow::Result;
use chrono_tz::Tz;
use sqlx::SqlitePool;

use crate::{
    money::Cents,
    schema::SpendingFilter,
    transactions::{CashFlowBreakdown, CashFlowPeriod, CashFlowReport, CashFlowSummary, SpendingMode},
};

use super::reports::spending_rows;

pub async fn cash_flow(pool: &SqlitePool, filter: &SpendingFilter, timezone: Tz) -> Result<CashFlowReport> {
    let rows = spending_rows(
        pool,
        filter,
        SpendingMode {
            by_category: true,
            exclude_income: false,
        },
        timezone,
    )
    .await?;
    Ok(CashFlowReport {
        periods: rows
            .into_iter()
            .fold(Vec::<CashFlowPeriod>::new(), |mut periods, row| {
                let is_income = row
                    .category
                    .as_ref()
                    .is_some_and(|category| category.kind == crate::schema::CategoryKind::Income);
                let total = if is_income { -row.total_amount } else { row.total_amount };
                let breakdown = CashFlowBreakdown {
                    category: row.category.expect("spending transactions always have a category"),
                    total,
                    transaction_count: row.transaction_count as i32,
                    percent_of_total: 0.0,
                };
                let index = periods
                    .iter()
                    .position(|period| period.period_label == row.period_label)
                    .unwrap_or_else(|| {
                        periods.push(CashFlowPeriod {
                            period_label: row.period_label.clone(),
                            period_start: row.period_start.clone(),
                            period_end: row.period_end.clone(),
                            summary: CashFlowSummary {
                                income: Cents::default(),
                                expenses: Cents::default(),
                                savings: Cents::default(),
                                savings_rate: 0.0,
                            },
                            income_by_category: Vec::new(),
                            expenses_by_category: Vec::new(),
                        });
                        periods.len() - 1
                    });
                let period = &mut periods[index];
                if is_income {
                    period.summary.income += total;
                    period.income_by_category.push(breakdown);
                } else {
                    period.summary.expenses += total;
                    period.expenses_by_category.push(breakdown);
                }
                periods
            })
            .into_iter()
            .map(finalize_period)
            .collect(),
    })
}

fn finalize_period(mut period: CashFlowPeriod) -> CashFlowPeriod {
    period.summary.savings = period.summary.income - period.summary.expenses;
    period.summary.savings_rate = percentage(period.summary.savings, period.summary.income);
    period
        .income_by_category
        .iter_mut()
        .for_each(|row| row.percent_of_total = percentage(row.total, period.summary.income));
    period
        .expenses_by_category
        .iter_mut()
        .for_each(|row| row.percent_of_total = percentage(row.total, period.summary.expenses));
    period
}

fn percentage(value: Cents, total: Cents) -> f64 {
    if total.0 == 0 { 0.0 } else { value.0 as f64 / total.0 as f64 * 100.0 }
}
