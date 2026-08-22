package wealthdb

import (
	"context"
	"testing"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

func TestCreateRealEstateRollsBackInitialValuationFailure(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	owner := test.MustCreateOwner(t, store.accounts, model.CreateOwnerInput{Name: "link-rollback-owner"})
	dropTrigger := failAccountSyncStateWrites(t, ctx, store)
	defer dropTrigger()

	street := "Rollback St"
	_, err := store.CreateRealEstate(ctx, wealth.CreateRealEstateInput{
		OwnerID:          owner.ID.Int64(),
		Label:            "Rollback Home",
		Details:          wealth.RealEstateDetails{Street: &street},
		InitialValuation: realEstateValuation(1, 500000),
	})
	if err == nil {
		t.Fatal("CreateRealEstate() error = nil, want forced sync-state failure")
	}
	if rows := countRealEstateRows(t, ctx, store); rows != 0 {
		t.Fatalf("real estate rows after rollback = %d, want 0", rows)
	}
}

func TestUpdateRealEstateRollsBackValuationFailure(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	owner := test.MustCreateOwner(t, store.accounts, model.CreateOwnerInput{Name: "update-rollback-owner"})
	oldStreet := "1 Old St"
	created, err := store.CreateRealEstate(ctx, wealth.CreateRealEstateInput{
		OwnerID: owner.ID.Int64(),
		Label:   "Old Name",
		Details: wealth.RealEstateDetails{Street: &oldStreet},
	})
	must.NoErr(t, err)
	accountID := created.Account.ID.Int64()
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  accountID,
		Source:     "realestate",
		Date:       "2026-06-01",
		SyncedAt:   "2026-06-01T12:00:00Z",
		BalanceUSD: money.FromDollars(400000),
	})

	dropTrigger := failAccountSyncStateWrites(t, ctx, store)
	defer dropTrigger()
	newName := "New Name"
	newStreet := "2 New St"
	_, err = store.UpdateRealEstate(ctx, wealth.UpdateRealEstateInput{
		ConnectionID: created.Connection.ID.Int64(),
		Name:         &newName,
		Details:      wealth.RealEstateDetails{Street: &newStreet},
		Valuation:    realEstateValuation(2, 450000),
	})
	if err == nil {
		t.Fatal("UpdateRealEstate() error = nil, want forced sync-state failure")
	}

	re, err := store.RealEstateByConnectionID(ctx, created.Connection.ID.Int64())
	must.NoErr(t, err)
	if re == nil || re.Name != "Old Name" || re.Details.Street == nil || *re.Details.Street != oldStreet {
		t.Fatalf("real estate after rollback = %#v, want original details", re)
	}
	snapshots, err := store.AccountBalanceSnapshotsPage(ctx, accountID, nil, 10)
	must.NoErr(t, err)
	if len(snapshots) != 1 || snapshots[0].Date != "2026-06-01" || snapshots[0].BalanceUSD != money.FromDollars(400000) {
		t.Fatalf("snapshots after rollback = %#v, want original snapshot only", snapshots)
	}
}

func realEstateValuation(day int, dollars float64) *wealth.RealEstateValuation {
	syncedAt := time.Date(2026, 6, day, 12, 0, 0, 0, time.UTC)
	return &wealth.RealEstateValuation{
		ValueUSD: money.FromDollars(dollars),
		Date:     syncedAt.Format("2006-01-02"),
		SyncedAt: syncedAt,
		Source:   syncerids.RealEstate,
	}
}

func countRealEstateRows(tb testing.TB, ctx context.Context, store *testStore) int {
	tb.Helper()
	var count int
	must.NoErr(tb, store.db.SQL().QueryRowContext(ctx, `
SELECT
  (SELECT COUNT(*) FROM assets WHERE asset_type = 'REAL_ESTATE') +
  (SELECT COUNT(*) FROM connections WHERE source_table = 'assets') +
  (SELECT COUNT(*) FROM accounts WHERE type = 'PROPERTY') +
  (SELECT COUNT(*) FROM account_balance_daily_snapshots) +
  (SELECT COUNT(*) FROM asset_daily_holdings) +
  (SELECT COUNT(*) FROM account_sync_state)`).Scan(&count))
	return count
}

func failAccountSyncStateWrites(tb testing.TB, ctx context.Context, store *testStore) func() {
	tb.Helper()
	_, err := store.db.SQL().ExecContext(ctx, `
CREATE TRIGGER fail_account_sync_state_insert
BEFORE INSERT ON account_sync_state
BEGIN
  SELECT RAISE(ABORT, 'forced sync failure');
END;`)
	must.NoErr(tb, err)
	return func() {
		_, _ = store.db.SQL().ExecContext(ctx, "DROP TRIGGER IF EXISTS fail_account_sync_state_insert")
	}
}
