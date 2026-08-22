package graph

import (
	"context"
	"testing"

	"tallyo/internal/auth"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func TestResolverBudgetsDelegate(t *testing.T) {
	ctx := allScopesCtx()
	resolver, store := testResolver(t)
	mutation := resolver.Mutation().(*mutationResolver)
	query := resolver.Query().(*queryResolver)
	catID := model.New(model.GlobalIDCategory, test.CategoryIDByName(t, store.Transactions, "Groceries"))

	set, err := mutation.SetBudget(ctx, model.SetBudgetInput{Month: "2026-06", CategoryID: catID, Amount: 250})
	if err != nil || set.Budget == nil || set.Budget.Amount != 250 {
		t.Fatalf("SetBudget() = %#v, %v", set, err)
	}

	report, err := query.BudgetReport(ctx, model.BudgetReportInput{Month: "2026-06"})
	must.NoErr(t, err)
	if report.ExpensesBudgeted != 250 {
		t.Fatalf("BudgetReport() total = %v", report.ExpensesBudgeted)
	}

	history, err := query.BudgetReportHistory(ctx, nil)
	if err != nil || len(history.Items) != 1 || history.Items[0].Month != "2026-06" {
		t.Fatalf("BudgetReportHistory() = %#v, %v", history, err)
	}
	if len(history.Items[0].Sections) == 0 || history.Items[0].ExpensesBudgeted != report.ExpensesBudgeted {
		t.Fatalf("BudgetReportHistory() sections = %#v", history.Items[0])
	}

	copied, err := mutation.CopyBudgets(ctx, model.CopyBudgetsInput{FromMonth: "2026-06", ToMonth: "2026-07"})
	if err != nil || copied.CopiedCount != 1 {
		t.Fatalf("CopyBudgets() = %#v, %v", copied, err)
	}

	del, err := mutation.DeleteBudget(ctx, model.DeleteBudgetInput{ID: set.Budget.ID})
	if err != nil || !del.Success {
		t.Fatalf("DeleteBudget() = %#v, %v", del, err)
	}
}

func TestBudgetOperationScopes(t *testing.T) {
	cases := []struct {
		typeName string
		field    string
		scope    string
	}{
		{"Query", "budgetReportHistory", auth.ScopeReadBudgets},
		{"Query", "budgetReport", auth.ScopeReadBudgets},
		{"Mutation", "setBudget", auth.ScopeWriteBudgets},
		{"Mutation", "deleteBudget", auth.ScopeWriteBudgets},
		{"Mutation", "copyBudgets", auth.ScopeWriteBudgets},
	}
	for _, c := range cases {
		got, err := OperationScope(c.typeName, c.field)
		must.NoErr(t, err)
		if got != c.scope {
			t.Fatalf("OperationScope(%s.%s) = %q, want %q", c.typeName, c.field, got, c.scope)
		}
		if err := RequireOperationScope(context.Background(), c.typeName, c.field); err == nil {
			t.Fatalf("%s.%s should reject empty scopes", c.typeName, c.field)
		}
		ctx := auth.ContextWithScopes(context.Background(), []string{c.scope})
		must.NoErr(t, RequireOperationScope(ctx, c.typeName, c.field))
	}
}
