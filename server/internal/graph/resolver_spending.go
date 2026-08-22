package graph

import (
	"context"

	"tallyo/internal/graph/model"
)

func (r *Resolver) SpendingByCategory(ctx context.Context, filter model.SpendingFilter) (*model.SpendingByCategoryReport, error) {
	if err := model.ValidateSpendingFilterIDTypes(&filter); err != nil {
		return nil, err
	}
	return r.TransactionsStore.SpendingByCategory(ctx, filter)
}

func (r *Resolver) CashFlow(ctx context.Context, filter model.SpendingFilter) (*model.CashFlowReport, error) {
	if err := model.ValidateSpendingFilterIDTypes(&filter); err != nil {
		return nil, err
	}
	periods, err := r.TransactionsStore.CashFlow(ctx, filter)
	if err != nil {
		return nil, err
	}
	return &model.CashFlowReport{Periods: periods}, nil
}
