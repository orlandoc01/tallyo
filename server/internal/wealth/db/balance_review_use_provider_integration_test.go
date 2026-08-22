package wealthdb

import (
	"context"
	"testing"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

func TestUseProviderBalanceReviewRejectsMalformedLaterStateWithoutPartialRestore(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	accountID, assetID := seedUseProviderRollbackReview(t, store)
	goodJSON := providerHoldingJSON(t, assetID, 100)
	persistUseProviderSnapshot(t, store, accountID, "2026-07-01", 100, goodJSON)
	persistUseProviderSnapshot(t, store, accountID, "2026-07-02", 200, `{bad`)

	reviews := mustListInReviewBalanceReviews(t, store)
	if err := store.UseProviderBalanceReview(ctx, reviews[0].ID); err == nil {
		t.Fatal("UseProviderBalanceReview() error = nil, want malformed provider state error")
	}
	assertSnapshotFlagAndBalance(t, store, accountID, "2026-07-01", true, 50)
}

func TestUseProviderBalanceReviewRejectsMissingLaterStateWithoutPartialRestore(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	accountID, assetID := seedUseProviderRollbackReview(t, store)
	persistUseProviderSnapshot(t, store, accountID, "2026-07-01", 100, providerHoldingJSON(t, assetID, 100))
	persistUseProviderSnapshot(t, store, accountID, "2026-07-02", 200, providerHoldingJSON(t, assetID, 200))
	snapshotID := snapshotIDByDate(t, store, accountID, "2026-07-02")
	_, err := store.db.SQL().ExecContext(
		ctx,
		`DELETE FROM account_balance_snapshot_provider_states WHERE snapshot_id = ?`,
		snapshotID,
	)
	must.NoErr(t, err)

	reviews := mustListInReviewBalanceReviews(t, store)
	if err := store.UseProviderBalanceReview(ctx, reviews[0].ID); err == nil {
		t.Fatal("UseProviderBalanceReview() error = nil, want missing provider state error")
	}
	assertSnapshotFlagAndBalance(t, store, accountID, "2026-07-01", true, 50)
}

func seedUseProviderRollbackReview(t *testing.T, store *testStore) (int64, int64) {
	t.Helper()
	_, accountID := mustInvestmentAccount(t, store, "balance-review-account", "balance-review-owner", "Brokerage")
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "ROLLBACK",
		Classifier: model.AssetClassifierPublic,
	})
	return accountID, asset.ID.Int64()
}

func providerHoldingJSON(t *testing.T, assetID int64, valueUSD float64) string {
	t.Helper()
	holdingsJSON, err := wealth.MarshalBalanceReviewProviderHoldings([]wealth.AssetDailyHolding{{
		AssetID:           assetID,
		ValueUSD:          valueUSD,
		CountsTowardValue: true,
	}})
	must.NoErr(t, err)
	return *holdingsJSON
}

func persistUseProviderSnapshot(
	t *testing.T,
	store *testStore,
	accountID int64,
	date string,
	providerBalance int64,
	providerHoldingsJSON string,
) {
	t.Helper()
	carryBalance := int64(50)
	must.NoErr(t, store.PersistSnapshot(context.Background(), wealth.SnapshotPersist{
		SyncedAt: test.DateTime(date + "T12:00:00Z"),
		Snapshot: wealth.AccountBalanceSnapshot{
			AccountID:  accountID,
			Source:     syncerids.Plaid.Str(),
			Date:       date,
			SyncedAt:   date + "T12:00:00Z",
			BalanceUSD: money.Cents(carryBalance),
			Flagged:    true,
			FlagReason: "spike",
		},
		ProviderState: &wealth.SnapshotProviderState{
			ProviderBalanceUSD:   money.Cents(providerBalance),
			ProviderHoldingsJSON: providerHoldingsJSON,
		},
		Review: &wealth.BalanceReviewUpsert{
			AccountID:              accountID,
			FirstFlaggedDate:       date,
			LatestFlaggedDate:      date,
			FlaggedSnapshotCount:   1,
			ProviderBalanceUSD:     money.Cents(providerBalance),
			CarryForwardBalanceUSD: money.Cents(carryBalance),
			FlagReason:             "spike",
		},
	}))
}

func assertSnapshotFlagAndBalance(
	t *testing.T,
	store *testStore,
	accountID int64,
	date string,
	wantFlagged bool,
	wantBalance int64,
) {
	t.Helper()
	var flagged bool
	var balance int64
	must.NoErr(t, store.db.SQL().QueryRow(`
SELECT flagged, balance_usd_cents
FROM account_balance_daily_snapshots
WHERE account_id = ? AND date = ?`, accountID, date).Scan(&flagged, &balance))
	if flagged != wantFlagged || balance != wantBalance {
		t.Fatalf("snapshot %s = flagged %v balance %d, want %v %d", date, flagged, balance, wantFlagged, wantBalance)
	}
}

func snapshotIDByDate(t *testing.T, store *testStore, accountID int64, date string) int64 {
	t.Helper()
	var snapshotID int64
	must.NoErr(t, store.db.SQL().QueryRow(
		`SELECT id FROM account_balance_daily_snapshots WHERE account_id = ? AND date = ?`,
		accountID,
		date,
	).Scan(&snapshotID))
	return snapshotID
}
