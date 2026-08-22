package wealthdb

import (
	"context"
	"slices"
	"testing"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	"tallyo/internal/wealth"
)

func TestSnapshotEditorStoreQueriesAndUpdate(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	_, accountID := mustInvestmentAccount(t, store, "balance-review-account", "balance-review-owner", "Brokerage")

	missing, err := store.GetAccountBalanceSnapshotByID(ctx, -1)
	if err != nil || missing != nil {
		t.Fatalf("GetAccountBalanceSnapshotByID(missing) = %#v, %v", missing, err)
	}
	missing, err = store.LatestAccountBalanceSnapshotInWindow(
		ctx,
		accountID,
		"2026-01-01T00:00:00Z",
		"2026-01-02T00:00:00Z",
	)
	if err != nil || missing != nil {
		t.Fatalf("LatestAccountBalanceSnapshotInWindow(missing) = %#v, %v", missing, err)
	}
	missing, err = store.LatestAccountBalanceSnapshotForAccount(ctx, -1)
	if err != nil || missing != nil {
		t.Fatalf("LatestAccountBalanceSnapshotForAccount(missing) = %#v, %v", missing, err)
	}

	securityName := "Snapshot Editor Fund"
	trackingTicker := "EDIT"
	lastPrice := 48.75
	lastPriceAt := time.Date(2026, 6, 26, 14, 30, 0, 0, time.UTC)
	security := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:          model.AssetTypeSecurity,
		Identifier:         "EDIT",
		Name:               &securityName,
		Classifier:         model.AssetClassifierPublic,
		TrackingTicker:     &trackingTicker,
		TrackingMultiplier: 1.25,
		LastPrice:          &lastPrice,
		LastPriceAt:        &lastPriceAt,
	})
	cashName := "US Dollar"
	cash := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:          model.AssetTypeCurrency,
		Identifier:         "USD:snapshot-editor-db",
		Name:               &cashName,
		Classifier:         model.AssetClassifierCash,
		TrackingMultiplier: 1,
	})

	quantity := 2.0
	price := 50.0
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  accountID,
		Source:     "plaid",
		Date:       "2026-06-25",
		SyncedAt:   "2026-06-26T02:00:00Z",
		BalanceUSD: 90,
		Holdings: []wealth.AssetDailyHolding{{
			AssetID:           security.ID.Int64(),
			Quantity:          &quantity,
			Price:             &price,
			ValueUSD:          90,
			CountsTowardValue: true,
		}},
	})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  accountID,
		Source:     "plaid",
		Date:       "2026-06-26",
		SyncedAt:   "2026-06-26T15:00:00Z",
		BalanceUSD: 100,
		Flagged:    true,
		FlagReason: "spike",
		Holdings: []wealth.AssetDailyHolding{{
			AssetID:           security.ID.Int64(),
			Quantity:          &quantity,
			Price:             &price,
			ValueUSD:          100,
			CountsTowardValue: true,
		}},
	})

	latest, err := store.LatestAccountBalanceSnapshotForAccount(ctx, accountID)
	must.NoErr(t, err)
	if latest == nil || latest.BalanceUSD != 100 || !latest.Flagged || latest.Date != "2026-06-26" {
		t.Fatalf("latest = %#v, want flagged 2026-06-26 balance 100", latest)
	}
	latestByAccount, err := store.LatestAccountBalanceSnapshotsForAccounts(ctx, []int64{accountID, -1})
	must.NoErr(t, err)
	if len(latestByAccount) != 1 || latestByAccount[accountID].ID != latest.ID || latestByAccount[accountID].AccountType != model.AccountTypeInvestment {
		t.Fatalf("LatestAccountBalanceSnapshotsForAccounts = %#v, want latest investment snapshot", latestByAccount)
	}
	window, err := store.LatestAccountBalanceSnapshotInWindow(
		ctx,
		accountID,
		"2026-06-26T00:00:00Z",
		"2026-06-27T00:00:00Z",
	)
	must.NoErr(t, err)
	if window == nil || window.ID != latest.ID || window.SyncedAt != "2026-06-26T15:00:00Z" {
		t.Fatalf("window = %#v, want latest snapshot", window)
	}
	byID := mustAccountBalanceSnapshotByID(t, store, latest.ID)
	if byID == nil || byID.ID != latest.ID || byID.Source != "plaid" {
		t.Fatalf("byID = %#v, want plaid snapshot %d", byID, latest.ID)
	}

	holdings, err := store.SnapshotHoldingsBySnapshotID(ctx, latest.ID)
	must.NoErr(t, err)
	if len(holdings) != 1 {
		t.Fatalf("holdings = %#v, want one row", holdings)
	}
	holding := holdings[0]
	if holding.Asset == nil || holding.Asset.ID != security.ID || holding.Asset.Identifier != "EDIT" {
		t.Fatalf("holding asset = %#v, want EDIT security", holding.Asset)
	}
	if holding.Asset.Name == nil || *holding.Asset.Name != securityName || holding.Asset.CurrentPrice == nil {
		t.Fatalf("holding asset details = %#v, want name and current price", holding.Asset)
	}
	if holding.Quantity == nil || *holding.Quantity != 2 || holding.Price == nil || *holding.Price != 50 || holding.ValueUSD != money.FromDollars(100) {
		t.Fatalf("holding = %#v, want original security holding", holding)
	}
	holdingsBySnapshotID, err := store.SnapshotHoldingsBySnapshotIDs(ctx, []int64{latest.ID, -1})
	must.NoErr(t, err)
	if len(holdingsBySnapshotID[latest.ID]) != 1 || holdingsBySnapshotID[latest.ID][0].Asset.ID != security.ID {
		t.Fatalf("SnapshotHoldingsBySnapshotIDs = %#v, want security holding", holdingsBySnapshotID)
	}
	assetsByID, err := store.AssetsByIDs(ctx, []int64{security.ID.Int64(), cash.ID.Int64(), -1})
	must.NoErr(t, err)
	if len(assetsByID) != 2 || assetsByID[security.ID.Int64()].Identifier != "EDIT" || assetsByID[cash.ID.Int64()].Identifier != "USD:snapshot-editor-db" {
		t.Fatalf("AssetsByIDs = %#v, want security and cash", assetsByID)
	}

	must.NoErr(t, store.UpsertBalanceReview(ctx, wealth.BalanceReviewUpsert{
		AccountID:              accountID,
		FirstFlaggedDate:       "2026-06-26",
		LatestFlaggedDate:      "2026-06-26",
		FlaggedSnapshotCount:   1,
		ProviderBalanceUSD:     130,
		CarryForwardBalanceUSD: 100,
		FlagReason:             "spike",
	}))
	newQuantity := 3.0
	newPrice := 40.0
	cashQuantity := 10.0
	edit := wealth.SnapshotEdit{
		ID:         latest.ID,
		AccountID:  accountID,
		Date:       "2026-06-26",
		BalanceUSD: 130,
		Holdings: []wealth.SnapshotEditHolding{
			{
				AssetID:           security.ID.Int64(),
				Quantity:          &newQuantity,
				Price:             &newPrice,
				ValueUSD:          120,
				CountsTowardValue: true,
			},
			{
				AssetID:           cash.ID.Int64(),
				Quantity:          &cashQuantity,
				ValueUSD:          10,
				CountsTowardValue: true,
			},
		},
	}
	if err := store.UpdateAccountSnapshots(ctx, []wealth.SnapshotEdit{edit}); err == nil {
		t.Fatal("UpdateAccountSnapshots() error = nil, want pending-review rejection")
	}
	unchanged := mustAccountBalanceSnapshotByID(t, store, latest.ID)
	if unchanged == nil || !unchanged.Flagged || unchanged.BalanceUSD != 100 {
		t.Fatalf("unchanged = %#v, want flagged balance 100", unchanged)
	}
	must.NoErr(t, store.ApproveBalanceReview(ctx, mustListInReviewBalanceReviews(t, store)[0].ID))
	insertSnapshotEditorProviderState(t, store, latest.ID)
	if got := providerStateCountForSnapshot(t, store, latest.ID); got != 1 {
		t.Fatalf("provider state count before edit = %d, want 1", got)
	}
	must.NoErr(t, store.UpdateAccountSnapshots(ctx, []wealth.SnapshotEdit{edit}))
	approved, err := store.GetApprovedBalanceReviewByAccount(ctx, accountID)
	must.NoErr(t, err)
	if approved != nil {
		t.Fatalf("approved review after edit = %#v, want nil", approved)
	}
	updated := mustAccountBalanceSnapshotByID(t, store, latest.ID)
	if updated == nil || updated.Flagged || updated.BalanceUSD != 130 {
		t.Fatalf("updated = %#v, want unflagged balance 130", updated)
	}
	reviews := mustListInReviewBalanceReviews(t, store)
	if len(reviews) != 0 {
		t.Fatalf("reviews = %#v, want none", reviews)
	}
	holdings, err = store.SnapshotHoldingsBySnapshotID(ctx, latest.ID)
	must.NoErr(t, err)
	hasSecurityHolding := hasSnapshotEditorHolding(holdings, security.ID, 3, 120)
	hasCashHolding := hasSnapshotEditorHolding(holdings, cash.ID, 10, 10)
	if len(holdings) != 2 || !hasSecurityHolding || !hasCashHolding {
		t.Fatalf("updated holdings = %#v, want security and cash rows", holdings)
	}
	if got := providerStateCountForSnapshot(t, store, latest.ID); got != 0 {
		t.Fatalf("provider state count after edit = %d, want 0", got)
	}

	rollbackQuantity := 4.0
	rollbackPrice := 35.0
	rollbackEdit := edit
	rollbackEdit.BalanceUSD = 140
	rollbackEdit.Holdings = []wealth.SnapshotEditHolding{{
		AssetID:           security.ID.Int64(),
		Quantity:          &rollbackQuantity,
		Price:             &rollbackPrice,
		ValueUSD:          140,
		CountsTowardValue: true,
	}}
	badEdit := wealth.SnapshotEdit{
		ID:         -1,
		AccountID:  accountID,
		Date:       "2026-06-27",
		BalanceUSD: 1,
		Holdings: []wealth.SnapshotEditHolding{{
			AssetID:           security.ID.Int64(),
			ValueUSD:          1,
			CountsTowardValue: true,
		}},
	}
	if err := store.UpdateAccountSnapshots(ctx, []wealth.SnapshotEdit{rollbackEdit, badEdit}); err == nil {
		t.Fatal("UpdateAccountSnapshots() error = nil, want rollback failure")
	}

	rolledBack := mustAccountBalanceSnapshotByID(t, store, latest.ID)
	if rolledBack == nil || rolledBack.BalanceUSD != 130 {
		t.Fatalf("rolledBack = %#v, want balance 130", rolledBack)
	}
	holdings, err = store.SnapshotHoldingsBySnapshotID(ctx, latest.ID)
	must.NoErr(t, err)
	if len(holdings) != 2 || !hasSnapshotEditorHolding(holdings, security.ID, 3, 120) || !hasSnapshotEditorHolding(holdings, cash.ID, 10, 10) {
		t.Fatalf("rolled back holdings = %#v, want prior edited rows", holdings)
	}
}

func insertSnapshotEditorProviderState(t *testing.T, store *testStore, snapshotID int64) {
	t.Helper()
	_, err := store.db.SQL().Exec(`
INSERT INTO account_balance_snapshot_provider_states (
  snapshot_id,
  provider_balance_usd_cents,
  provider_holdings_json
) VALUES (?, 130, '[]')`, snapshotID)
	must.NoErr(t, err)
}

func providerStateCountForSnapshot(t *testing.T, store *testStore, snapshotID int64) int64 {
	t.Helper()
	var count int64
	must.NoErr(t, store.db.SQL().QueryRow(
		`SELECT COUNT(*) FROM account_balance_snapshot_provider_states WHERE snapshot_id = ?`,
		snapshotID,
	).Scan(&count))
	return count
}

func hasSnapshotEditorHolding(holdings []wealth.SnapshotHolding, assetID model.GlobalID, quantity float64, valueUSD money.Cents) bool {
	matches := func(holding wealth.SnapshotHolding) bool {
		return holding.Asset.ID == assetID && holding.Quantity != nil && *holding.Quantity == quantity && holding.ValueUSD == valueUSD
	}
	return slices.ContainsFunc(holdings, matches)
}
