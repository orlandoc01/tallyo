package wealthdb

import (
	"context"
	"testing"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	"tallyo/internal/wealth"
)

// A holding may carry an AssetUpsert instead of a pre-resolved AssetID. The
// asset must be created in the same transaction as its holding, so it can never
// be committed (and surface in the Assets list) without a holding to back it.
func TestReplaceAccountBalanceSnapshotUpsertsAssetInTransaction(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	accountID := createCryptoAccount(t, ctx, store)
	name := "Wrapped Ether"

	snapshot := wealth.AccountBalanceSnapshot{
		AccountID:     accountID,
		WalletAddress: "0xabc",
		Source:        "debank",
		Date:          "2026-06-01",
		SyncedAt:      "2026-06-01T12:00:00Z",
		BalanceUSD:    300,
		Holdings: []wealth.AssetDailyHolding{{
			Asset:             &wealth.AssetUpsert{AssetType: model.AssetTypeCrypto, Identifier: "eth:0xweth", Name: &name, Classifier: model.AssetClassifierCryptocurrency},
			ValueUSD:          300,
			CountsTowardValue: true,
		}},
	}
	must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, snapshot))

	holdings := mustCurrentHoldings(t, store, wealth.AccountFilter{})
	if len(holdings) != 1 || holdings[0].Quantity != nil || holdings[0].ValueUSD != money.FromDollars(300) {
		t.Fatalf("holdings = %#v, want one 300 holding with unknown quantity", holdings)
	}
	latest, err := store.LatestAccountBalanceSnapshotForAccount(ctx, accountID)
	if err != nil || latest == nil {
		t.Fatalf("LatestAccountBalanceSnapshotForAccount = %#v, %v", latest, err)
	}
	snapshotHoldings, err := store.SnapshotHoldingsBySnapshotID(ctx, latest.ID)
	if err != nil || len(snapshotHoldings) != 1 || snapshotHoldings[0].Quantity != nil {
		t.Fatalf("SnapshotHoldingsBySnapshotID = %#v, %v; want unknown quantity", snapshotHoldings, err)
	}
	asset, err := assetByKey(ctx, store.q, string(model.AssetTypeCrypto), "eth:0xweth")
	must.NoErr(t, err)
	if asset == nil || asset.ID.Int64() != holdings[0].Asset.ID.Int64() {
		t.Fatalf("asset %#v not linked to holding asset %#v", asset, holdings[0].Asset)
	}
}

func TestReplaceAccountBalanceSnapshotUnknownDuplicateQuantityStaysUnknown(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	accountID := createCryptoAccount(t, ctx, store)
	name := "GMX Unknown"
	upsert := func() *wealth.AssetUpsert {
		return &wealth.AssetUpsert{AssetType: model.AssetTypeCrypto, Identifier: "arb:0xgmx-unknown", Name: &name, Classifier: model.AssetClassifierCryptocurrency}
	}
	quantity := 2.0

	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  accountID,
		Source:     "debank",
		Date:       "2026-06-01",
		SyncedAt:   "2026-06-01T12:00:00Z",
		BalanceUSD: money.FromDollars(150),
		Holdings: []wealth.AssetDailyHolding{
			{Asset: upsert(), Quantity: &quantity, ValueUSD: 100, CountsTowardValue: true},
			{Asset: upsert(), ValueUSD: 50, CountsTowardValue: true},
		},
	})

	holdings := mustCurrentHoldings(t, store, wealth.AccountFilter{})
	if len(holdings) != 1 || holdings[0].Quantity != nil || holdings[0].ValueUSD != money.FromDollars(150) {
		t.Fatalf("holdings = %#v, want one folded holding with unknown quantity and value 150", holdings)
	}
}

func TestRevalueLatestAssetHoldingWithoutQuantityPreservesValue(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	accountID := createCryptoAccount(t, ctx, store)
	asset := mustUpsertAsset(t, store, wealth.AssetUpsert{
		AssetType:  model.AssetTypeCrypto,
		Identifier: "eth:valued-only",
		Classifier: model.AssetClassifierCryptocurrency,
	})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  accountID,
		Source:     "debank",
		Date:       "2026-06-01",
		SyncedAt:   "2026-06-01T12:00:00Z",
		BalanceUSD: money.FromDollars(300),
		Holdings: []wealth.AssetDailyHolding{{
			AssetID:           asset.ID.Int64(),
			ValueUSD:          300,
			CountsTowardValue: true,
		}},
	})

	must.NoErr(t, store.RevalueLatestAssetHoldings(ctx, asset.ID.Int64(), 50))
	latest, err := store.LatestAccountBalanceSnapshotForAccount(ctx, accountID)
	if err != nil || latest == nil || latest.BalanceUSD != money.FromDollars(300) {
		t.Fatalf("LatestAccountBalanceSnapshotForAccount = %#v, %v", latest, err)
	}
	holdings, err := store.SnapshotHoldingsBySnapshotID(ctx, latest.ID)
	if err != nil || len(holdings) != 1 {
		t.Fatalf("SnapshotHoldingsBySnapshotID = %#v, %v", holdings, err)
	}
	if holdings[0].Quantity != nil || holdings[0].Price == nil || *holdings[0].Price != 50 || holdings[0].ValueUSD != money.FromDollars(300) {
		t.Fatalf("holding = %#v, want updated price with unknown quantity and preserved value", holdings[0])
	}
}

// Two provider holdings can resolve to the same asset within one snapshot (e.g.
// a wallet balance and a DeFi-project position on the same token). They must
// fold into a single summed holding rather than fail the (account_id, date,
// asset_id) unique index — which previously rolled back the holdings write and
// orphaned the already-committed asset.
func TestReplaceAccountBalanceSnapshotFoldsDuplicateAssetHoldings(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	accountID := createCryptoAccount(t, ctx, store)
	name := "GMX"
	upsert := func() *wealth.AssetUpsert {
		return &wealth.AssetUpsert{AssetType: model.AssetTypeCrypto, Identifier: "arb:0xgmx", Name: &name, Classifier: model.AssetClassifierCryptocurrency}
	}
	qtyWallet, qtyProject := 2.0, 3.0

	snapshot := wealth.AccountBalanceSnapshot{
		AccountID:     accountID,
		WalletAddress: "0xabc",
		Source:        "debank",
		Date:          "2026-06-01",
		SyncedAt:      "2026-06-01T12:00:00Z",
		BalanceUSD:    150,
		Holdings: []wealth.AssetDailyHolding{
			{Asset: upsert(), Quantity: &qtyWallet, ValueUSD: 100, CountsTowardValue: true},
			{Asset: upsert(), Quantity: &qtyProject, ValueUSD: 50, CountsTowardValue: true},
		},
	}
	must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, snapshot))

	holdings := mustCurrentHoldings(t, store, wealth.AccountFilter{})
	if len(holdings) != 1 || holdings[0].ValueUSD != money.FromDollars(150) || holdings[0].Quantity == nil || *holdings[0].Quantity != 5 {
		t.Fatalf("holdings = %#v, want one folded holding (value 150, qty 5)", holdings)
	}

	assets, err := store.AllAssets(ctx, model.AssetsInput{})
	must.NoErr(t, err)
	crypto := 0
	for _, a := range assets {
		if a.AssetType == model.AssetTypeCrypto {
			crypto++
		}
	}
	if crypto != 1 {
		t.Fatalf("crypto assets = %d, want exactly 1 (no orphan)", crypto)
	}
}
