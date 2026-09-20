use crate::{budgets::Budget, database::queries, transactions::store::category_from_row};

impl From<queries::BudgetByIdRow> for Budget {
    fn from(row: queries::BudgetByIdRow) -> Self {
        Self {
            id: row.id,
            month: row.month,
            category: category_from_row(row.category_rows),
            amount: row.amount_cents,
        }
    }
}
