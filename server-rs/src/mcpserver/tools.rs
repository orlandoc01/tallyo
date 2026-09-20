use anyhow::{Context, Result, ensure};
use async_graphql::ID;
use rmcp::model::{JsonObject, Tool, ToolAnnotations};
use schemars::{JsonSchema, generate::SchemaSettings};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use strum_macros::IntoStaticStr;

use super::{
    Server,
    projections::{
        LeanAccount, LeanAccountPayload, LeanCategory, LeanCategoryGroup, LeanList, LeanOwner, map_account,
        map_category, map_category_group, map_list, map_owner,
    },
    projections_analysis::{LeanAnalysisReport, map_analysis_report},
    projections_budget::{LeanBudgetPayload, LeanBudgetReport, map_budget, map_budget_report},
    projections_networth::{LeanNetWorthReport, map_net_worth_report},
    projections_plaid::{LeanPlaidCredential, LeanPlaidItem, map_plaid_credential_list, map_plaid_item_list},
    projections_rules::{
        LeanRecurringCharge, LeanRule, LeanRulePayload, map_recurring_charge_list, map_rule, map_rule_list,
    },
    projections_spending::{
        LeanCashFlowReport, LeanSpendingByCategoryReport, map_cash_flow_report, map_spending_by_category_report,
    },
    projections_transactions::{
        LeanBulkUpdateTransactionsPayload, LeanTransactionConnection, LeanTransactionPayload, LeanTransactionsSummary,
        map_bulk_update_transactions_payload, map_transaction_connection, map_transaction_payload,
        map_transactions_summary,
    },
};
use crate::{
    apierror::ApiError,
    auth::Identity,
    ids::GlobalId,
    money::Cents,
    schema::{
        AnalysisInput, BudgetReportInput, BulkDeleteTransactionsInput, BulkUpdateTransactionsInput,
        CreateManualAccountInput, CreateRuleInput, CreateTransactionInput, NetWorthInput, PlaidItemsInput, RulesInput,
        SetBudgetInput, SpendingFilter, TransactionsFilter, TransactionsInput, UpdateAccountInput,
        UpdateTransactionInput,
    },
    utils::future::BoxFuture,
};

pub(super) const CONFIRM_REQUIRED: &str = "confirm is required";

#[derive(Debug, PartialEq)]
pub(super) struct Output<T> {
    pub(super) value: T,
    pub(super) summary: String,
}

impl<T: Serialize> Output<T> {
    fn into_json(self) -> Result<ToolOutput> {
        Ok(ToolOutput {
            value: serde_json::to_value(self.value)?,
            summary: self.summary,
        })
    }
}

pub(super) struct ToolOutput {
    pub(super) value: Value,
    pub(super) summary: String,
}

#[derive(Clone, Copy, IntoStaticStr)]
enum Operation {
    Query,
    Mutation,
}

#[derive(Clone, Copy)]
pub(super) enum Kind {
    Query,
    Mutation,
    Destructive,
}

impl Kind {
    fn operation(self) -> Operation {
        match self {
            Self::Query => Operation::Query,
            Self::Mutation | Self::Destructive => Operation::Mutation,
        }
    }

    fn annotations(self) -> ToolAnnotations {
        match self {
            Self::Query => ToolAnnotations::new().read_only(true),
            Self::Mutation => ToolAnnotations::new().read_only(false),
            Self::Destructive => ToolAnnotations::new().read_only(false).destructive(true),
        }
    }
}

type Call = for<'a> fn(&'a Server, &'a Identity, Value) -> BoxFuture<'a, Result<ToolOutput>>;

pub(super) struct ToolSpec {
    pub(super) name: &'static str,
    pub(super) kind: Kind,
    pub(super) operation_name: &'static str,
    pub(super) description: &'static str,
    pub(super) input_schema: fn() -> JsonObject,
    pub(super) call: Call,
}

impl ToolSpec {
    pub(super) fn operation(&self) -> &'static str {
        self.kind.operation().into()
    }

    pub(super) fn definition(&self) -> Tool {
        Tool::new(self.name, self.description, (self.input_schema)()).with_annotations(self.kind.annotations())
    }
}

pub(super) fn input_schema<T: JsonSchema>() -> JsonObject {
    let schema = SchemaSettings::draft2020_12()
        .with(|settings| {
            settings.inline_subschemas = true;
            settings.meta_schema = None;
        })
        .into_generator()
        .into_root_schema_for::<T>();
    match schema.to_value() {
        Value::Object(object) => object,
        _ => JsonObject::new(),
    }
}

fn bind<T: DeserializeOwned>(arguments: Value) -> Result<T> {
    serde_json::from_value(arguments).map_err(|error| ApiError::public(error).into())
}

macro_rules! tool {
    ($name:literal, $kind:ident, $operation:literal, $description:literal, |$server:ident, $identity:pat_param, $input:ident: $ty:ty| $call:expr) => {
        ToolSpec {
            name: $name,
            kind: Kind::$kind,
            operation_name: $operation,
            description: $description,
            input_schema: input_schema::<$ty>,
            call: |$server, $identity, arguments| {
                Box::pin(async move {
                    let $input = bind::<$ty>(arguments)?;
                    $call.await?.into_json()
                })
            },
        }
    };
}

pub(super) static TOOLS: [ToolSpec; 26] = [
    tool!(
        "list_transactions",
        Query,
        "transactions",
        "Paginated transaction list with filtering and sorting.",
        |server, _, input: TransactionsInput| server.list_transactions(input)
    ),
    tool!(
        "get_transaction",
        Query,
        "transaction",
        "Get a single transaction by ID.",
        |server, _, input: GetTransactionInput| server.get_transaction(input)
    ),
    tool!(
        "spending_by_category",
        Query,
        "spendingByCategory",
        "Get spending totals grouped by category for a date range. Excludes transfers, income, and hidden transactions by default.",
        |server, identity, input: SpendingFilter| server.spending_by_category(identity, input)
    ),
    tool!(
        "cash_flow",
        Query,
        "cashFlow",
        "Get income, expenses, savings, and category breakdowns per period. Excludes transfers but includes income.",
        |server, identity, input: SpendingFilter| server.cash_flow(identity, input)
    ),
    tool!(
        "transactions_summary",
        Query,
        "transactionsSummary",
        "Get aggregate statistics for transactions matching a filter.",
        |server, _, input: TransactionsFilter| server.transactions_summary(input)
    ),
    tool!(
        "list_categories",
        Query,
        "categories",
        "List all categories.",
        |server, _, _input: NoInput| server.list_categories()
    ),
    tool!(
        "list_category_groups",
        Query,
        "categoryGroups",
        "List categories grouped by group name.",
        |server, _, _input: NoInput| server.list_category_groups()
    ),
    tool!(
        "list_accounts",
        Query,
        "accounts",
        "List all linked and manual accounts.",
        |server, _, _input: NoInput| server.list_accounts()
    ),
    tool!(
        "net_worth",
        Query,
        "netWorth",
        "Get current net worth, asset-class breakdowns, and holdings rollups.",
        |server, identity, input: NetWorthInput| server.net_worth(identity, input)
    ),
    tool!(
        "portfolio_analysis",
        Query,
        "analysis",
        "Get portfolio allocation analysis by composition, Morningstar category/group, or sectors.",
        |server, _, input: AnalysisInput| server.portfolio_analysis(input)
    ),
    tool!(
        "list_recurring_charges",
        Query,
        "recurringCharges",
        "List detected recurring charges.",
        |server, _, _input: NoInput| server.list_recurring_charges()
    ),
    tool!(
        "list_rules",
        Query,
        "rules",
        "List auto-categorization rules, optionally filtered by merchant pattern, original-name pattern, account IDs, amount bounds, or a free-text search over merchant name/merchant pattern/original pattern.",
        |server, _, input: RulesInput| server.list_rules(input)
    ),
    tool!(
        "list_plaid_items",
        Query,
        "plaidItems",
        "List Plaid items/institutions. Secrets are never returned.",
        |server, _, input: PlaidItemsInput| server.list_plaid_items(input)
    ),
    tool!(
        "list_plaid_credentials",
        Query,
        "plaidCredentials",
        "List Plaid credentials without secrets.",
        |server, _, _input: NoInput| server.list_plaid_credentials()
    ),
    tool!(
        "list_owners",
        Query,
        "owners",
        "List configured valid owner names.",
        |server, _, _input: NoInput| server.list_owners()
    ),
    tool!(
        "budget_report",
        Query,
        "budgetReport",
        "Get budget targets vs actual spending for a month, grouped by category group.",
        |server, identity, input: BudgetReportInput| server.budget_report(identity, input)
    ),
    tool!(
        "bulk_update_transactions",
        Mutation,
        "bulkUpdateTransactions",
        "Batch-update transaction merchant name, notes, recurring flag, hidden flag, category, or tags.",
        |server, _, input: BulkUpdateTransactionsInput| server.bulk_update_transactions(input)
    ),
    tool!(
        "create_rule",
        Mutation,
        "createRule",
        "Create an auto-categorization rule, optionally applying it retroactively.",
        |server, _, input: CreateRuleInput| server.create_rule(input)
    ),
    tool!(
        "delete_rule",
        Destructive,
        "deleteRule",
        "Delete a rule. Requires confirm=true.",
        |server, _, input: DeleteRuleInput| server.delete_rule(input)
    ),
    tool!(
        "update_transaction",
        Mutation,
        "updateTransaction",
        "Edit transaction merchant name, notes, recurring flag, hidden flag, category, or tags.",
        |server, _, input: UpdateTransactionInput| server.update_transaction(input)
    ),
    tool!(
        "delete_transaction",
        Destructive,
        "deleteTransaction",
        "Permanently delete one transaction. Requires confirm=true.",
        |server, _, input: DeleteTransactionInput| server.delete_transaction(input)
    ),
    tool!(
        "bulk_delete_transactions",
        Destructive,
        "bulkDeleteTransactions",
        "Permanently delete transactions by IDs or filter. Requires confirm=true.",
        |server, _, input: BulkDeleteTransactionsArguments| server.bulk_delete_transactions(input)
    ),
    tool!(
        "create_transaction",
        Mutation,
        "createTransaction",
        "Create a manual transaction with a synthetic manual-* ID.",
        |server, _, input: CreateTransactionInput| server.create_transaction(input)
    ),
    tool!(
        "update_account",
        Mutation,
        "updateAccount",
        "Update account name, owner, type, subtype, closed, or hidden state.",
        |server, _, input: UpdateAccountInput| server.update_account(input)
    ),
    tool!(
        "create_manual_account",
        Mutation,
        "createManualAccount",
        "Create a manual account, optionally under an existing connection.",
        |server, _, input: CreateManualAccountInput| server.create_manual_account(input)
    ),
    tool!(
        "set_budget",
        Mutation,
        "setBudget",
        "Set (insert or update) the budget target for a category in a month.",
        |server, _, input: SetBudgetInput| server.set_budget(input)
    ),
];

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct NoInput {}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct GetTransactionInput {
    #[schemars(with = "GlobalId")]
    pub(super) id: ID,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct DeleteTransactionInput {
    #[schemars(with = "GlobalId")]
    pub(super) id: ID,
    pub(super) confirm: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct DeleteRuleInput {
    #[schemars(with = "GlobalId")]
    pub(super) id: ID,
    pub(super) confirm: bool,
}

// Go's bulkDeleteTransactionsInput: a null id element is a malformed id, not a bind failure.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct BulkDeleteTransactionsArguments {
    #[schemars(with = "Option<Vec<Option<GlobalId>>>")]
    pub(super) transaction_ids: Option<Vec<Option<ID>>>,
    pub(super) filter: Option<TransactionsFilter>,
    pub(super) confirm: bool,
}

fn require_ids(ids: Option<Vec<Option<ID>>>, field: &str) -> Result<Option<Vec<ID>>> {
    ids.map(|ids| {
        ids.into_iter()
            .map(|id| id.ok_or_else(|| ApiError::bad_input(format!("{field} contains a malformed id")).into()))
            .collect()
    })
    .transpose()
}

fn dollars(cents: Cents) -> String {
    format!("{:.2}", cents.dollars())
}

impl Server {
    pub(super) async fn list_transactions(
        &self,
        input: TransactionsInput,
    ) -> Result<Output<LeanTransactionConnection>> {
        let connection = self.resolver.transactions(Some(input)).await?;
        Ok(Output {
            summary: format!(
                "Fetched {} transactions ({} total).",
                connection.edges.len(),
                connection.total_count
            ),
            value: map_transaction_connection(connection),
        })
    }

    pub(super) async fn get_transaction(&self, input: GetTransactionInput) -> Result<Output<LeanTransactionPayload>> {
        let transaction = self.resolver.transaction(&input.id).await?;
        let summary = if transaction.is_some() { "Fetched transaction." } else { "Transaction not found." };
        Ok(Output {
            value: map_transaction_payload(transaction),
            summary: summary.to_owned(),
        })
    }

    pub(super) async fn spending_by_category(
        &self,
        identity: &Identity,
        filter: SpendingFilter,
    ) -> Result<Output<LeanSpendingByCategoryReport>> {
        let report = self.resolver.spending_by_category(identity, filter).await?;
        Ok(Output {
            summary: format!(
                "Total spending: ${} across {} transactions.",
                dollars(report.total_amount),
                report.transaction_count
            ),
            value: map_spending_by_category_report(report),
        })
    }

    pub(super) async fn cash_flow(
        &self,
        identity: &Identity,
        filter: SpendingFilter,
    ) -> Result<Output<LeanCashFlowReport>> {
        let report = self.resolver.cash_flow(identity, filter).await?;
        Ok(Output {
            summary: format!("Fetched {} cash-flow periods.", report.periods.len()),
            value: map_cash_flow_report(report),
        })
    }

    pub(super) async fn transactions_summary(
        &self,
        filter: TransactionsFilter,
    ) -> Result<Output<LeanTransactionsSummary>> {
        let summary = self.resolver.transactions_summary(Some(filter)).await?;
        Ok(Output {
            summary: format!(
                "Matched {} transactions totaling ${}.",
                summary.total_count,
                dollars(summary.total_amount)
            ),
            value: map_transactions_summary(summary),
        })
    }

    pub(super) async fn list_categories(&self) -> Result<Output<LeanList<LeanCategory>>> {
        let list = self.resolver.categories().await?;
        Ok(Output {
            summary: format!("Fetched {} categories.", list.items.len()),
            value: map_list(list.items, map_category),
        })
    }

    pub(super) async fn list_category_groups(&self) -> Result<Output<LeanList<LeanCategoryGroup>>> {
        let list = self.resolver.category_groups().await?;
        Ok(Output {
            summary: format!("Fetched {} category groups.", list.items.len()),
            value: map_list(list.items, map_category_group),
        })
    }

    pub(super) async fn list_accounts(&self) -> Result<Output<LeanList<LeanAccount>>> {
        let list = self.resolver.accounts().await?;
        Ok(Output {
            summary: format!("Fetched {} accounts.", list.items.len()),
            value: map_list(list.items, map_account),
        })
    }

    pub(super) async fn net_worth(
        &self,
        identity: &Identity,
        input: NetWorthInput,
    ) -> Result<Output<LeanNetWorthReport>> {
        let report = self.resolver.net_worth(input).await?;
        Ok(Output {
            summary: format!("Current net worth: ${}.", dollars(report.current_net_worth_usd)),
            value: map_net_worth_report(identity, report),
        })
    }

    pub(super) async fn portfolio_analysis(&self, input: AnalysisInput) -> Result<Output<LeanAnalysisReport>> {
        let report = self.resolver.analysis(input).await?;
        Ok(Output {
            summary: format!(
                "Analyzed ${} across {} portfolio slices.",
                dollars(report.total_value_usd),
                report.slices.len()
            ),
            value: map_analysis_report(report),
        })
    }

    pub(super) async fn list_recurring_charges(&self) -> Result<Output<LeanList<LeanRecurringCharge>>> {
        let list = self.resolver.recurring_charges().await?;
        Ok(Output {
            summary: format!("Fetched {} recurring groups.", list.items.len()),
            value: map_recurring_charge_list(list.items),
        })
    }

    pub(super) async fn list_rules(&self, input: RulesInput) -> Result<Output<LeanList<LeanRule>>> {
        let list = self.resolver.rules(Some(input)).await?;
        let rules = self.resolver.hydrate_rules(list.items).await?;
        Ok(Output {
            summary: format!("Fetched {} rules.", rules.len()),
            value: map_rule_list(rules),
        })
    }

    pub(super) async fn list_plaid_items(&self, input: PlaidItemsInput) -> Result<Output<LeanList<LeanPlaidItem>>> {
        let list = self.resolver.plaid_items(Some(input)).await?;
        let items = self.resolver.hydrate_plaid_items(list.items).await?;
        Ok(Output {
            summary: format!("Fetched {} Plaid items.", items.len()),
            value: map_plaid_item_list(items),
        })
    }

    pub(super) async fn list_plaid_credentials(&self) -> Result<Output<LeanList<LeanPlaidCredential>>> {
        let list = self.resolver.plaid_credentials().await?;
        Ok(Output {
            summary: format!("Fetched {} Plaid credentials.", list.items.len()),
            value: map_plaid_credential_list(list.items),
        })
    }

    pub(super) async fn list_owners(&self) -> Result<Output<LeanList<LeanOwner>>> {
        let list = self.resolver.owners().await?;
        Ok(Output {
            summary: format!("Fetched {} owners.", list.items.len()),
            value: map_list(list.items, map_owner),
        })
    }

    pub(super) async fn budget_report(
        &self,
        identity: &Identity,
        input: BudgetReportInput,
    ) -> Result<Output<LeanBudgetReport>> {
        let report = self.resolver.budget_report(identity, input).await?;
        Ok(Output {
            summary: format!(
                "Budget for {}: ${} income planned, ${} expenses planned, ${} actual remaining ({} sections).",
                report.month,
                dollars(report.income_budgeted),
                dollars(report.expenses_budgeted),
                dollars(report.remaining_actual),
                report.sections.len()
            ),
            value: map_budget_report(report),
        })
    }

    pub(super) async fn bulk_update_transactions(
        &self,
        input: BulkUpdateTransactionsInput,
    ) -> Result<Output<LeanBulkUpdateTransactionsPayload>> {
        let payload = self.resolver.bulk_update_transactions(input).await?;
        Ok(Output {
            summary: format!("Updated {} transactions.", payload.updated_count),
            value: map_bulk_update_transactions_payload(payload),
        })
    }

    pub(super) async fn create_rule(&self, input: CreateRuleInput) -> Result<Output<LeanRulePayload>> {
        let payload = self.resolver.create_rule(input).await?;
        let rule = self
            .resolver
            .hydrate_rules(vec![payload.rule])
            .await?
            .pop()
            .context("hydrated rule missing")?;
        Ok(Output {
            summary: format!(
                "Created rule and updated {} transactions retroactively.",
                payload.retroactively_updated
            ),
            value: LeanRulePayload {
                rule: map_rule(rule),
                retroactively_updated: payload.retroactively_updated,
            },
        })
    }

    pub(super) async fn delete_rule(&self, input: DeleteRuleInput) -> Result<Output<Success>> {
        ensure!(input.confirm, ApiError::bad_input(CONFIRM_REQUIRED));
        let payload = self.resolver.delete_rule(&input.id).await?;
        Ok(Output {
            summary: format!("Deleted rule: {}.", payload.success),
            value: Success {
                success: payload.success,
            },
        })
    }

    pub(super) async fn update_transaction(
        &self,
        input: UpdateTransactionInput,
    ) -> Result<Output<LeanTransactionPayload>> {
        let payload = self.resolver.update_transaction(input).await?;
        Ok(Output {
            value: map_transaction_payload(Some(payload.transaction)),
            summary: "Updated transaction.".to_owned(),
        })
    }

    pub(super) async fn delete_transaction(&self, input: DeleteTransactionInput) -> Result<Output<Success>> {
        ensure!(input.confirm, ApiError::bad_input(CONFIRM_REQUIRED));
        let payload = self.resolver.delete_transaction(&input.id).await?;
        Ok(Output {
            summary: format!("Deleted transaction: {}.", payload.success),
            value: Success {
                success: payload.success,
            },
        })
    }

    pub(super) async fn bulk_delete_transactions(
        &self,
        input: BulkDeleteTransactionsArguments,
    ) -> Result<Output<DeletedCount>> {
        ensure!(input.confirm, ApiError::bad_input(CONFIRM_REQUIRED));
        let transaction_ids = require_ids(input.transaction_ids, "transactionIds")?;
        let payload = self
            .resolver
            .bulk_delete_transactions(BulkDeleteTransactionsInput {
                transaction_ids,
                filter: input.filter,
            })
            .await?;
        Ok(Output {
            summary: format!("Deleted {} transactions.", payload.deleted_count),
            value: DeletedCount {
                deleted_count: payload.deleted_count,
            },
        })
    }

    pub(super) async fn create_transaction(
        &self,
        input: CreateTransactionInput,
    ) -> Result<Output<LeanTransactionPayload>> {
        let payload = self.resolver.create_transaction(input).await?;
        Ok(Output {
            value: map_transaction_payload(Some(payload.transaction)),
            summary: "Created transaction.".to_owned(),
        })
    }

    pub(super) async fn update_account(&self, input: UpdateAccountInput) -> Result<Output<LeanAccountPayload>> {
        let payload = self.resolver.update_account(input).await?;
        Ok(Output {
            value: LeanAccountPayload {
                account: map_account(payload.account),
            },
            summary: "Updated account.".to_owned(),
        })
    }

    pub(super) async fn create_manual_account(
        &self,
        input: CreateManualAccountInput,
    ) -> Result<Output<LeanAccountPayload>> {
        let payload = self.resolver.create_manual_account(input).await?;
        Ok(Output {
            value: LeanAccountPayload {
                account: map_account(payload.account),
            },
            summary: "Created manual account.".to_owned(),
        })
    }

    pub(super) async fn set_budget(&self, input: SetBudgetInput) -> Result<Output<LeanBudgetPayload>> {
        let summary = format!(
            "Set budget for category {} in {} to ${}.",
            input.category_id.as_str(),
            input.month,
            dollars(input.amount)
        );
        let payload = self.resolver.set_budget(input).await?;
        Ok(Output {
            value: LeanBudgetPayload {
                budget: map_budget(payload.budget),
            },
            summary,
        })
    }
}

#[derive(Debug, PartialEq, Serialize)]
pub(super) struct Success {
    pub(super) success: bool,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DeletedCount {
    pub(super) deleted_count: i32,
}
