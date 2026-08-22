package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"tallyo/internal/apierror"
	"tallyo/internal/graph"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
)

type noInput struct{}

type getTransactionInput struct {
	ID model.GlobalID `json:"id" validate:"required"`
}

type deleteTransactionInput struct {
	ID      model.GlobalID `json:"id"      validate:"required"`
	Confirm bool           `json:"confirm" validate:"required"`
}

type deleteRuleInput struct {
	ID      model.GlobalID `json:"id"      validate:"required"`
	Confirm bool           `json:"confirm" validate:"required"`
}

type bulkDeleteTransactionsInput struct {
	TransactionIds []*model.GlobalID         `json:"transactionIds,omitempty"`
	Filter         *model.TransactionsFilter `json:"filter,omitempty"`
	Confirm        bool                      `json:"confirm" validate:"required"`
}

func (s *Server) registerTools(srv *mcpserver.MCPServer) {
	s.addQueryTools(srv)
	s.addMutationTools(srv)
}

func addTool[T any](srv *mcpserver.MCPServer, logger *slog.Logger, name, description, operationType, operationName string, annotations []mcp.ToolOption, handler func(context.Context, T) (any, string, error)) {
	opts := []mcp.ToolOption{mcp.WithDescription(description), withInputSchema[T]()}
	opts = append(opts, annotations...)
	srv.AddTool(mcp.NewTool(name, opts...), func(ctx context.Context, req mcp.CallToolRequest) (result *mcp.CallToolResult, err error) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.ErrorContext(ctx, "mcp tool panic", "tool", name, "panic", recovered)
				result = mcp.NewToolResultError(apierror.InternalMessage)
				err = nil
			}
		}()
		if err := graph.RequireOperationScope(ctx, operationType, operationName); err != nil {
			return toolError(ctx, logger, name, err), nil
		}
		var input T
		if err := req.BindArguments(&input); err != nil {
			return publicToolError(err), nil
		}
		if err := u.Validator.Struct(input); err != nil {
			return publicToolError(err), nil
		}
		value, summary, err := handler(ctx, input)
		if err != nil {
			return toolError(ctx, logger, name, err), nil
		}
		return toolResult(value, summary), nil
	})
}

func toolError(ctx context.Context, logger *slog.Logger, tool string, err error) *mcp.CallToolResult {
	if publicErr, ok := errors.AsType[*apierror.Error](err); ok {
		return mcp.NewToolResultError(publicErr.Message)
	}
	logger.ErrorContext(ctx, "mcp tool error", "tool", tool, "error", err)
	return mcp.NewToolResultError(apierror.InternalMessage)
}

func publicToolError(err error) *mcp.CallToolResult {
	return mcp.NewToolResultError(err.Error())
}

func addQueryTool[T any](srv *mcpserver.MCPServer, logger *slog.Logger, name, operationName, description string, handler func(context.Context, T) (any, string, error)) {
	addTool(srv, logger, name, description, "Query", operationName, []mcp.ToolOption{mcp.WithReadOnlyHintAnnotation(true)}, handler)
}

func addMutationTool[T any](srv *mcpserver.MCPServer, logger *slog.Logger, name, operationName, description string, handler func(context.Context, T) (any, string, error)) {
	addTool(srv, logger, name, description, "Mutation", operationName, []mcp.ToolOption{mcp.WithReadOnlyHintAnnotation(false)}, handler)
}

func addDestructiveMutationTool[T any](srv *mcpserver.MCPServer, logger *slog.Logger, name, operationName, description string, handler func(context.Context, T) (any, string, error)) {
	annotations := []mcp.ToolOption{mcp.WithReadOnlyHintAnnotation(false), mcp.WithDestructiveHintAnnotation(true)}
	addTool(srv, logger, name, description, "Mutation", operationName, annotations, handler)
}

func (s *Server) addQueryTools(srv *mcpserver.MCPServer) {
	addQueryTool(srv, s.log, "list_transactions", "transactions", "Paginated transaction list with filtering and sorting.", s.listTransactions)
	addQueryTool(srv, s.log, "get_transaction", "transaction", "Get a single transaction by ID.", s.getTransaction)
	addQueryTool(srv, s.log, "spending_by_category", "spendingByCategory", "Get spending totals grouped by category for a date range. Excludes transfers, income, and hidden transactions by default.", s.spendingByCategory)
	addQueryTool(srv, s.log, "cash_flow", "cashFlow", "Get income, expenses, savings, and category breakdowns per period. Excludes transfers but includes income.", s.cashFlow)
	addQueryTool(srv, s.log, "transactions_summary", "transactionsSummary", "Get aggregate statistics for transactions matching a filter.", s.transactionsSummary)
	addQueryTool(srv, s.log, "list_categories", "categories", "List all categories.", s.listCategories)
	addQueryTool(srv, s.log, "list_category_groups", "categoryGroups", "List categories grouped by group name.", s.listCategoryGroups)
	addQueryTool(srv, s.log, "list_accounts", "accounts", "List all linked and manual accounts.", s.listAccounts)
	addQueryTool(srv, s.log, "net_worth", "netWorth", "Get current net worth, asset-class breakdowns, and holdings rollups.", s.netWorth)
	addQueryTool(srv, s.log, "portfolio_analysis", "analysis", "Get portfolio allocation analysis by composition, Morningstar category/group, or sectors.", s.portfolioAnalysis)
	addQueryTool(srv, s.log, "list_recurring_charges", "recurringCharges", "List detected recurring charges.", s.listRecurringCharges)
	addQueryTool(srv, s.log, "list_rules", "rules", "List auto-categorization rules, optionally filtered by merchant pattern, original-name pattern, account IDs, or amount bounds.", s.listRules)
	addQueryTool(srv, s.log, "list_plaid_items", "plaidItems", "List Plaid items/institutions. Secrets are never returned.", s.listPlaidItems)
	addQueryTool(srv, s.log, "list_plaid_credentials", "plaidCredentials", "List Plaid credentials without secrets.", s.listPlaidCredentials)
	addQueryTool(srv, s.log, "list_owners", "owners", "List configured valid owner names.", s.listOwners)
	addQueryTool(srv, s.log, "budget_report", "budgetReport", "Get budget targets vs actual spending for a month, grouped by category group.", s.budgetReport)
}

func (s *Server) addMutationTools(srv *mcpserver.MCPServer) {
	addMutationTool(srv, s.log, "bulk_update_transactions", "bulkUpdateTransactions", "Batch-update transaction merchant name, notes, recurring flag, hidden flag, category, or tags.", s.bulkUpdateTransactions)
	addMutationTool(srv, s.log, "create_rule", "createRule", "Create an auto-categorization rule, optionally applying it retroactively.", s.createRule)
	addDestructiveMutationTool(srv, s.log, "delete_rule", "deleteRule", "Delete a rule. Requires confirm=true.", s.deleteRule)
	addMutationTool(srv, s.log, "update_transaction", "updateTransaction", "Edit transaction merchant name, notes, recurring flag, hidden flag, category, or tags.", s.updateTransaction)
	addDestructiveMutationTool(srv, s.log, "delete_transaction", "deleteTransaction", "Permanently delete one transaction. Requires confirm=true.", s.deleteTransaction)
	addDestructiveMutationTool(srv, s.log, "bulk_delete_transactions", "bulkDeleteTransactions", "Permanently delete transactions by IDs or filter. Requires confirm=true.", s.bulkDeleteTransactions)
	addMutationTool(srv, s.log, "create_transaction", "createTransaction", "Create a manual transaction with a synthetic manual-* ID.", s.createTransaction)
	addMutationTool(srv, s.log, "update_account", "updateAccount", "Update account name, owner, type, subtype, closed, or hidden state.", s.updateAccount)
	addMutationTool(srv, s.log, "create_manual_account", "createManualAccount", "Create a manual account, optionally under an existing connection.", s.createManualAccount)
	addMutationTool(srv, s.log, "set_budget", "setBudget", "Set (insert or update) the budget target for a category in a month.", s.setBudget)
}

func (s *Server) listTransactions(ctx context.Context, in model.TransactionsInput) (any, string, error) {
	conn, err := s.resolver.Transactions(ctx, &in)
	if err != nil {
		return nil, "", err
	}
	return mapTransactionConnection(conn), fmt.Sprintf("Fetched %d transactions (%d total).", len(conn.Edges), conn.TotalCount), nil
}

func (s *Server) getTransaction(ctx context.Context, in getTransactionInput) (any, string, error) {
	tx, err := s.resolver.GetTransaction(ctx, in.ID)
	if err != nil {
		return nil, "", err
	}
	if tx == nil {
		return map[string]any{"transaction": nil}, "Transaction not found.", nil
	}
	return mapTransactionPayload(tx), "Fetched transaction.", nil
}

func (s *Server) spendingByCategory(ctx context.Context, in model.SpendingFilter) (any, string, error) {
	if in.DatetimeRange == nil {
		return nil, "", apierror.Publicf("datetimeRange is required")
	}
	report, err := s.resolver.SpendingByCategory(ctx, in)
	if err != nil {
		return nil, "", err
	}
	return mapSpendingByCategoryReport(report), fmt.Sprintf("Total spending: $%.2f across %d transactions.", report.TotalAmount.Dollars(), report.TransactionCount), nil
}

func (s *Server) cashFlow(ctx context.Context, in model.SpendingFilter) (any, string, error) {
	if in.DatetimeRange == nil {
		return nil, "", apierror.Publicf("datetimeRange is required")
	}
	report, err := s.resolver.CashFlow(ctx, in)
	if err != nil {
		return nil, "", err
	}
	return mapCashFlowReport(report), fmt.Sprintf("Fetched %d cash-flow periods.", len(report.Periods)), nil
}

func (s *Server) transactionsSummary(ctx context.Context, in model.TransactionsFilter) (any, string, error) {
	summary, err := s.resolver.TransactionsSummary(ctx, &in)
	if err != nil {
		return nil, "", err
	}
	return summary, fmt.Sprintf("Matched %d transactions totaling $%.2f.", summary.TotalCount, summary.TotalAmount.Dollars()), nil
}

func (s *Server) listCategories(ctx context.Context, _ noInput) (any, string, error) {
	result, err := s.resolver.Categories(ctx)
	if err != nil {
		return nil, "", err
	}
	return result, fmt.Sprintf("Fetched %d categories.", len(result.Items)), nil
}

func (s *Server) listCategoryGroups(ctx context.Context, _ noInput) (any, string, error) {
	result, err := s.resolver.CategoryGroups(ctx)
	if err != nil {
		return nil, "", err
	}
	return result, fmt.Sprintf("Fetched %d category groups.", len(result.Items)), nil
}

func (s *Server) listAccounts(ctx context.Context, _ noInput) (any, string, error) {
	result, err := s.resolver.Accounts(ctx)
	if err != nil {
		return nil, "", err
	}
	return mapAccountList(result), fmt.Sprintf("Fetched %d accounts.", len(result.Items)), nil
}

func (s *Server) netWorth(ctx context.Context, in model.NetWorthInput) (any, string, error) {
	report, err := s.resolver.NetWorth(ctx, in)
	if err != nil {
		return nil, "", err
	}
	return mapNetWorthReport(ctx, report), fmt.Sprintf("Current net worth: $%.2f.", report.CurrentNetWorthUsd.Dollars()), nil
}

func (s *Server) portfolioAnalysis(ctx context.Context, in model.AnalysisInput) (any, string, error) {
	if !in.View.IsValid() {
		return nil, "", apierror.Publicf("invalid analysis view %q", string(in.View))
	}
	report, err := s.resolver.Analysis(ctx, in)
	if err != nil {
		return nil, "", err
	}
	return mapAnalysisReport(report), fmt.Sprintf("Analyzed $%.2f across %d portfolio slices.", report.TotalValueUsd.Dollars(), len(report.Slices)), nil
}

func (s *Server) listRecurringCharges(ctx context.Context, _ noInput) (any, string, error) {
	result, err := s.resolver.RecurringCharges(ctx)
	if err != nil {
		return nil, "", err
	}
	return mapRecurringChargeList(result), fmt.Sprintf("Fetched %d recurring groups.", len(result.Items)), nil
}

func (s *Server) listRules(ctx context.Context, in model.RulesInput) (any, string, error) {
	result, err := s.resolver.Rules(ctx, &in)
	if err != nil {
		return nil, "", err
	}
	return mapRuleList(result), fmt.Sprintf("Fetched %d rules.", len(result.Items)), nil
}

func (s *Server) listPlaidItems(ctx context.Context, in model.PlaidItemsInput) (any, string, error) {
	result, err := s.resolver.PlaidItems(ctx, &in)
	if err != nil {
		return nil, "", err
	}
	return mapPlaidItemList(result), fmt.Sprintf("Fetched %d Plaid items.", len(result.Items)), nil
}

func (s *Server) listPlaidCredentials(ctx context.Context, _ noInput) (any, string, error) {
	result, err := s.resolver.PlaidCredentials(ctx)
	if err != nil {
		return nil, "", err
	}
	return mapPlaidCredentialList(result), fmt.Sprintf("Fetched %d Plaid credentials.", len(result.Items)), nil
}

func (s *Server) listOwners(ctx context.Context, _ noInput) (any, string, error) {
	result, err := s.resolver.GetOwners(ctx)
	if err != nil {
		return nil, "", err
	}
	return result, fmt.Sprintf("Fetched %d owners.", len(result.Items)), nil
}

func (s *Server) bulkUpdateTransactions(ctx context.Context, in model.BulkUpdateTransactionsInput) (any, string, error) {
	result, err := s.resolver.BulkUpdateTransactions(ctx, in)
	if err != nil {
		return nil, "", err
	}
	return mapBulkUpdateTransactionsPayload(result), fmt.Sprintf("Updated %d transactions.", result.UpdatedCount), nil
}

func (s *Server) createRule(ctx context.Context, in model.CreateRuleInput) (any, string, error) {
	result, err := s.resolver.CreateRule(ctx, in)
	if err != nil {
		return nil, "", err
	}
	return mapCreateRulePayload(result), fmt.Sprintf("Created rule and updated %d transactions retroactively.", result.RetroactivelyUpdated), nil
}

func (s *Server) deleteRule(ctx context.Context, in deleteRuleInput) (any, string, error) {
	result, err := s.resolver.DeleteRule(ctx, in.ID)
	if err != nil {
		return nil, "", err
	}
	return result, fmt.Sprintf("Deleted rule: %t.", result.Success), nil
}

func (s *Server) updateTransaction(ctx context.Context, in model.UpdateTransactionInput) (any, string, error) {
	result, err := s.resolver.UpdateTransaction(ctx, in)
	if err != nil {
		return nil, "", err
	}
	return mapTransactionPayload(result.Transaction), "Updated transaction.", nil
}

func (s *Server) deleteTransaction(ctx context.Context, in deleteTransactionInput) (any, string, error) {
	result, err := s.resolver.DeleteTransaction(ctx, in.ID)
	if err != nil {
		return nil, "", err
	}
	return result, fmt.Sprintf("Deleted transaction: %t.", result.Success), nil
}

func (s *Server) bulkDeleteTransactions(ctx context.Context, in bulkDeleteTransactionsInput) (any, string, error) {
	if err := requireIDs(in.TransactionIds, "transactionIds"); err != nil {
		return nil, "", err
	}
	result, err := s.resolver.BulkDeleteTransactions(ctx, model.BulkDeleteTransactionsInput{
		TransactionIds: in.TransactionIds,
		Filter:         in.Filter,
	})
	if err != nil {
		return nil, "", err
	}
	return result, fmt.Sprintf("Deleted %d transactions.", result.DeletedCount), nil
}

func requireIDs(ids []*model.GlobalID, field string) error {
	for _, id := range ids {
		if id == nil {
			return apierror.Publicf("%s contains a malformed id", field)
		}
	}
	return nil
}

func (s *Server) createTransaction(ctx context.Context, in model.CreateTransactionInput) (any, string, error) {
	result, err := s.resolver.CreateTransaction(ctx, in)
	if err != nil {
		return nil, "", err
	}
	return mapTransactionPayload(result.Transaction), "Created transaction.", nil
}

func (s *Server) updateAccount(ctx context.Context, in model.UpdateAccountInput) (any, string, error) {
	if in.Type != nil && !in.Type.IsValid() {
		return nil, "", apierror.Publicf("invalid account type %q", string(*in.Type))
	}
	result, err := s.resolver.UpdateAccount(ctx, in)
	if err != nil {
		return nil, "", err
	}
	return mapAccountPayload(result.Account), "Updated account.", nil
}

func (s *Server) createManualAccount(ctx context.Context, in model.CreateManualAccountInput) (any, string, error) {
	if !in.Type.IsValid() {
		return nil, "", apierror.Publicf("invalid account type %q", string(in.Type))
	}
	result, err := s.resolver.CreateManualAccount(ctx, in)
	if err != nil {
		return nil, "", err
	}
	return mapAccountPayload(result.Account), "Created manual account.", nil
}

func (s *Server) budgetReport(ctx context.Context, in model.BudgetReportInput) (any, string, error) {
	report, err := s.resolver.BudgetReportForMonth(ctx, in)
	if err != nil {
		return nil, "", err
	}
	return mapBudgetReport(report), fmt.Sprintf("Budget for %s: $%.2f income planned, $%.2f expenses planned, $%.2f actual remaining (%d sections).", report.Month, report.IncomeBudgeted.Dollars(), report.ExpensesBudgeted.Dollars(), report.RemainingActual.Dollars(), len(report.Sections)), nil
}

func (s *Server) setBudget(ctx context.Context, in model.SetBudgetInput) (any, string, error) {
	result, err := s.resolver.SetBudget(ctx, in)
	if err != nil {
		return nil, "", err
	}
	return map[string]leanBudget{"budget": mapBudget(result.Budget)}, fmt.Sprintf("Set budget for category %s in %s to $%.2f.", in.CategoryID, in.Month, in.Amount.Dollars()), nil
}
