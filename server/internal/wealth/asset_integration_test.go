package wealth_test

import (
	"context"
	"testing"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
	. "tallyo/internal/wealth"

	"github.com/samber/lo"
)

type assetStubProvider struct{ price float64 }

func (p assetStubProvider) PriceAt(context.Context, *model.Asset, time.Time) (float64, error) {
	return p.price, nil
}

type recordingAssetProvider struct {
	price float64
	seen  []*model.Asset
}

func (p *recordingAssetProvider) PriceAt(_ context.Context, asset *model.Asset, _ time.Time) (float64, error) {
	p.seen = append(p.seen, asset)
	return p.price, nil
}

// TestUpdateAssetIdentifierRepricing verifies the re-pricing path after an
// identifier change: a positive price is persisted, while a non-positive
// fallback price is skipped so holdings are never revalued to $0.
func TestUpdateAssetIdentifierRepricing(t *testing.T) {
	ctx := context.Background()
	store := openWealthTestStore(t)

	created := mustUpsertAsset(t, store, AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "OLD",
		Name:       new("Old Corp"),
		Classifier: model.AssetClassifierPublic,
	})

	// A provider that can't price the new ticker yields 0; the price write
	// and holding revaluation must be skipped.
	zeroSvc := &Service{Store: store, Log: test.Logger, PriceProvider: assetStubProvider{price: 0}}
	res, err := zeroSvc.UpdateAsset(ctx, model.UpdateAssetInput{ID: created.ID, Identifier: new("NEW")})
	must.NoErr(t, err)
	if res.Identifier != "NEW" {
		t.Errorf("identifier = %q, want NEW", res.Identifier)
	}
	if res.CurrentPrice != nil {
		t.Errorf("CurrentPrice = %v, want nil (non-positive price must not persist)", *res.CurrentPrice)
	}

	// A positive price is persisted on the asset.
	priceSvc := &Service{Store: store, Log: test.Logger, PriceProvider: assetStubProvider{price: 150}}
	res, err = priceSvc.UpdateAsset(ctx, model.UpdateAssetInput{ID: created.ID, Identifier: new("NEW2")})
	must.NoErr(t, err)
	if res.CurrentPrice == nil || *res.CurrentPrice != 150 {
		t.Errorf("CurrentPrice = %v, want 150", res.CurrentPrice)
	}
}

func TestUpdateAssetForcedPriceRevaluesLatestHoldings(t *testing.T) {
	ctx := context.Background()
	store := openWealthTestStore(t)
	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "forced-price-owner"})
	account := &model.Account{Owner: owner, Name: "Brokerage", Type: model.AccountTypeInvestment}
	test.MustUpsertAccount(t, store, "invest-forced-price", account)
	lastPrice := 10.0
	asset := mustUpsertAsset(t, store, AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "AAPL",
		Classifier: model.AssetClassifierPublic,
		LastPrice:  &lastPrice,
	})
	excludedAsset := mustUpsertAsset(t, store, AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "EXCLUDED",
		Classifier: model.AssetClassifierPublic,
		LastPrice:  &lastPrice,
	})
	accountID := account.ID.Int64()
	quantity := 2.0
	nonCountingQuantity := 10.0
	price10 := 10.0
	for _, date := range []string{"2026-06-01", "2026-06-02"} {
		must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, AccountBalanceSnapshot{
			AccountID:  accountID,
			Source:     "plaid",
			Date:       date,
			SyncedAt:   date + "T12:00:00Z",
			BalanceUSD: money.FromDollars(20),
			Holdings: []AssetDailyHolding{
				{
					AssetID:           asset.ID.Int64(),
					Quantity:          &quantity,
					Price:             &price10,
					ValueUSD:          20,
					CountsTowardValue: true,
				},
				{
					AssetID:           excludedAsset.ID.Int64(),
					Quantity:          &nonCountingQuantity,
					Price:             &price10,
					ValueUSD:          100,
					CountsTowardValue: false,
				},
			},
		}))
	}

	svc := &Service{Store: store, Log: test.Logger, PriceProvider: assetStubProvider{price: 10}}
	forced := 25.0
	forcePrice := true
	if _, err := svc.UpdateAsset(ctx, model.UpdateAssetInput{ID: asset.ID, ForcePrice: &forcePrice, ForcedUsdPrice: &forced}); err != nil {
		t.Fatalf("UpdateAsset() error = %v", err)
	}
	snapshots := snapshotRowsByDate(t, ctx, store, accountID)
	current := snapshots["2026-06-02"]
	older := snapshots["2026-06-01"]
	if current == nil || older == nil {
		t.Fatalf("snapshots by date = %#v", snapshots)
	}
	if current.BalanceUSD != money.FromDollars(50) || older.BalanceUSD != money.FromDollars(20) {
		t.Fatalf("snapshot balances current=%d older=%d, want 50 and 20", current.BalanceUSD, older.BalanceUSD)
	}
	currentHoldings := snapshotHoldingsByID(t, ctx, store, current.ID)
	if got := nonCountingHoldingValue(currentHoldings); got != money.FromDollars(100) {
		t.Fatalf("current non-counting holding = %d, want unchanged 100", got)
	}
	olderHoldings := snapshotHoldingsByID(t, ctx, store, older.ID)
	if got := nonCountingHoldingValue(olderHoldings); got != money.FromDollars(100) {
		t.Fatalf("older non-counting holding = %d, want unchanged 100", got)
	}
	holdings := mustCurrentHoldings(t, ctx, store)
	if len(holdings) != 1 || holdings[0].ValueUSD != money.FromDollars(50) {
		t.Fatalf("holdings after forced price = %#v, want one holding valued at 50", holdings)
	}
	if _, err := svc.UpdateAsset(ctx, model.UpdateAssetInput{ID: excludedAsset.ID, ForcePrice: &forcePrice, ForcedUsdPrice: &forced}); err != nil {
		t.Fatalf("UpdateAsset(excluded) error = %v", err)
	}
	snapshots = snapshotRowsByDate(t, ctx, store, accountID)
	current = snapshots["2026-06-02"]
	if current.BalanceUSD != money.FromDollars(50) {
		t.Fatalf("snapshot balance after excluded reprice = %d, want still 50", current.BalanceUSD)
	}
	currentHoldings = snapshotHoldingsByID(t, ctx, store, current.ID)
	if got := nonCountingHoldingValue(currentHoldings); got != money.FromDollars(250) {
		t.Fatalf("current non-counting holding = %d, want 250", got)
	}
	olderHoldings = snapshotHoldingsByID(t, ctx, store, older.ID)
	if got := nonCountingHoldingValue(olderHoldings); got != money.FromDollars(100) {
		t.Fatalf("older non-counting holding after excluded reprice = %d, want unchanged 100", got)
	}
	forcePrice = false
	if _, err := svc.UpdateAsset(ctx, model.UpdateAssetInput{ID: asset.ID, ForcePrice: &forcePrice}); err != nil {
		t.Fatalf("UpdateAsset(clear forced price) error = %v", err)
	}
	holdings = mustCurrentHoldings(t, ctx, store)
	if len(holdings) != 1 || holdings[0].ValueUSD != money.FromDollars(20) {
		t.Fatalf("holdings after clearing forced price = %#v, want one holding valued at 20", holdings)
	}
}

func snapshotRowsByDate(
	tb testing.TB,
	ctx context.Context,
	store *wealthTestStore,
	accountID int64,
) map[string]*SnapshotRow {
	tb.Helper()
	rows, err := store.AccountBalanceSnapshotsPage(ctx, accountID, nil, 10)
	must.NoErr(tb, err)
	toRowByDate := func(row *SnapshotRow) (string, *SnapshotRow) { return row.Date, row }
	return lo.Associate(rows, toRowByDate)
}

func snapshotHoldingsByID(
	tb testing.TB,
	ctx context.Context,
	store *wealthTestStore,
	snapshotID int64,
) []SnapshotHolding {
	tb.Helper()
	holdings, err := store.SnapshotHoldingsBySnapshotID(ctx, snapshotID)
	must.NoErr(tb, err)
	return holdings
}

func nonCountingHoldingValue(holdings []SnapshotHolding) money.Cents {
	for _, holding := range holdings {
		if !holding.CountsTowardValue {
			return holding.ValueUSD
		}
	}
	return 0
}

func TestUpdateAssetIdentifierWithForcedPriceSkipsLiveRevaluation(t *testing.T) {
	ctx, store, asset := assetRevaluationFixture(t, "OLD")

	forced := 25.0
	forcePrice := true
	updated, err := (&Service{Store: store, Log: test.Logger, PriceProvider: assetStubProvider{price: 150}}).UpdateAsset(ctx, model.UpdateAssetInput{
		ID:             asset.ID,
		Identifier:     new("NEW"),
		ForcePrice:     &forcePrice,
		ForcedUsdPrice: &forced,
	})
	must.NoErr(t, err)
	if updated.Identifier != "NEW" {
		t.Fatalf("identifier = %q, want NEW", updated.Identifier)
	}
	holdings := mustCurrentHoldings(t, ctx, store)
	if len(holdings) != 1 || holdings[0].ValueUSD != money.FromDollars(50) {
		t.Fatalf("holdings after identifier with forced price = %#v, want one holding valued at 50", holdings)
	}
}

func TestUpdateAssetTrackingTickerValidatesAndRevalues(t *testing.T) {
	ctx, store, asset := assetRevaluationFixture(t, "PLAID:ABC")

	multiplier := 0.5
	provider := &recordingAssetProvider{price: 50}
	updated, err := (&Service{Store: store, Log: test.Logger, PriceProvider: provider}).UpdateAsset(ctx, model.UpdateAssetInput{ID: asset.ID, TrackingTicker: new("SPY"), TrackingMultiplier: &multiplier})
	must.NoErr(t, err)
	if updated.TrackingTicker == nil || *updated.TrackingTicker != "SPY" || updated.TrackingMultiplier != multiplier {
		t.Fatalf("tracking fields = (%v, %v), want (SPY, 0.5)", updated.TrackingTicker, updated.TrackingMultiplier)
	}
	if len(provider.seen) == 0 || provider.seen[0].TrackingTicker == nil || *provider.seen[0].TrackingTicker != "SPY" {
		t.Fatalf("provider saw assets = %#v, want first call with tracking ticker SPY", provider.seen)
	}
	holdings := mustCurrentHoldings(t, ctx, store)
	if len(holdings) != 1 || holdings[0].ValueUSD != money.FromDollars(100) {
		t.Fatalf("holdings after tracking update = %#v, want one holding valued at 100", holdings)
	}
}

func assetRevaluationFixture(t *testing.T, identifier string) (context.Context, *wealthTestStore, *model.Asset) {
	t.Helper()
	ctx := context.Background()
	store := openWealthTestStore(t)
	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "asset-revaluation-owner"})
	account := &model.Account{Owner: owner, Name: "Brokerage", Type: model.AccountTypeInvestment}
	test.MustUpsertAccount(t, store, "asset-revaluation-account", account)
	asset := mustUpsertAsset(t, store, AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: identifier, Classifier: model.AssetClassifierPublic})
	now := time.Now().UTC()
	must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, AccountBalanceSnapshot{
		AccountID: account.ID.Int64(), Source: "plaid", Date: now.Format("2006-01-02"), SyncedAt: now.Format(time.RFC3339), BalanceUSD: 20,
		Holdings: []AssetDailyHolding{{AssetID: asset.ID.Int64(), Quantity: new(float64(2)), Price: new(float64(10)), ValueUSD: 20, CountsTowardValue: true}},
	}))
	return ctx, store, asset
}

// TestUpdateAssetUnchangedTrackingPreservesPrice verifies that re-submitting the
// same tracking values (a cosmetic edit that differs only textually) does not
// clear the stored market price or trigger a re-fetch.
func TestUpdateAssetUnchangedTrackingPreservesPrice(t *testing.T) {
	ctx := context.Background()
	store := openWealthTestStore(t)
	asset := mustUpsertAsset(t, store, AssetUpsert{
		AssetType:          model.AssetTypeSecurity,
		Identifier:         "TrustII_VFFVX",
		Classifier:         model.AssetClassifierPublic,
		TrackingTicker:     new("VFFVX"),
		TrackingMultiplier: 1,
		LastPrice:          new(float64(100)),
	})

	multiplier := 1.0 // identical to the stored multiplier
	provider := &recordingAssetProvider{price: 50}
	updated, err := (&Service{Store: store, Log: test.Logger, PriceProvider: provider}).UpdateAsset(ctx, model.UpdateAssetInput{ID: asset.ID, TrackingTicker: new(" VFFVX "), TrackingMultiplier: &multiplier})
	must.NoErr(t, err)
	if updated.CurrentPrice == nil || *updated.CurrentPrice != 100 {
		t.Fatalf("current price = %v, want 100 preserved (not cleared)", updated.CurrentPrice)
	}
	if len(provider.seen) != 0 {
		t.Fatalf("price provider called %d times, want 0 for a no-op tracking edit", len(provider.seen))
	}
}
