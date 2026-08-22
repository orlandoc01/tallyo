package budgetsdb

import (
	"context"
	"fmt"

	"tallyo/internal/budgets"
	"tallyo/internal/database/dbgen"
)

// BudgetsInRange loads every budgeted line across the requested month range
// and groups it by month, then category, for budgets.Service.BudgetReportHistory
// to assemble per-month reports from.
func (s *Store) BudgetsInRange(ctx context.Context, startMonth, endMonth *string) (map[string]map[int64]budgets.BudgetEntry, error) {
	rows, err := s.q.BudgetsInRange(ctx, dbgen.BudgetsInRangeParams{StartMonth: startMonth, EndMonth: endMonth})
	if err != nil {
		return nil, fmt.Errorf("load budgets in range: %w", err)
	}
	byMonth := make(map[string]map[int64]budgets.BudgetEntry)
	for _, row := range rows {
		monthEntries := byMonth[row.Month]
		if monthEntries == nil {
			monthEntries = make(map[int64]budgets.BudgetEntry)
			byMonth[row.Month] = monthEntries
		}
		monthEntries[row.CategoryID] = budgets.BudgetEntry{ID: row.ID, AmountCents: row.AmountCents}
	}
	return byMonth, nil
}
