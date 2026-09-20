use anyhow::Result;

use super::{Resolver, ids::validate_id, spending::timezone};
use crate::{
    auth::Identity,
    budgets,
    ids::GlobalIdType,
    schema::{
        BudgetReport, BudgetReportHistory, BudgetReportHistoryInput, BudgetReportInput, CopyBudgetsInput,
        CopyBudgetsPayload, DeleteBudgetInput, DeleteBudgetPayload, SetBudgetInput, SetBudgetPayload,
    },
};

impl Resolver {
    pub async fn budget_report(&self, identity: &Identity, input: BudgetReportInput) -> Result<BudgetReport> {
        budgets::budget_report(&self.pool, input, timezone(identity)).await
    }

    pub async fn budget_report_history(
        &self,
        identity: &Identity,
        input: Option<BudgetReportHistoryInput>,
    ) -> Result<BudgetReportHistory> {
        let input = input.unwrap_or(BudgetReportHistoryInput {
            start_month: None,
            end_month: None,
        });
        budgets::budget_report_history(&self.pool, input, timezone(identity)).await
    }

    pub async fn set_budget(&self, input: SetBudgetInput) -> Result<SetBudgetPayload> {
        validate_id(&input.category_id, GlobalIdType::Category)?;
        Ok(SetBudgetPayload {
            budget: budgets::set_budget(&self.pool, input).await?,
        })
    }

    pub async fn delete_budget(&self, input: DeleteBudgetInput) -> Result<DeleteBudgetPayload> {
        validate_id(&input.id, GlobalIdType::Budget)?;
        Ok(DeleteBudgetPayload {
            success: budgets::delete_budget(&self.pool, input).await?,
        })
    }

    pub async fn copy_budgets(&self, input: CopyBudgetsInput) -> Result<CopyBudgetsPayload> {
        Ok(CopyBudgetsPayload {
            copied_count: budgets::copy_budgets(&self.pool, input).await?,
        })
    }
}
