package wealthdb

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

func TestUpdateAssetPrice(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)

	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "PRICE-TEST",
		Classifier: model.AssetClassifierPublic,
	})

	priceAt := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	must.NoErr(t, store.UpdateAssetPrice(ctx, asset.ID.Int64(), 123.45, priceAt))

	updated := mustAssetByID(t, store, asset.ID.Int64())
	if updated.CurrentPrice == nil || *updated.CurrentPrice != 123.45 {
		t.Fatalf("CurrentPrice = %v, want 123.45", updated.CurrentPrice)
	}

	must.NoErr(t, store.UpdateAssetPrice(ctx, asset.ID.Int64(), 99, priceAt.Add(-time.Hour)))
	updated = mustAssetByID(t, store, asset.ID.Int64())
	if updated.CurrentPrice == nil || *updated.CurrentPrice != 123.45 {
		t.Fatalf("CurrentPrice after stale update = %v, want 123.45", updated.CurrentPrice)
	}
}

func TestUpsertAssetRecordsAdapterSource(t *testing.T) {
	store := testDB(t)
	source := &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: "sec-aapl"}

	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeSecurity,
		Identifier:    "AAPL",
		Classifier:    model.AssetClassifierPublic,
		AdapterSource: source,
	})

	sources := assetSources(t, store, asset.ID.Int64())
	if len(sources) != 1 || sources[0].SourceAdapter != model.AssetSourceAdapterPlaid || sources[0].SourceID != "sec-aapl" {
		t.Fatalf("adapter sources = %#v, want plaid sec-aapl", sources)
	}
}

func TestUpsertAssetAdapterSourceHitUpdatesOnlyPrice(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	name := "Apple Inc"
	cusip := "037833100"
	initialPrice := 100.0
	initialPriceAt := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	source := &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: "sec-apple"}
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeSecurity,
		Identifier:    "AAPL",
		Name:          &name,
		Classifier:    model.AssetClassifierPublic,
		CUSIP:         &cusip,
		LastPrice:     &initialPrice,
		LastPriceAt:   &initialPriceAt,
		AdapterSource: source,
	})
	editedIdentifier := "APPLE-RENAMED"
	if _, err := store.UpdateAsset(ctx, model.UpdateAssetInput{ID: asset.ID, Identifier: &editedIdentifier}); err != nil {
		t.Fatalf("UpdateAsset: %v", err)
	}

	providerName := "Provider Rename"
	providerCUSIP := "999999999"
	newPrice := 125.0
	newPriceAt := time.Date(2026, 6, 2, 12, 0, 0, 0, time.UTC)
	got := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeSecurity,
		Identifier:    "AAPL",
		Name:          &providerName,
		Classifier:    model.AssetClassifierCompanyEquity,
		CUSIP:         &providerCUSIP,
		LastPrice:     &newPrice,
		LastPriceAt:   &newPriceAt,
		AdapterSource: source,
	})
	if got.ID != asset.ID || got.Identifier != editedIdentifier {
		t.Fatalf("source hit returned %#v, want id %s identifier %s", got, asset.ID, editedIdentifier)
	}
	if got.Name == nil || *got.Name != name || got.Classifier != model.AssetClassifierPublic || got.Cusip == nil || *got.Cusip != cusip {
		t.Fatalf("metadata changed on source hit: %#v", got)
	}
	if got.CurrentPrice == nil || *got.CurrentPrice != newPrice || got.CurrentPriceAt == nil || !got.CurrentPriceAt.Equal(newPriceAt) {
		t.Fatalf("price = %v at %v, want %v at %v", got.CurrentPrice, got.CurrentPriceAt, newPrice, newPriceAt)
	}
}

func TestUpsertAssetStoresManyAdapterSourcesForSameAsset(t *testing.T) {
	store := testDB(t)
	plaidSource := &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: "sec-aapl"}
	simpleFinSource := &wealth.AdapterSource{Adapter: syncerids.SimpleFin, SourceID: "holding-aapl"}

	plaidAsset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeSecurity,
		Identifier:    "AAPL",
		Classifier:    model.AssetClassifierPublic,
		AdapterSource: plaidSource,
	})
	simpleFinAsset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeSecurity,
		Identifier:    "AAPL",
		Classifier:    model.AssetClassifierPublic,
		AdapterSource: simpleFinSource,
	})
	if simpleFinAsset.ID != plaidAsset.ID {
		t.Fatalf("SimpleFIN asset ID = %s, want %s", simpleFinAsset.ID, plaidAsset.ID)
	}
	if sources := assetSources(t, store, plaidAsset.ID.Int64()); len(sources) != 2 {
		t.Fatalf("adapter sources = %#v, want two", sources)
	}
}

func TestUpsertAssetAdapterSourceHitWithNoPriceLeavesPriceUntouched(t *testing.T) {
	store := testDB(t)
	price := 10.0
	priceAt := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	source := &wealth.AdapterSource{Adapter: syncerids.Debank, SourceID: "eth:token"}
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeCrypto,
		Identifier:    "eth:token",
		Classifier:    model.AssetClassifierCryptocurrency,
		LastPrice:     &price,
		LastPriceAt:   &priceAt,
		AdapterSource: source,
	})

	mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeCrypto,
		Identifier:    "eth:token-renamed-provider-side",
		Classifier:    model.AssetClassifierStablecoin,
		LineType:      new("WALLET_TOKEN"),
		ChainID:       new("eth"),
		TokenID:       new("token"),
		TokenSymbol:   new("TKN"),
		TokenName:     new("Token"),
		ProjectName:   new("Project"),
		AdapterSource: source,
	})
	got := mustAssetByID(t, store, asset.ID.Int64())
	if got.ChainID == nil || *got.ChainID != "eth" || got.TokenSymbol == nil || *got.TokenSymbol != "TKN" || got.TokenName == nil || *got.TokenName != "Token" || got.ProjectName == nil || *got.ProjectName != "Project" {
		t.Fatalf("crypto metadata = %#v", got)
	}
	if got.CurrentPrice == nil || *got.CurrentPrice != price || got.CurrentPriceAt == nil || !got.CurrentPriceAt.Equal(priceAt) {
		t.Fatalf("price = %v at %v, want %v at %v", got.CurrentPrice, got.CurrentPriceAt, price, priceAt)
	}
}

func TestUpsertAssetIgnoresOlderPriceByKey(t *testing.T) {
	store := testDB(t)
	newPrice := 20.0
	newPriceAt := time.Date(2026, 6, 2, 12, 0, 0, 0, time.UTC)
	mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:   model.AssetTypeSecurity,
		Identifier:  "MONOTONIC-KEY",
		Classifier:  model.AssetClassifierPublic,
		LastPrice:   &newPrice,
		LastPriceAt: &newPriceAt,
	})
	oldPrice := 10.0
	oldPriceAt := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	got := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:   model.AssetTypeSecurity,
		Identifier:  "MONOTONIC-KEY",
		Classifier:  model.AssetClassifierPublic,
		LastPrice:   &oldPrice,
		LastPriceAt: &oldPriceAt,
	})
	if got.CurrentPrice == nil || *got.CurrentPrice != newPrice || got.CurrentPriceAt == nil || !got.CurrentPriceAt.Equal(newPriceAt) {
		t.Fatalf("price = %v at %v, want %v at %v", got.CurrentPrice, got.CurrentPriceAt, newPrice, newPriceAt)
	}
}

func TestUpsertAssetAdapterSourceHitIgnoresOlderPrice(t *testing.T) {
	store := testDB(t)
	newPrice := 20.0
	newPriceAt := time.Date(2026, 6, 2, 12, 0, 0, 0, time.UTC)
	source := &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: "monotonic-source"}
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeSecurity,
		Identifier:    "MONOTONIC-SOURCE",
		Classifier:    model.AssetClassifierPublic,
		LastPrice:     &newPrice,
		LastPriceAt:   &newPriceAt,
		AdapterSource: source,
	})
	oldPrice := 10.0
	oldPriceAt := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	got := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeSecurity,
		Identifier:    "MONOTONIC-SOURCE-RENAMED",
		Classifier:    model.AssetClassifierPublic,
		LastPrice:     &oldPrice,
		LastPriceAt:   &oldPriceAt,
		AdapterSource: source,
	})
	if got.ID != asset.ID || got.CurrentPrice == nil || *got.CurrentPrice != newPrice || got.CurrentPriceAt == nil || !got.CurrentPriceAt.Equal(newPriceAt) {
		t.Fatalf("asset = %#v, want id %s price %v at %v", got, asset.ID, newPrice, newPriceAt)
	}
}

func TestUpsertAssetEmptyAdapterSourceDoesNotInsertSource(t *testing.T) {
	store := testDB(t)
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeSecurity,
		Identifier:    "NO-SOURCE-ID",
		Classifier:    model.AssetClassifierPublic,
		AdapterSource: &wealth.AdapterSource{Adapter: syncerids.Plaid},
	})
	if sources := assetSources(t, store, asset.ID.Int64()); len(sources) != 0 {
		t.Fatalf("adapter sources = %#v, want none", sources)
	}
}

func TestAssetLookupsRejectMalformedAdditional(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:   model.AssetTypeSecurity,
		Identifier:  "MALFORMED-ADDITIONAL",
		Classifier:  model.AssetClassifierPublic,
		UserCreated: true,
	})
	if _, err := store.db.SQL().ExecContext(ctx, `UPDATE assets SET additional = '{' WHERE id = ?`, asset.ID.Int64()); err != nil {
		t.Fatalf("write malformed additional: %v", err)
	}

	if _, err := store.AssetByID(ctx, asset.ID.Int64()); err == nil {
		t.Fatal("AssetByID() returned no error for malformed additional")
	}
	if _, err := store.AllAssets(ctx, model.AssetsInput{}); err == nil {
		t.Fatal("AllAssets() returned no error for malformed additional")
	}
}

func TestSweepUnreferencedAssetsCascadesAdapterSources(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeSecurity,
		Identifier:    "SWEEP-SOURCE",
		Classifier:    model.AssetClassifierPublic,
		AdapterSource: &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: "sec-sweep"},
	})
	if removed, err := store.SweepUnreferencedAssets(ctx); err != nil || removed == 0 {
		t.Fatalf("SweepUnreferencedAssets() = %d, %v; want removal", removed, err)
	}
	if got, err := store.AssetByID(ctx, asset.ID.Int64()); err != nil || got != nil {
		t.Fatalf("AssetByID after sweep = %#v, %v; want nil", got, err)
	}
	if sources := assetSources(t, store, asset.ID.Int64()); len(sources) != 0 {
		t.Fatalf("adapter sources after sweep = %#v, want none", sources)
	}
}

func TestPersistAssetUpdateTrackingMultiplier(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	trackingTicker := "SPY"
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:          model.AssetTypeSecurity,
		Identifier:         "TRACK-TEST",
		Classifier:         model.AssetClassifierPublic,
		TrackingTicker:     &trackingTicker,
		TrackingMultiplier: 1,
	})
	price := 10.0
	priceAt := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	trackingMultiplier := 1.75
	must.NoErr(t, store.PersistAssetUpdate(ctx, wealth.AssetUpdate{
		AssetID:            asset.ID.Int64(),
		Price:              price,
		PriceAt:            priceAt,
		TrackingMultiplier: &trackingMultiplier,
	}))
	updated := mustAssetByID(t, store, asset.ID.Int64())
	if updated.TrackingMultiplier != 1.75 {
		t.Fatalf("TrackingMultiplier = %v, want 1.75", updated.TrackingMultiplier)
	}
}

func TestAllAssetsConnectivityFilters(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	includeHistorical := true

	bad := mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "BAD-ASSET", Classifier: model.AssetClassifierPublic})
	good := mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "GOOD-ASSET", Classifier: model.AssetClassifierPublic})
	must.NoErr(t, store.UpdateAssetPriceConnectivity(ctx, bad.ID.Int64(), model.ConnectivityStatusNotFound))
	must.NoErr(t, store.UpdateAssetInvestmentConnectivity(ctx, good.ID.Int64(), model.ConnectivityStatusIgnore))
	if updated := mustAssetByID(t, store, bad.ID.Int64()); updated.InvestmentConnectivity != model.ConnectivityStatusHealthy {
		t.Fatalf("investment connectivity = %s, want HEALTHY", updated.InvestmentConnectivity)
	}
	if updated := mustAssetByID(t, store, good.ID.Int64()); updated.PriceConnectivity != model.ConnectivityStatusHealthy {
		t.Fatalf("price connectivity = %s, want HEALTHY", updated.PriceConnectivity)
	}

	priceStatus := model.ConnectivityStatusNotFound
	assets, err := store.AllAssets(ctx, model.AssetsInput{PriceConnectivity: &priceStatus, IncludeHistorical: &includeHistorical})
	must.NoErr(t, err)
	if len(assets) != 1 || assets[0].ID != bad.ID || assets[0].PriceConnectivity != model.ConnectivityStatusNotFound {
		t.Fatalf("price-filtered assets = %#v, want BAD-ASSET", assets)
	}

	investmentStatus := model.ConnectivityStatusIgnore
	assets, err = store.AllAssets(ctx, model.AssetsInput{InvestmentConnectivity: &investmentStatus, IncludeHistorical: &includeHistorical})
	must.NoErr(t, err)
	if len(assets) != 1 || assets[0].ID != good.ID || assets[0].InvestmentConnectivity != model.ConnectivityStatusIgnore {
		t.Fatalf("investment-filtered assets = %#v, want GOOD-ASSET", assets)
	}
}

func TestAllAssetsAssetTypeFilter(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	includeHistorical := true

	security := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "TYPE-SECURITY",
		Classifier: model.AssetClassifierPublic,
	})
	mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeCurrency,
		Identifier: "TYPE-CURRENCY",
		Classifier: model.AssetClassifierCash,
	})

	assetType := model.AssetTypeSecurity
	assets, err := store.AllAssets(ctx, model.AssetsInput{AssetType: &assetType, IncludeHistorical: &includeHistorical})
	must.NoErr(t, err)
	if len(assets) != 1 || assets[0].ID != security.ID || assets[0].AssetType != model.AssetTypeSecurity {
		t.Fatalf("asset-type-filtered assets = %#v, want TYPE-SECURITY", assets)
	}
}

func TestAllAssetsExcludesHistoricalByDefault(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)

	_, accountID := mustInvestmentAccount(t, store, "asset-filter-account", "asset-filter-owner", "Brokerage")

	current := mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "CURRENT-ASSET", Classifier: model.AssetClassifierPublic})
	historical := mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "HISTORICAL-ASSET", Classifier: model.AssetClassifierPublic})
	quantity := 2.0
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  accountID,
		Source:     "plaid",
		Date:       "2026-06-01",
		SyncedAt:   "2026-06-01T12:00:00Z",
		BalanceUSD: 200,
		Holdings: []wealth.AssetDailyHolding{
			{AssetID: current.ID.Int64(), Quantity: &quantity, ValueUSD: 200, CountsTowardValue: true},
		},
	})

	assets, err := store.AllAssets(ctx, model.AssetsInput{})
	must.NoErr(t, err)
	if !hasAssetID(assets, current.ID) || hasAssetID(assets, historical.ID) {
		t.Fatalf("default assets = %#v, want CURRENT-ASSET and no HISTORICAL-ASSET", assets)
	}

	includeHistorical := true
	assets, err = store.AllAssets(ctx, model.AssetsInput{IncludeHistorical: &includeHistorical})
	must.NoErr(t, err)
	if !hasAssetID(assets, current.ID) || !hasAssetID(assets, historical.ID) {
		t.Fatalf("historical assets = %#v, want current and historical", assets)
	}
}

func TestAllAssetsIncludesUserCreatedByDefault(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)

	created := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:   model.AssetTypeSecurity,
		Identifier:  "USER-CREATED-ASSET",
		Classifier:  model.AssetClassifierPublic,
		UserEdited:  true,
		UserCreated: true,
	})
	providerOnly := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "PROVIDER-ONLY-ASSET",
		Classifier: model.AssetClassifierPublic,
	})
	providerID := "plaid-security-id"
	providerEdited := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:     model.AssetTypeSecurity,
		Identifier:    "PROVIDER-EDITED-ASSET",
		Classifier:    model.AssetClassifierPublic,
		AdapterSource: &wealth.AdapterSource{Adapter: syncerids.Plaid, SourceID: providerID},
		UserEdited:    true,
	})
	providerEditedNoID := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeCrypto,
		Identifier: "eth:provider-edited-token",
		Classifier: model.AssetClassifierCryptocurrency,
		UserEdited: true,
	})

	assets, err := store.AllAssets(ctx, model.AssetsInput{})
	must.NoErr(t, err)
	if !hasAssetID(assets, created.ID) ||
		hasAssetID(assets, providerOnly.ID) ||
		hasAssetID(assets, providerEdited.ID) ||
		hasAssetID(assets, providerEditedNoID.ID) {
		t.Fatalf("default assets = %#v, want user-created asset and no provider-only/provider-edited asset", assets)
	}
}

func TestAllAssetsSearchMatchesNameAndIdentifier(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	includeHistorical := true

	wrappedName := "Wrapped BTC"
	wrapped := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeCrypto,
		Identifier: "eth:0x2260fac5",
		Name:       &wrappedName,
		Classifier: model.AssetClassifierCryptocurrency,
	})
	radiantName := "Radiant Capital"
	mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeCrypto,
		Identifier: "arb:0x2032b9a8",
		Name:       &radiantName,
		Classifier: model.AssetClassifierCryptocurrency,
	})

	nameSearch := "rapped"
	assets, err := store.AllAssets(ctx, model.AssetsInput{Search: &nameSearch, IncludeHistorical: &includeHistorical})
	must.NoErr(t, err)
	if len(assets) != 1 || assets[0].ID != wrapped.ID {
		t.Fatalf("name search assets = %#v, want Wrapped BTC", assets)
	}
	orderInsensitiveSearch := "BTC Wrapped"
	assets, err = store.AllAssets(ctx, model.AssetsInput{Search: &orderInsensitiveSearch, IncludeHistorical: &includeHistorical})
	must.NoErr(t, err)
	if len(assets) != 1 || assets[0].ID != wrapped.ID {
		t.Fatalf("order-insensitive search assets = %#v, want Wrapped BTC", assets)
	}

	identifierSearch := "2260"
	assets, err = store.AllAssets(ctx, model.AssetsInput{Search: &identifierSearch, IncludeHistorical: &includeHistorical})
	must.NoErr(t, err)
	if len(assets) != 1 || assets[0].ID != wrapped.ID {
		t.Fatalf("identifier search assets = %#v, want Wrapped BTC", assets)
	}
}

func TestAllAssetsShortSearchUsesLikeFallback(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	includeHistorical := true

	usdName := "US Dollar"
	usd := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeCurrency,
		Identifier: "USD",
		Name:       &usdName,
		Classifier: model.AssetClassifierCash,
	})
	vtiName := "Vanguard Total Stock Market ETF"
	mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "VTI",
		Name:       &vtiName,
		Classifier: model.AssetClassifierPublic,
	})
	percentName := "A% Cash"
	percent := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeCurrency,
		Identifier: "PCT",
		Name:       &percentName,
		Classifier: model.AssetClassifierCash,
	})
	underscoreName := "A_ Cash"
	underscore := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeCurrency,
		Identifier: "UND",
		Name:       &underscoreName,
		Classifier: model.AssetClassifierCash,
	})

	search := "US"
	assets, err := store.AllAssets(ctx, model.AssetsInput{Search: &search, IncludeHistorical: &includeHistorical})
	must.NoErr(t, err)
	if len(assets) != 1 || assets[0].ID != usd.ID {
		t.Fatalf("short search assets = %#v, want US Dollar", assets)
	}
	search = "%"
	assets, err = store.AllAssets(ctx, model.AssetsInput{Search: &search, IncludeHistorical: &includeHistorical})
	must.NoErr(t, err)
	if len(assets) != 1 || assets[0].ID != percent.ID {
		t.Fatalf("percent search assets = %#v, want A%% Cash", assets)
	}
	search = "_"
	assets, err = store.AllAssets(ctx, model.AssetsInput{Search: &search, IncludeHistorical: &includeHistorical})
	must.NoErr(t, err)
	if len(assets) != 1 || assets[0].ID != underscore.ID {
		t.Fatalf("underscore search assets = %#v, want A_ Cash", assets)
	}
}

func TestAllAssetsSearchComposesWithAssetTypeFilter(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	includeHistorical := true

	cryptoName := "Acme Token"
	crypto := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeCrypto,
		Identifier: "eth:0xacme",
		Name:       &cryptoName,
		Classifier: model.AssetClassifierCryptocurrency,
	})
	securityName := "Acme Corp"
	mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "ACME",
		Name:       &securityName,
		Classifier: model.AssetClassifierPublic,
	})

	search := "Acme"
	assetType := model.AssetTypeCrypto
	assets, err := store.AllAssets(ctx, model.AssetsInput{AssetType: &assetType, Search: &search, IncludeHistorical: &includeHistorical})
	must.NoErr(t, err)
	if len(assets) != 1 || assets[0].ID != crypto.ID || assets[0].AssetType != model.AssetTypeCrypto {
		t.Fatalf("filtered search assets = %#v, want crypto Acme", assets)
	}
}

func TestAllAssetsFTSSearchComposesWithFiltersAndRank(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	_, accountID := mustInvestmentAccount(t, store, "fts-filter-account", "fts-filter-owner", "FTS Brokerage")

	firstName := "Search Rank Search Rank"
	first := mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "FTS-FIRST", Name: &firstName, Classifier: model.AssetClassifierPublic})
	secondName := "Search Rank"
	second := mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "FTS-SECOND", Name: &secondName, Classifier: model.AssetClassifierPublic})
	historicalName := "Search Rank Historical"
	historical := mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "FTS-HISTORICAL", Name: &historicalName, Classifier: model.AssetClassifierPublic})
	healthyName := "Search Rank Healthy"
	healthy := mustUpsertAsset(t, store, wealth.AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "FTS-HEALTHY", Name: &healthyName, Classifier: model.AssetClassifierPublic})
	for _, asset := range []*model.Asset{first, second, historical} {
		must.NoErr(t, store.UpdateAssetPriceConnectivity(ctx, asset.ID.Int64(), model.ConnectivityStatusNotFound))
	}

	quantity := 1.0
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  accountID,
		Source:     "plaid",
		Date:       "2026-06-01",
		SyncedAt:   "2026-06-01T12:00:00Z",
		BalanceUSD: 300,
		Holdings: []wealth.AssetDailyHolding{
			{AssetID: first.ID.Int64(), Quantity: &quantity, ValueUSD: 100, CountsTowardValue: true},
			{AssetID: second.ID.Int64(), Quantity: &quantity, ValueUSD: 100, CountsTowardValue: true},
			{AssetID: healthy.ID.Int64(), Quantity: &quantity, ValueUSD: 100, CountsTowardValue: true},
		},
	})

	search := "Search Rank"
	status := model.ConnectivityStatusNotFound
	assets, err := store.AllAssets(ctx, model.AssetsInput{Search: &search, PriceConnectivity: &status})
	must.NoErr(t, err)
	if len(assets) != 2 {
		t.Fatalf("filtered FTS assets = %#v, want two assets", assets)
	}
	if got := []model.GlobalID{assets[0].ID, assets[1].ID}; !slices.Equal(got, []model.GlobalID{first.ID, second.ID}) {
		t.Fatalf("filtered FTS assets = %#v, want %v then %v", assets, first.ID, second.ID)
	}
}

func hasAssetID(assets []*model.Asset, id model.GlobalID) bool {
	hasID := func(asset *model.Asset) bool { return asset.ID == id }
	return slices.ContainsFunc(assets, hasID)
}

func assetSources(tb testing.TB, store *testStore, assetID int64) []*model.AssetAdapterSource {
	tb.Helper()
	sourcesByAssetID, err := store.AssetAdapterSourcesByAssetIDs(context.Background(), []int64{assetID})
	must.NoErr(tb, err)
	return sourcesByAssetID[assetID]
}

func TestUpdateAssetForcedPriceLogic(t *testing.T) {
	price := 99.0

	tests := []struct {
		name          string
		input         model.UpdateAssetInput
		wantValue     *float64
		wantSet       bool
		wantClear     bool
		wantErrSubstr string
	}{
		{
			name:      "nil ForcePrice passes ForcedUsdPrice through",
			input:     model.UpdateAssetInput{ID: model.New(model.GlobalIDAsset, 1), ForcedUsdPrice: &price},
			wantValue: &price,
			wantSet:   true,
		},
		{
			name:    "nil ForcePrice and nil ForcedUsdPrice returns nil/false",
			input:   model.UpdateAssetInput{ID: model.New(model.GlobalIDAsset, 1)},
			wantSet: false,
		},
		{
			name:      "ForcePrice=false clears the price",
			input:     model.UpdateAssetInput{ID: model.New(model.GlobalIDAsset, 1), ForcePrice: new(false)},
			wantClear: true,
		},
		{
			name:      "ForcePrice=true with value sets it",
			input:     model.UpdateAssetInput{ID: model.New(model.GlobalIDAsset, 1), ForcePrice: new(true), ForcedUsdPrice: &price},
			wantValue: &price,
			wantSet:   true,
		},
		{
			name:          "ForcePrice=true without value returns error",
			input:         model.UpdateAssetInput{ID: model.New(model.GlobalIDAsset, 1), ForcePrice: new(true)},
			wantErrSubstr: "forcedUsdPrice is required",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			update, err := updateAssetForcedPrice(tc.input)
			if tc.wantErrSubstr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErrSubstr) {
					t.Fatalf("error = %v, want %q", err, tc.wantErrSubstr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if update.Set != tc.wantSet {
				t.Fatalf("set = %v, want %v", update.Set, tc.wantSet)
			}
			if update.Clear != tc.wantClear {
				t.Fatalf("clear = %v, want %v", update.Clear, tc.wantClear)
			}
			if tc.wantValue == nil {
				if update.Value != nil {
					t.Fatalf("value = %v, want nil", update.Value)
				}
			} else if update.Value == nil || *update.Value != *tc.wantValue {
				t.Fatalf("value = %v, want %v", update.Value, *tc.wantValue)
			}
		})
	}
}

func TestMergeAdditionalRealEstate(t *testing.T) {
	street := "123 Main St"
	city := "Springfield"
	state := "IL"
	initial, err := marshalAdditional(RealEstateAdditional{Street: &street})
	must.NoErr(t, err)
	existing := initial

	update, err := marshalAdditional(RealEstateAdditional{City: &city, State: &state})
	must.NoErr(t, err)

	merged, err := mergeAdditional(model.AssetTypeRealEstate, existing, update)
	must.NoErr(t, err)
	if merged == nil {
		t.Fatal("mergeAdditional returned nil")
	}

	var result RealEstateAdditional
	must.NoErr(t, unmarshalAdditional(merged, &result))
	if result.Street == nil || *result.Street != street {
		t.Fatalf("Street = %v, want %q", result.Street, street)
	}
	if result.City == nil || *result.City != city {
		t.Fatalf("City = %v, want %q", result.City, city)
	}
	if result.State == nil || *result.State != state {
		t.Fatalf("State = %v, want %q", result.State, state)
	}
}

func TestMergeAdditionalNilIncomingPreservesExisting(t *testing.T) {
	street := "Preserved St"
	initial, err := marshalAdditional(RealEstateAdditional{Street: &street})
	must.NoErr(t, err)
	existing := initial

	result, err := mergeAdditional(model.AssetTypeRealEstate, existing, nil)
	must.NoErr(t, err)
	if result == nil || *result != *initial {
		t.Fatalf("mergeAdditional(nil incoming) = %v, want %q", result, *initial)
	}
}

func TestUpdateAssetForcedPriceViaUpdateAsset(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)

	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "FORCE-PRICE-TEST",
		Classifier: model.AssetClassifierPublic,
	})

	forcedPrice := 500.0
	got, err := store.UpdateAsset(ctx, model.UpdateAssetInput{
		ID:             asset.ID,
		ForcePrice:     new(true),
		ForcedUsdPrice: &forcedPrice,
	})
	must.NoErr(t, err)
	if got.ForcedUsdPrice == nil || *got.ForcedUsdPrice != 500.0 {
		t.Fatalf("ForcedUsdPrice = %v, want 500.0", got.ForcedUsdPrice)
	}

	// Clear the forced price.
	got, err = store.UpdateAsset(ctx, model.UpdateAssetInput{
		ID:         asset.ID,
		ForcePrice: new(false),
	})
	must.NoErr(t, err)
	if got.ForcedUsdPrice != nil {
		t.Fatalf("ForcedUsdPrice = %v after clear, want nil", got.ForcedUsdPrice)
	}
}

func TestMergeAdditionalInvalidJSON(t *testing.T) {
	bad := `{invalid`
	existing := new(`{"cusip":"X"}`)
	_, err := mergeAdditional(model.AssetTypeSecurity, existing, &bad)
	if err == nil {
		t.Fatal("expected error for invalid JSON incoming")
	}

	_, err = mergeAdditional(model.AssetTypeCrypto, existing, &bad)
	if err == nil {
		t.Fatal("expected error for invalid JSON incoming (crypto)")
	}

	_, err = mergeAdditional(model.AssetTypeRealEstate, existing, &bad)
	if err == nil {
		t.Fatal("expected error for invalid JSON incoming (real estate)")
	}
}

func TestMergeAdditionalUnknownType(t *testing.T) {
	val := `{"foo":"bar"}`
	result, err := mergeAdditional(model.AssetTypeCurrency, nil, &val)
	must.NoErr(t, err)
	if result != nil {
		t.Fatalf("expected nil for unknown asset type, got %v", result)
	}
}
