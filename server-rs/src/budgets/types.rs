use crate::money::Cents;

pub use crate::schema::{
    BudgetReportHistoryInput, BudgetReportInput, CopyBudgetsInput, DeleteBudgetInput, SetBudgetInput,
};

pub use crate::schema::{Budget, BudgetLine, BudgetReport, BudgetReportHistory, BudgetSection};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct BudgetEntry {
    pub id: i64,
    pub amount: Cents,
}

pub(super) fn budget_global_id(id: i64) -> async_graphql::ID {
    crate::ids::GlobalId::new(crate::ids::GlobalIdType::Budget, id)
        .encoded_string()
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{schema::CategoryKind, transactions::Category};

    #[test]
    fn budget_output_types_keep_internal_relations_hidden() {
        let category = Category {
            id: 7,
            name: "Groceries".into(),
            emoji: "*".into(),
            group_name: "Expenses".into(),
            group_emoji: "*".into(),
            kind: CategoryKind::Expense,
            sort_order: 1,
            plaid_pfc2_codes: Vec::new(),
        };
        let budget = Budget {
            id: 9,
            month: "2026-06".into(),
            category: category.clone(),
            amount: Cents(40_000),
        };
        let line = BudgetLine {
            id: Some(budget_global_id(budget.id)),
            category,
            budgeted: budget.amount,
            actual: Cents(12_500),
            remaining: Cents(27_500),
        };

        assert_eq!(
            (budget.month.as_str(), line.id, line.remaining),
            ("2026-06", Some(budget_global_id(9)), Cents(27_500))
        );
    }
}
