package transactionsdb_test

import (
	"context"
	"testing"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
)

func TestSpendingReportsExcludeHiddenTransactions(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)
	mustUpsertSynced(t, tx, syncedTxn("visible", 25, "2026-05-15T12:00:00Z", "Visible"))
	hiddenTransaction := syncedTxn("hidden", -100, "2026-05-16T12:00:00Z", "Hidden")
	hiddenTransaction.HiddenByAccount = true
	mustUpsertSynced(t, tx, hiddenTransaction)
	from := testTime()
	to := from.AddDate(0, 1, 0)
	filter := model.SpendingFilter{DatetimeRange: &model.DateTimeRange{From: &from, To: &to}}

	spending, err := tx.SpendingByCategory(ctx, filter)
	if err != nil {
		t.Fatalf("SpendingByCategory() error = %v", err)
	}
	if spending.TransactionCount != 1 || spending.TotalAmount != money.FromDollars(25) {
		t.Fatalf("SpendingByCategory() = count %d, total %v; want 1/25", spending.TransactionCount, spending.TotalAmount)
	}

	cashFlow, err := tx.CashFlow(ctx, filter)
	if err != nil {
		t.Fatalf("CashFlow() error = %v", err)
	}
	if len(cashFlow) != 1 || cashFlow[0].Summary.Expenses != money.FromDollars(25) {
		t.Fatalf("CashFlow() = %#v; want one period with 25 in expenses", cashFlow)
	}

	includeHidden := true
	filter.IsHidden = &includeHidden
	hiddenSpending, err := tx.SpendingByCategory(ctx, filter)
	if err != nil {
		t.Fatalf("SpendingByCategory(include hidden) error = %v", err)
	}
	if hiddenSpending.TransactionCount != 1 || hiddenSpending.TotalAmount != money.FromDollars(-100) {
		t.Fatalf("SpendingByCategory(include hidden) = count %d, total %v; want 1/-100", hiddenSpending.TransactionCount, hiddenSpending.TotalAmount)
	}
}
