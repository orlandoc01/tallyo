package wealthdb

import (
	"context"
	"testing"
	"time"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/wealth"
)

// TestUpsertAssetNormalizesSelfTracking proves the common upsert sink itself
// enforces the tracking invariant, so a stale provider-state AssetUpsert
// (e.g. restored from an older build's pending balance review JSON, or a
// direct internal caller) cannot reintroduce a self-referencing or blank
// tracking ticker.
func TestUpsertAssetNormalizesSelfTracking(t *testing.T) {
	store := testDB(t)

	selfTicker := "AAPL"
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:          model.AssetTypeSecurity,
		Identifier:         "AAPL",
		Classifier:         model.AssetClassifierPublic,
		TrackingTicker:     &selfTicker,
		TrackingMultiplier: 3,
	})
	if asset.TrackingTicker != nil || asset.TrackingMultiplier != 1 {
		t.Fatalf("tracking = (%v, %v), want normalized (nil, 1)", asset.TrackingTicker, asset.TrackingMultiplier)
	}

	blankTicker := "   "
	blank := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:          model.AssetTypeSecurity,
		Identifier:         "MSFT",
		Classifier:         model.AssetClassifierPublic,
		TrackingTicker:     &blankTicker,
		TrackingMultiplier: 2,
	})
	if blank.TrackingTicker != nil || blank.TrackingMultiplier != 1 {
		t.Fatalf("tracking = (%v, %v), want normalized (nil, 1)", blank.TrackingTicker, blank.TrackingMultiplier)
	}

	genuineTicker := "VFFVX"
	genuine := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:          model.AssetTypeSecurity,
		Identifier:         "TrustII_VFFVX",
		Classifier:         model.AssetClassifierPublic,
		TrackingTicker:     &genuineTicker,
		TrackingMultiplier: 1.5155,
	})
	if genuine.TrackingTicker == nil || *genuine.TrackingTicker != "VFFVX" || genuine.TrackingMultiplier != 1.5155 {
		t.Fatalf("genuine tracking = (%v, %v), want (VFFVX, 1.5155)", genuine.TrackingTicker, genuine.TrackingMultiplier)
	}
}

func mustUpsertAnalysisReport(tb testing.TB, store *testStore, assetID int64) {
	tb.Helper()
	must.NoErr(tb, store.q.UpsertAssetAnalysisReport(context.Background(), dbgen.UpsertAssetAnalysisReportParams{
		AssetID:       assetID,
		Category:      "Large Blend",
		GroupName:     "Large Blend",
		StockPosition: 1,
		FetchedAt:     time.Now().UTC(),
	}))
}

func hasAnalysisReport(tb testing.TB, store *testStore, assetID int64) bool {
	tb.Helper()
	rows, err := store.q.AssetAnalysisReportsByAssetIDs(context.Background(), dbgen.AssetAnalysisReportsByAssetIDsParams{AssetIds: []int64{assetID}})
	must.NoErr(tb, err)
	return len(rows) > 0
}

// TestUpdateAssetInvalidatesReportOnEffectiveTickerChange covers the three
// failure modes the ticket calls out: enabling/changing a custom ticker
// invalidates a stale report and clears NOT_FOUND, and an identifier-only
// edit that leaves an active custom tracker untouched invalidates nothing.
func TestUpdateAssetInvalidatesReportOnEffectiveTickerChange(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)

	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "ORPHAN-401K",
		Classifier: model.AssetClassifierPublic,
	})
	assetID := asset.ID.Int64()
	mustUpsertAnalysisReport(t, store, assetID)
	must.NoErr(t, store.UpdateAssetInvestmentConnectivity(ctx, assetID, model.ConnectivityStatusNotFound))

	// Enabling a custom ticker changes the effective ticker: the stale report
	// must be invalidated and NOT_FOUND connectivity cleared.
	ticker := "VOO"
	multiplier := 1.0
	_, err := store.UpdateAsset(ctx, model.UpdateAssetInput{ID: asset.ID, TrackingTicker: &ticker, TrackingMultiplier: &multiplier})
	must.NoErr(t, err)
	if hasAnalysisReport(t, store, assetID) {
		t.Fatalf("analysis report survived enabling a custom ticker")
	}
	updated := mustAssetByID(t, store, assetID)
	if updated.InvestmentConnectivity != model.ConnectivityStatusHealthy {
		t.Fatalf("investment connectivity = %v, want HEALTHY", updated.InvestmentConnectivity)
	}

	// Re-seed and change the custom ticker to a different proxy: still a
	// change in effective ticker.
	mustUpsertAnalysisReport(t, store, assetID)
	otherTicker := "SPY"
	_, err = store.UpdateAsset(ctx, model.UpdateAssetInput{ID: asset.ID, TrackingTicker: &otherTicker, TrackingMultiplier: &multiplier})
	must.NoErr(t, err)
	if hasAnalysisReport(t, store, assetID) {
		t.Fatalf("analysis report survived changing the custom ticker")
	}

	// An identifier-only edit that leaves the active custom tracker unchanged
	// must not invalidate the report.
	mustUpsertAnalysisReport(t, store, assetID)
	newIdentifier := "ORPHAN-401K-RENAMED"
	_, err = store.UpdateAsset(ctx, model.UpdateAssetInput{ID: asset.ID, Identifier: &newIdentifier})
	must.NoErr(t, err)
	if !hasAnalysisReport(t, store, assetID) {
		t.Fatalf("analysis report invalidated by an identifier edit that didn't change the effective ticker")
	}
}
