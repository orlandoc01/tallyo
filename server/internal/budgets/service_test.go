package budgets

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/transactions"
	u "tallyo/internal/utils"
	"tallyo/internal/utils/must"
)

func TestServiceBudgetReport(t *testing.T) {
	ctx := context.Background()
	store := &fakeStore{budgetsRange: map[string]map[int64]BudgetEntry{"2026-06": {1: {ID: 10, AmountCents: 40_000}, 2: {ID: 20, AmountCents: 200_000}}}}
	categories := &fakeCategories{groups: []*model.CategoryGroup{
		{
			ID:         model.New(model.GlobalIDCategoryGroup, 1),
			Name:       "Expenses",
			Kind:       model.CategoryKindExpense,
			Categories: []*model.Category{{ID: model.New(model.GlobalIDCategory, 1), Name: "Groceries", Kind: model.CategoryKindExpense}},
		},
		{
			ID:         model.New(model.GlobalIDCategoryGroup, 2),
			Name:       "Income",
			Kind:       model.CategoryKindIncome,
			Categories: []*model.Category{{ID: model.New(model.GlobalIDCategory, 2), Name: "Paycheck", Kind: model.CategoryKindIncome}},
		},
		{
			ID:         model.New(model.GlobalIDCategoryGroup, 3),
			Name:       "Transfers",
			Kind:       model.CategoryKindTransfer,
			Categories: []*model.Category{{ID: model.New(model.GlobalIDCategory, 3), Name: "Move", Kind: model.CategoryKindTransfer}},
		},
	}}
	spending := &fakeSpending{rows: []transactions.SpendingRow{
		{PeriodLabel: "2026-06", Category: &model.Category{ID: model.New(model.GlobalIDCategory, 1), Kind: model.CategoryKindExpense}, TotalCents: money.Cents(12_500), TransactionCount: 2},
		{PeriodLabel: "2026-06", Category: &model.Category{ID: model.New(model.GlobalIDCategory, 2), Kind: model.CategoryKindIncome}, TotalCents: money.Cents(-200_000), TransactionCount: 1},
	}}
	svc := &Service{Store: store, Spending: spending, Categories: categories}

	report, err := svc.BudgetReport(ctx, model.BudgetReportInput{Month: "2026-06"})
	must.NoErr(t, err)
	if report.ExpensesBudgeted != 40_000 || report.ExpensesActual != 12_500 || report.IncomeBudgeted != 200_000 || report.IncomeActual != 200_000 {
		t.Fatalf("report totals = %#v", report)
	}
	if len(report.Sections) != 2 {
		t.Fatalf("sections = %d, want expense and income", len(report.Sections))
	}
}

func TestServiceValidation(t *testing.T) {
	ctx := context.Background()
	svc := &Service{
		Store:      &fakeStore{},
		Spending:   &fakeSpending{},
		Categories: &fakeCategories{category: &model.Category{ID: model.New(model.GlobalIDCategory, 1)}},
	}
	if _, err := svc.BudgetReport(ctx, model.BudgetReportInput{Month: "bad"}); err == nil {
		t.Fatal("expected malformed report month to fail")
	}
	if _, err := svc.SetBudget(ctx, model.SetBudgetInput{Month: "2026-06", CategoryID: model.New(model.GlobalIDCategory, 1), Amount: -1}); err == nil {
		t.Fatal("expected negative budget amount to fail")
	}
	if _, err := svc.CopyBudgets(ctx, model.CopyBudgetsInput{FromMonth: "bad", ToMonth: "2026-06"}); err == nil {
		t.Fatal("expected malformed fromMonth to fail")
	}
	if _, err := svc.CopyBudgets(ctx, model.CopyBudgetsInput{FromMonth: "2026-05", ToMonth: "bad"}); err == nil {
		t.Fatal("expected malformed toMonth to fail")
	}
	if _, err := svc.CopyBudgets(ctx, model.CopyBudgetsInput{FromMonth: "2026-06", ToMonth: "2026-06"}); err == nil {
		t.Fatal("expected same-month copy to fail")
	}
	loc, err := budgetReportLocation(u.ContextWithTimezone(ctx, "America/Los_Angeles"))
	if err != nil || loc.String() != "America/Los_Angeles" {
		t.Fatalf("budgetReportLocation() = %v, %v", loc, err)
	}
}

func TestServiceDelegatesAndWrapsErrors(t *testing.T) {
	ctx := context.Background()
	store := &fakeStore{
		budgetsRange: map[string]map[int64]BudgetEntry{"2026-06": {}},
		budget:       &model.Budget{ID: model.New(model.GlobalIDBudget, 7)},
		budgetID:     1,
	}
	categories := &fakeCategories{groups: []*model.CategoryGroup{}, category: &model.Category{ID: model.New(model.GlobalIDCategory, 1)}}
	svc := &Service{
		Store:      store,
		Spending:   &fakeSpending{rows: []transactions.SpendingRow{{Category: nil, TotalCents: 9900}}},
		Categories: categories,
	}

	if history, err := svc.BudgetReportHistory(ctx, model.BudgetReportHistoryInput{}); err != nil || len(history.Items) != 1 {
		t.Fatalf("BudgetReportHistory() = %#v, %v", history, err)
	}
	if budget, err := svc.BudgetByID(ctx, 7); err != nil || budget.ID.Int64() != 7 {
		t.Fatalf("BudgetByID() = %#v, %v", budget, err)
	}
	if budget, err := svc.SetBudget(ctx, model.SetBudgetInput{Month: "2026-06", CategoryID: model.New(model.GlobalIDCategory, 1), Amount: 10}); err != nil || budget.Month != "2026-06" || budget.Category != categories.category {
		t.Fatalf("SetBudget() = %#v, %v", budget, err)
	}
	if deleted, err := svc.DeleteBudget(ctx, model.DeleteBudgetInput{ID: model.New(model.GlobalIDBudget, 7)}); err != nil || !deleted {
		t.Fatalf("DeleteBudget() = %v, %v", deleted, err)
	}
	if copied, err := svc.CopyBudgets(ctx, model.CopyBudgetsInput{FromMonth: "2026-05", ToMonth: "2026-06"}); err != nil || copied != 1 {
		t.Fatalf("CopyBudgets() = %d, %v", copied, err)
	}

	svc.Categories = &fakeCategories{categoryErr: errors.New("category boom")}
	if _, err := svc.SetBudget(ctx, model.SetBudgetInput{Month: "2026-06", CategoryID: model.New(model.GlobalIDCategory, 1), Amount: 10}); err == nil || !strings.Contains(err.Error(), "load budget category") {
		t.Fatalf("SetBudget category error = %v", err)
	}
	svc.Categories = &fakeCategories{}
	if _, err := svc.SetBudget(ctx, model.SetBudgetInput{Month: "2026-06", CategoryID: model.New(model.GlobalIDCategory, 1), Amount: 10}); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("SetBudget missing category error = %v", err)
	}

	svc.Categories = &fakeCategories{category: &model.Category{ID: model.New(model.GlobalIDCategory, 1)}, groupsErr: errors.New("groups boom")}
	if _, err := svc.BudgetReport(ctx, model.BudgetReportInput{Month: "2026-06"}); err == nil || !strings.Contains(err.Error(), "load category groups") {
		t.Fatalf("BudgetReport category groups error = %v", err)
	}
	svc.Categories = categories
	svc.Spending = &fakeSpending{err: errors.New("spend boom")}
	if _, err := svc.BudgetReport(ctx, model.BudgetReportInput{Month: "2026-06"}); err == nil || !strings.Contains(err.Error(), "compute actual spend") {
		t.Fatalf("BudgetReport spending error = %v", err)
	}
	svc.Spending = &fakeSpending{}
	svc.Store = &fakeStore{budgetsRangeErr: errors.New("budget boom")}
	if _, err := svc.BudgetReport(ctx, model.BudgetReportInput{Month: "2026-06"}); err == nil || !strings.Contains(err.Error(), "load budgets") {
		t.Fatalf("BudgetReport budget error = %v", err)
	}
}

func TestBudgetReportHistoryMonthLimit(t *testing.T) {
	ctx := context.Background()
	categories := &fakeCategories{groups: []*model.CategoryGroup{}}
	spending := &fakeSpending{}

	svc := &Service{Store: &fakeStore{budgetsRange: monthsMap(maxBudgetReportHistoryMonths)}, Spending: spending, Categories: categories}
	history, err := svc.BudgetReportHistory(ctx, model.BudgetReportHistoryInput{})
	if err != nil || len(history.Items) != maxBudgetReportHistoryMonths {
		t.Fatalf("BudgetReportHistory() at limit = %#v, %v", history, err)
	}

	svc.Store = &fakeStore{budgetsRange: monthsMap(maxBudgetReportHistoryMonths + 1)}
	if _, err := svc.BudgetReportHistory(ctx, model.BudgetReportHistoryInput{}); err == nil || !strings.Contains(err.Error(), "121 months (max 120)") {
		t.Fatalf("expected over-limit error, got %v", err)
	}
}

func monthsMap(n int) map[string]map[int64]BudgetEntry {
	months := make(map[string]map[int64]BudgetEntry, n)
	start := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := range n {
		months[start.AddDate(0, i, 0).Format("2006-01")] = map[int64]BudgetEntry{}
	}
	return months
}

type fakeStore struct {
	budgetsRange    map[string]map[int64]BudgetEntry
	budgetsRangeErr error
	budget          *model.Budget
	budgetID        int64
}

func (s *fakeStore) BudgetsInRange(context.Context, *string, *string) (map[string]map[int64]BudgetEntry, error) {
	if s.budgetsRangeErr != nil {
		return nil, s.budgetsRangeErr
	}
	return s.budgetsRange, nil
}

func (s *fakeStore) BudgetByID(context.Context, int64) (*model.Budget, error) { return s.budget, nil }

func (s *fakeStore) SetBudget(context.Context, model.SetBudgetInput) (int64, error) {
	return s.budgetID, nil
}

func (s *fakeStore) DeleteBudget(context.Context, model.DeleteBudgetInput) (bool, error) {
	return true, nil
}

func (s *fakeStore) CopyBudgets(context.Context, model.CopyBudgetsInput) (int32, error) {
	return 1, nil
}

type fakeSpending struct {
	rows []transactions.SpendingRow
	err  error
}

func (s *fakeSpending) SpendingRows(context.Context, model.SpendingFilter, transactions.SpendingMode) ([]transactions.SpendingRow, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.rows, nil
}

type fakeCategories struct {
	groups      []*model.CategoryGroup
	groupsErr   error
	category    *model.Category
	categoryErr error
}

func (c *fakeCategories) CategoryGroups(context.Context) ([]*model.CategoryGroup, error) {
	if c.groupsErr != nil {
		return nil, c.groupsErr
	}
	return c.groups, nil
}

func (c *fakeCategories) Category(context.Context, int64) (*model.Category, error) {
	if c.categoryErr != nil {
		return nil, c.categoryErr
	}
	return c.category, nil
}
