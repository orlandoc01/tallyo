package transactionsdb

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	accountsdb "tallyo/internal/accounts/db"
	admindb "tallyo/internal/admin/db"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbtest"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func TestInsertTransactionConflictLeavesExistingRowUnchanged(t *testing.T) {
	ctx := context.Background()
	db := dbtest.Open(t)
	store := New(db)
	accountsStore := accountsdb.New(db)
	adminStore := admindb.New(db)
	first := test.SeedPlaidAccount(t, accountsStore, adminStore, "conflict-acc-1", "alex")
	second := test.SeedPlaidAccount(t, accountsStore, adminStore, "conflict-acc-2", "alex")

	dt := test.DateTime("2026-05-20T00:00:00Z")
	base := dbgen.InsertTransactionParams{
		Source: "manual", ExternalID: "manual-conflict-test",
		AccountID: first.ID.Int64(), AmountCents: money.FromDollars(10),
		Datetime: dt, PostedDatetime: dt, CategoryID: UncategorizedCategoryID,
	}

	firstID, err := store.q.InsertTransaction(ctx, base)
	must.NoErr(t, err)

	conflicting := base
	conflicting.AccountID = second.ID.Int64()
	conflicting.AmountCents = money.FromDollars(99)
	if _, err := store.q.InsertTransaction(ctx, conflicting); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("InsertTransaction() conflict error = %v, want sql.ErrNoRows", err)
	}

	unchanged, err := store.Transaction(ctx, firstID)
	must.NoErr(t, err)
	if unchanged.Account.ID != first.ID || unchanged.Amount != money.FromDollars(10) {
		t.Fatalf("existing row changed after conflicting insert: %#v", unchanged)
	}
}
