package budgetsdb_test

import (
	"context"
	"testing"

	"tallyo/internal/budgets"
	budgetsdb "tallyo/internal/budgets/db"
	"tallyo/internal/graph/model"
	transactionsdb "tallyo/internal/transactions/db"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

type budgetTestStore struct {
	*test.Store
	Budgets      *budgetsdb.Store
	Transactions *transactionsdb.Store
}

func TestBudgetStoreCRUD(t *testing.T) {
	ctx := context.Background()
	root := openStore(t)
	store := root.Budgets
	category := firstCategory(t, root)

	budget := mustSetBudget(t, store, model.SetBudgetInput{Month: "2026-06", CategoryID: category.ID, Amount: 400})
	if budget.ID.Int64() == 0 || budget.Category == nil || budget.Category.ID != category.ID || budget.Amount != 400 {
		t.Fatalf("SetBudget() = %#v", budget)
	}

	updated := mustSetBudget(t, store, model.SetBudgetInput{Month: "2026-06", CategoryID: category.ID, Amount: 450})
	if updated.ID != budget.ID || updated.Amount != 450 {
		t.Fatalf("updated budget = %#v", updated)
	}

	loaded, err := store.BudgetByID(ctx, budget.ID.Int64())
	if err != nil || loaded == nil || loaded.ID != budget.ID {
		t.Fatalf("BudgetByID() = %#v, %v", loaded, err)
	}
	missing, err := store.BudgetByID(ctx, 999999)
	if err != nil || missing != nil {
		t.Fatalf("BudgetByID(missing) = %#v, %v", missing, err)
	}

	startMonth := "2026-06"
	endMonth := "2026-07"
	budgetedByMonth, err := store.BudgetsInRange(ctx, &startMonth, &endMonth)
	must.NoErr(t, err)
	budgeted := budgetedByMonth[startMonth]
	if budgeted[category.ID.Int64()] != (budgets.BudgetEntry{ID: budget.ID.Int64(), AmountCents: 450}) {
		t.Fatalf("budgeted = %#v", budgeted)
	}

	deleted, err := store.DeleteBudget(ctx, model.DeleteBudgetInput{ID: budget.ID})
	if err != nil || !deleted {
		t.Fatalf("DeleteBudget() = %v, %v", deleted, err)
	}
	deleted, err = store.DeleteBudget(ctx, model.DeleteBudgetInput{ID: budget.ID})
	if err != nil || deleted {
		t.Fatalf("DeleteBudget(second) = %v, %v", deleted, err)
	}
}

func TestBudgetStoreInvalidIDs(t *testing.T) {
	ctx := context.Background()
	root := openStore(t)
	store := root.Budgets

	if _, err := store.SetBudget(ctx, model.SetBudgetInput{Month: "2026-06", CategoryID: model.New(model.GlobalIDCategory, 999999), Amount: 1}); err == nil {
		t.Fatal("expected unknown category insert to fail")
	}
	startMonth := "2099-01"
	endMonth := "2099-02"
	budgetedByMonth, err := store.BudgetsInRange(ctx, &startMonth, &endMonth)
	if err != nil || len(budgetedByMonth[startMonth]) != 0 {
		t.Fatalf("BudgetsInRange(empty) = %#v, %v", budgetedByMonth, err)
	}
}

func TestBudgetStoreCopyAndHistory(t *testing.T) {
	ctx := context.Background()
	root := openStore(t)
	store := root.Budgets
	categories, err := root.Transactions.Categories(ctx)
	must.NoErr(t, err)
	first := categories[0]
	second := categories[1]

	mustSetBudget(t, store, model.SetBudgetInput{Month: "2026-05", CategoryID: first.ID, Amount: 100})
	mustSetBudget(t, store, model.SetBudgetInput{Month: "2026-05", CategoryID: second.ID, Amount: 200})
	mustSetBudget(t, store, model.SetBudgetInput{Month: "2026-06", CategoryID: first.ID, Amount: 300})
	copied, err := store.CopyBudgets(ctx, model.CopyBudgetsInput{FromMonth: "2026-05", ToMonth: "2026-06"})
	if err != nil || copied != 1 {
		t.Fatalf("CopyBudgets() = %d, %v", copied, err)
	}

	byMonth, err := store.BudgetsInRange(ctx, nil, nil)
	must.NoErr(t, err)
	if len(byMonth) != 2 {
		t.Fatalf("byMonth = %#v", byMonth)
	}
	// CopyBudgets skips existing rows: 2026-06's own first-category budget
	// (300) survives untouched; only the second category gets copied in.
	if entries := byMonth["2026-06"]; len(entries) != 2 || entries[first.ID.Int64()].AmountCents != 300 || entries[second.ID.Int64()].AmountCents != 200 {
		t.Fatalf("2026-06 entries = %#v", entries)
	}
	if entries := byMonth["2026-05"]; len(entries) != 2 || entries[first.ID.Int64()].AmountCents != 100 || entries[second.ID.Int64()].AmountCents != 200 {
		t.Fatalf("2026-05 entries = %#v", entries)
	}

	startMonth := "2026-06"
	endMonth := "2026-07"
	scoped, err := store.BudgetsInRange(ctx, &startMonth, &endMonth)
	must.NoErr(t, err)
	if len(scoped) != 1 {
		t.Fatalf("scoped byMonth = %#v", scoped)
	}
	if _, ok := scoped["2026-06"]; !ok {
		t.Fatalf("scoped byMonth missing 2026-06: %#v", scoped)
	}
}

func openStore(t *testing.T) *budgetTestStore {
	t.Helper()
	store := test.OpenStore(t)
	return &budgetTestStore{Store: store, Budgets: budgetsdb.New(store.Database()), Transactions: transactionsdb.New(store.Database())}
}

func mustSetBudget(tb testing.TB, store *budgetsdb.Store, input model.SetBudgetInput) *model.Budget {
	tb.Helper()
	budgetID, err := store.SetBudget(context.Background(), input)
	must.NoErr(tb, err)
	budget, err := store.BudgetByID(context.Background(), budgetID)
	must.NoErr(tb, err)
	return budget
}

func firstCategory(t *testing.T, store *budgetTestStore) *model.Category {
	t.Helper()
	categories, err := store.Transactions.Categories(context.Background())
	must.NoErr(t, err)
	for _, category := range categories {
		if category.ID.Int64() != 0 {
			return category
		}
	}
	t.Fatal("no seeded category found")
	return nil
}
