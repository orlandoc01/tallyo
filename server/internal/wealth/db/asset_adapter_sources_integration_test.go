package wealthdb

import (
	"context"
	"strings"
	"testing"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

func TestMergeAssetBySourceMovesHistoryReportAndSources(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	target := mustUpsertMergeAsset(t, store, "MERGE-TARGET", nil)
	duplicate := mustUpsertMergeAsset(t, store, "MERGE-DUP", &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: "sec-dup"})
	mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeSecurity,
		Identifier:    duplicate.Identifier,
		Classifier:    model.AssetClassifierPublic,
		AdapterSource: &wealth.AdapterSource{Adapter: syncerids.SimpleFin, SourceID: "holding-dup"},
	})
	_, accountID := mustInvestmentAccount(t, store, "merge-account-"+t.Name(), "merge-owner", "Merge Brokerage")
	writeMergeSnapshot(t, store, accountID, "2026-06-01", duplicate.ID.Int64(), 300)
	insertMergeAnalysisReport(t, store, duplicate.ID.Int64())

	got, err := store.MergeAssetBySource(ctx, syncerids.Plaid, "sec-dup", target.ID.Int64())
	must.NoErr(t, err)
	if got.ID != target.ID {
		t.Fatalf("merged asset = %s, want target %s", got.ID, target.ID)
	}
	if removed, err := store.AssetByID(ctx, duplicate.ID.Int64()); err != nil || removed != nil {
		t.Fatalf("duplicate after merge = %#v, %v; want nil", removed, err)
	}
	if count := assetHoldingCount(t, store, target.ID.Int64()); count != 1 {
		t.Fatalf("target holding count = %d, want 1", count)
	}
	if count := assetHoldingCount(t, store, duplicate.ID.Int64()); count != 0 {
		t.Fatalf("duplicate holding count = %d, want 0", count)
	}
	if balance := mergeSnapshotBalance(t, store, accountID, "2026-06-01"); balance != 300 {
		t.Fatalf("snapshot balance = %v, want 300", balance)
	}
	if !analysisReportExists(t, store, target.ID.Int64()) {
		t.Fatal("target analysis report missing after merge")
	}
	if sources := assetSources(t, store, target.ID.Int64()); len(sources) != 2 {
		t.Fatalf("target sources = %#v, want both duplicate sources", sources)
	}
}

func TestMergeAssetBySourceRejectsSnapshotCollision(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	target := mustUpsertMergeAsset(t, store, "COLLISION-TARGET", nil)
	duplicate := mustUpsertMergeAsset(t, store, "COLLISION-DUP", &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: "sec-collision"})
	_, accountID := mustInvestmentAccount(t, store, "merge-account-"+t.Name(), "merge-owner", "Merge Brokerage")
	writeMergeSnapshotWithHoldings(t, store, accountID, "2026-06-01", []wealth.AssetDailyHolding{
		mergeHolding(target.ID.Int64(), 100),
		mergeHolding(duplicate.ID.Int64(), 200),
	}, 300)

	_, err := store.MergeAssetBySource(ctx, syncerids.Plaid, "sec-collision", target.ID.Int64())
	if err == nil || !strings.Contains(err.Error(), "holds both") {
		t.Fatalf("MergeAssetBySource error = %v, want collision", err)
	}
	if count := assetHoldingCount(t, store, duplicate.ID.Int64()); count != 1 {
		t.Fatalf("duplicate holding count = %d, want unchanged", count)
	}
	if sources := assetSources(t, store, duplicate.ID.Int64()); len(sources) != 1 {
		t.Fatalf("duplicate sources = %#v, want unchanged", sources)
	}
}

func TestMergeAssetBySourceIdempotentWhenSourceAlreadyOnTarget(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	target := mustUpsertMergeAsset(t, store, "IDEMPOTENT-TARGET", &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: "sec-target"})

	got, err := store.MergeAssetBySource(ctx, syncerids.Plaid, "sec-target", target.ID.Int64())
	must.NoErr(t, err)
	if got.ID != target.ID {
		t.Fatalf("merged asset = %s, want target %s", got.ID, target.ID)
	}
}

func TestMergeAssetBySourceUnknownSourceAndMissingTarget(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	if _, err := store.MergeAssetBySource(ctx, syncerids.Plaid, "missing", 12345); err == nil || !strings.Contains(err.Error(), "no such adapter source") {
		t.Fatalf("unknown source error = %v, want no such adapter source", err)
	}

	duplicate := mustUpsertMergeAsset(t, store, "MISSING-TARGET-DUP", &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: "sec-missing-target"})
	if _, err := store.MergeAssetBySource(ctx, syncerids.Plaid, "sec-missing-target", duplicate.ID.Int64()+999); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("missing target error = %v, want not found", err)
	}
}

func TestMergeAssetBySourceRejectsCrossTypeTarget(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	duplicate := mustUpsertMergeAsset(t, store, "CROSS-TYPE-DUP", &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: "sec-cross-type"})
	target := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeCrypto,
		Identifier:    "CROSS-TYPE-ETH",
		Classifier:    model.AssetClassifierCryptocurrency,
		AdapterSource: nil,
	})

	_, err := store.MergeAssetBySource(ctx, syncerids.Plaid, "sec-cross-type", target.ID.Int64())
	if err == nil || !strings.Contains(err.Error(), "cannot merge SECURITY asset") {
		t.Fatalf("MergeAssetBySource error = %v, want cross-type rejection", err)
	}
	if got, err := store.AssetByID(ctx, duplicate.ID.Int64()); err != nil || got == nil {
		t.Fatalf("duplicate asset after cross-type rejection = %#v, %v; want unchanged", got, err)
	}
}

func TestMergeAssetBySourcePostMergeSyncResolvesSurvivor(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	target := mustUpsertMergeAsset(t, store, "POST-MERGE-TARGET", nil)
	duplicate := mustUpsertMergeAsset(t, store, "POST-MERGE-DUP", &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: "sec-post-merge"})
	_, accountID := mustInvestmentAccount(t, store, "merge-account-"+t.Name(), "merge-owner", "Merge Brokerage")
	writeMergeSnapshot(t, store, accountID, "2026-06-01", duplicate.ID.Int64(), 250)
	if _, err := store.MergeAssetBySource(ctx, syncerids.Plaid, "sec-post-merge", target.ID.Int64()); err != nil {
		t.Fatalf("MergeAssetBySource: %v", err)
	}

	price := 42.0
	priceAt := time.Date(2026, 6, 2, 12, 0, 0, 0, time.UTC)
	got := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeSecurity,
		Identifier:    "POST-MERGE-DUP",
		Classifier:    model.AssetClassifierCompanyEquity,
		LastPrice:     &price,
		LastPriceAt:   &priceAt,
		AdapterSource: &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: "sec-post-merge"},
	})
	if got.ID != target.ID || got.CurrentPrice == nil || *got.CurrentPrice != price {
		t.Fatalf("post-merge sync asset = %#v, want target with updated price", got)
	}
	if removed, err := store.AssetByID(ctx, duplicate.ID.Int64()); err != nil || removed != nil {
		t.Fatalf("duplicate after post-merge sync = %#v, %v; want nil", removed, err)
	}
}

func mustUpsertMergeAsset(tb testing.TB, store *testStore, identifier string, source *wealth.AdapterSource) *model.Asset {
	tb.Helper()
	return mustUpsertAsset(tb, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeSecurity,
		Identifier:    identifier,
		Classifier:    model.AssetClassifierPublic,
		AdapterSource: source,
	})
}

func writeMergeSnapshot(tb testing.TB, store *testStore, accountID int64, date string, assetID int64, valueUSD float64) {
	tb.Helper()
	writeMergeSnapshotWithHoldings(tb, store, accountID, date, []wealth.AssetDailyHolding{mergeHolding(assetID, valueUSD)}, valueUSD)
}

func writeMergeSnapshotWithHoldings(
	tb testing.TB,
	store *testStore,
	accountID int64,
	date string,
	holdings []wealth.AssetDailyHolding,
	balanceUSD float64,
) {
	tb.Helper()
	writeMergeSnapshotWithSource(tb, store, accountID, date, syncerids.Plaid.Str(), holdings, balanceUSD)
}

func writeMergeSnapshotWithSource(
	tb testing.TB,
	store *testStore,
	accountID int64,
	date string,
	source string,
	holdings []wealth.AssetDailyHolding,
	balanceUSD float64,
) {
	tb.Helper()
	must.NoErr(tb, store.ReplaceAccountBalanceSnapshot(context.Background(), wealth.AccountBalanceSnapshot{
		AccountID:  accountID,
		Source:     source,
		Date:       date,
		SyncedAt:   date + "T12:00:00Z",
		BalanceUSD: money.FromDollars(balanceUSD),
		Holdings:   holdings,
	}))
}

func mergeHolding(assetID int64, valueUSD float64) wealth.AssetDailyHolding {
	quantity := 1.0
	price := valueUSD
	return wealth.AssetDailyHolding{
		AssetID:           assetID,
		Quantity:          &quantity,
		Price:             &price,
		ValueUSD:          valueUSD,
		CountsTowardValue: true,
	}
}

func insertMergeAnalysisReport(tb testing.TB, store *testStore, assetID int64) {
	tb.Helper()
	_, err := store.db.SQL().ExecContext(
		context.Background(),
		`INSERT INTO asset_analysis_reports (asset_id, category, group_name) VALUES (?, 'Large Blend', 'US Equity')`,
		assetID,
	)
	must.NoErr(tb, err)
}

func assetHoldingCount(tb testing.TB, store *testStore, assetID int64) int {
	tb.Helper()
	var count int
	must.NoErr(tb, store.db.SQL().QueryRowContext(context.Background(), `SELECT COUNT(*) FROM asset_daily_holdings WHERE asset_id = ?`, assetID).Scan(&count))
	return count
}

func mergeSnapshotBalance(tb testing.TB, store *testStore, accountID int64, date string) float64 {
	tb.Helper()
	var balanceCents int64
	must.NoErr(tb, store.db.SQL().QueryRowContext(context.Background(), `SELECT balance_usd_cents FROM account_balance_daily_snapshots WHERE account_id = ? AND date = ?`, accountID, date).Scan(&balanceCents))
	return float64(balanceCents) / 100
}

func analysisReportExists(tb testing.TB, store *testStore, assetID int64) bool {
	tb.Helper()
	var exists bool
	must.NoErr(tb, store.db.SQL().QueryRowContext(context.Background(), `SELECT EXISTS(SELECT 1 FROM asset_analysis_reports WHERE asset_id = ?)`, assetID).Scan(&exists))
	return exists
}
