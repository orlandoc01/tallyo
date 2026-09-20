use serde::Serialize;

use super::projections::map_category_ref;
use crate::{
    ids::Date,
    money::Cents,
    schema::{
        CashFlowBreakdown, CashFlowPeriod, CashFlowReport, CashFlowSummary, CategorySpendingAggregate,
        CategorySpendingPeriod, SpendingAggregatePeriod, SpendingByCategoryReport,
    },
};

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanCashFlowBreakdown {
    pub(super) category_id: String,
    pub(super) category_name: String,
    pub(super) total: Cents,
    pub(super) transaction_count: i32,
    pub(super) percent_of_total: f64,
}

fn map_cash_flow_breakdowns(breakdowns: Vec<CashFlowBreakdown>) -> Vec<LeanCashFlowBreakdown> {
    breakdowns
        .into_iter()
        .map(|breakdown| {
            let category = map_category_ref(&breakdown.category);
            LeanCashFlowBreakdown {
                category_id: category.id,
                category_name: category.name,
                total: breakdown.total,
                transaction_count: breakdown.transaction_count,
                percent_of_total: breakdown.percent_of_total,
            }
        })
        .collect()
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanCashFlowSummary {
    pub(super) income: Cents,
    pub(super) expenses: Cents,
    pub(super) savings: Cents,
    pub(super) savings_rate: f64,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanCashFlowPeriod {
    pub(super) period_label: String,
    pub(super) period_start: Date,
    pub(super) period_end: Date,
    pub(super) summary: LeanCashFlowSummary,
    pub(super) income_by_category: Vec<LeanCashFlowBreakdown>,
    pub(super) expenses_by_category: Vec<LeanCashFlowBreakdown>,
}

#[derive(Debug, PartialEq, Serialize)]
pub(super) struct LeanCashFlowReport {
    pub(super) periods: Vec<LeanCashFlowPeriod>,
}

pub(super) fn map_cash_flow_report(report: CashFlowReport) -> LeanCashFlowReport {
    let to_period = |period: CashFlowPeriod| {
        let CashFlowSummary {
            income,
            expenses,
            savings,
            savings_rate,
        } = period.summary;
        LeanCashFlowPeriod {
            period_label: period.period_label,
            period_start: period.period_start,
            period_end: period.period_end,
            summary: LeanCashFlowSummary {
                income,
                expenses,
                savings,
                savings_rate,
            },
            income_by_category: map_cash_flow_breakdowns(period.income_by_category),
            expenses_by_category: map_cash_flow_breakdowns(period.expenses_by_category),
        }
    };
    LeanCashFlowReport {
        periods: report.periods.into_iter().map(to_period).collect(),
    }
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanCategorySpendingPeriod {
    pub(super) period_label: String,
    pub(super) period_start: Date,
    pub(super) period_end: Date,
    pub(super) total_amount: Cents,
    pub(super) transaction_count: i32,
    pub(super) percent_of_total: f64,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanCategorySpendingAggregate {
    pub(super) category_id: String,
    pub(super) category_name: String,
    pub(super) total_amount: Cents,
    pub(super) transaction_count: i32,
    pub(super) percent_of_total: f64,
    pub(super) periods: Vec<LeanCategorySpendingPeriod>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanSpendingAggregatePeriod {
    pub(super) period_label: String,
    pub(super) period_start: Date,
    pub(super) period_end: Date,
    pub(super) total_amount: Cents,
    pub(super) transaction_count: i32,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanSpendingByCategoryReport {
    pub(super) total_amount: Cents,
    pub(super) transaction_count: i32,
    pub(super) periods: Vec<LeanSpendingAggregatePeriod>,
    pub(super) categories: Vec<LeanCategorySpendingAggregate>,
}

pub(super) fn map_spending_by_category_report(report: SpendingByCategoryReport) -> LeanSpendingByCategoryReport {
    let to_category_period = |period: CategorySpendingPeriod| LeanCategorySpendingPeriod {
        period_label: period.period_label,
        period_start: period.period_start,
        period_end: period.period_end,
        total_amount: period.total_amount,
        transaction_count: period.transaction_count,
        percent_of_total: period.percent_of_total,
    };
    let to_category = |aggregate: CategorySpendingAggregate| {
        let category = map_category_ref(&aggregate.category);
        LeanCategorySpendingAggregate {
            category_id: category.id,
            category_name: category.name,
            total_amount: aggregate.total_amount,
            transaction_count: aggregate.transaction_count,
            percent_of_total: aggregate.percent_of_total,
            periods: aggregate.periods.into_iter().map(to_category_period).collect(),
        }
    };
    let to_period = |period: SpendingAggregatePeriod| LeanSpendingAggregatePeriod {
        period_label: period.period_label,
        period_start: period.period_start,
        period_end: period.period_end,
        total_amount: period.total_amount,
        transaction_count: period.transaction_count,
    };
    LeanSpendingByCategoryReport {
        total_amount: report.total_amount,
        transaction_count: report.transaction_count,
        periods: report.periods.into_iter().map(to_period).collect(),
        categories: report.categories.into_iter().map(to_category).collect(),
    }
}
