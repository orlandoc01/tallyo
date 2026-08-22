package budgetsdb

import (
	"context"
	"fmt"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
)

func (s *Store) SetBudget(ctx context.Context, input model.SetBudgetInput) (int64, error) {
	categoryID := input.CategoryID.Int64()
	budgetID, err := s.q.UpsertBudget(ctx, dbgen.UpsertBudgetParams{
		Month:       input.Month,
		CategoryID:  categoryID,
		AmountCents: input.Amount,
	})
	if err != nil {
		return 0, fmt.Errorf("upsert budget: %w", err)
	}
	return budgetID, nil
}

func (s *Store) DeleteBudget(ctx context.Context, input model.DeleteBudgetInput) (bool, error) {
	budgetID := input.ID.Int64()
	affected, err := s.q.DeleteBudget(ctx, dbgen.DeleteBudgetParams{ID: budgetID})
	if err != nil {
		return false, fmt.Errorf("delete budget: %w", err)
	}
	return affected > 0, nil
}

func budgetFromRow(row dbgen.BudgetByIDRow) *model.Budget {
	category := categoryFromRow(row.CategoryRow)
	return &model.Budget{ID: model.New(model.GlobalIDBudget, row.ID), Month: row.Month, Category: category, Amount: row.AmountCents}
}

func (s *Store) BudgetByID(ctx context.Context, id int64) (*model.Budget, error) {
	row, err := s.q.BudgetByID(ctx, dbgen.BudgetByIDParams{ID: id})
	return dbutil.MapRow(row, err, budgetFromRow)
}

func (s *Store) CopyBudgets(ctx context.Context, input model.CopyBudgetsInput) (int32, error) {
	affected, err := s.q.CopyBudgets(ctx, dbgen.CopyBudgetsParams{ToMonth: input.ToMonth, FromMonth: input.FromMonth})
	if err != nil {
		return 0, fmt.Errorf("copy budgets: %w", err)
	}
	return int32(affected), nil
}
