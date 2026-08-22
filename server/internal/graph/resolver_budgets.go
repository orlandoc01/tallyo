package graph

import (
	"context"

	"tallyo/internal/graph/model"
)

func (r *Resolver) BudgetReportForMonth(ctx context.Context, input model.BudgetReportInput) (*model.BudgetReport, error) {
	return r.Budgets.BudgetReport(ctx, input)
}

func (r *Resolver) BudgetReportHistory(ctx context.Context, input model.BudgetReportHistoryInput) (*model.BudgetReportHistory, error) {
	return r.Budgets.BudgetReportHistory(ctx, input)
}

func (r *Resolver) SetBudget(ctx context.Context, input model.SetBudgetInput) (*model.SetBudgetPayload, error) {
	if err := input.CategoryID.ValidateType(model.GlobalIDCategory); err != nil {
		return nil, err
	}
	budget, err := r.Budgets.SetBudget(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.SetBudgetPayload{Budget: budget}, nil
}

func (r *Resolver) DeleteBudget(ctx context.Context, input model.DeleteBudgetInput) (*model.DeleteBudgetPayload, error) {
	if err := input.ID.ValidateType(model.GlobalIDBudget); err != nil {
		return nil, err
	}
	success, err := r.Budgets.DeleteBudget(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.DeleteBudgetPayload{Success: success}, nil
}

func (r *Resolver) CopyBudgets(ctx context.Context, input model.CopyBudgetsInput) (*model.CopyBudgetsPayload, error) {
	count, err := r.Budgets.CopyBudgets(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.CopyBudgetsPayload{CopiedCount: count}, nil
}
