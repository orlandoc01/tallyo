use serde::Serialize;

use super::projections::{encode, map_category_ref};
use crate::{
    ids::GlobalIdType,
    money::Cents,
    schema::{Budget, BudgetLine, BudgetReport, BudgetSection},
};

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanBudget {
    pub(super) id: String,
    pub(super) month: String,
    pub(super) category_id: String,
    pub(super) category_name: String,
    pub(super) amount: Cents,
}

#[derive(Debug, PartialEq, Serialize)]
pub(super) struct LeanBudgetPayload {
    pub(super) budget: LeanBudget,
}

pub(super) fn map_budget(budget: Budget) -> LeanBudget {
    LeanBudget {
        id: encode(GlobalIdType::Budget, budget.id),
        month: budget.month,
        category_id: encode(GlobalIdType::Category, budget.category.id),
        category_name: budget.category.name,
        amount: budget.amount,
    }
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanBudgetLine {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) id: Option<String>,
    pub(super) category_id: String,
    pub(super) category_name: String,
    pub(super) budgeted: Cents,
    pub(super) actual: Cents,
    pub(super) remaining: Cents,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanBudgetSection {
    pub(super) label: String,
    pub(super) group_id: String,
    pub(super) group_name: String,
    pub(super) budgeted: Cents,
    pub(super) actual: Cents,
    pub(super) remaining: Cents,
    pub(super) lines: Vec<LeanBudgetLine>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanBudgetReport {
    pub(super) month: String,
    pub(super) expenses_budgeted: Cents,
    pub(super) expenses_actual: Cents,
    pub(super) income_budgeted: Cents,
    pub(super) income_actual: Cents,
    pub(super) remaining_budgeted: Cents,
    pub(super) remaining_actual: Cents,
    pub(super) sections: Vec<LeanBudgetSection>,
}

pub(super) fn map_budget_report(report: BudgetReport) -> LeanBudgetReport {
    let to_line = |line: BudgetLine| {
        let category = map_category_ref(&line.category);
        LeanBudgetLine {
            id: line.id.map(|id| id.to_string()),
            category_id: category.id,
            category_name: category.name,
            budgeted: line.budgeted,
            actual: line.actual,
            remaining: line.remaining,
        }
    };
    let to_section = |section: BudgetSection| LeanBudgetSection {
        label: section.label,
        group_id: encode(GlobalIdType::CategoryGroup, section.group.id),
        group_name: section.group.name,
        budgeted: section.budgeted,
        actual: section.actual,
        remaining: section.remaining,
        lines: section.lines.into_iter().map(to_line).collect(),
    };
    LeanBudgetReport {
        month: report.month,
        expenses_budgeted: report.expenses_budgeted,
        expenses_actual: report.expenses_actual,
        income_budgeted: report.income_budgeted,
        income_actual: report.income_actual,
        remaining_budgeted: report.remaining_budgeted,
        remaining_actual: report.remaining_actual,
        sections: report.sections.into_iter().map(to_section).collect(),
    }
}
