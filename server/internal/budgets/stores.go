package budgets

import (
	"context"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/transactions"
)

type Store interface {
	// BudgetsInRange returns budgeted lines grouped by month then category
	// for months that have budget rows in [startMonth, endMonth).
	BudgetsInRange(ctx context.Context, startMonth, endMonth *string) (map[string]map[int64]BudgetEntry, error)
	BudgetByID(ctx context.Context, id int64) (*model.Budget, error)
	SetBudget(ctx context.Context, input model.SetBudgetInput) (int64, error)
	DeleteBudget(ctx context.Context, input model.DeleteBudgetInput) (bool, error)
	CopyBudgets(ctx context.Context, input model.CopyBudgetsInput) (int32, error)
}

type SpendingProvider interface {
	SpendingRows(ctx context.Context, filter model.SpendingFilter, byCategory, excludeIncome bool) ([]transactions.SpendingRow, error)
}

type CategoryProvider interface {
	CategoryGroups(ctx context.Context) ([]*model.CategoryGroup, error)
	Category(ctx context.Context, id int64) (*model.Category, error)
}

type BudgetEntry struct {
	ID          int64
	AmountCents money.Cents
}
