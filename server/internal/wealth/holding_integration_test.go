package wealth_test

import (
	"context"
	"testing"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	testutil "tallyo/internal/utils/test"
	. "tallyo/internal/wealth"
)

func TestAssetSnapshotsByIDsAggregatesQuantityAndValue(t *testing.T) {
	ctx := context.Background()
	store := openWealthTestStore(t)
	owner := testutil.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "asset-snapshot-owner"})
	known := &model.Account{Owner: owner, Name: "Known Brokerage", Type: model.AccountTypeInvestment}
	unknown := &model.Account{Owner: owner, Name: "Unknown Brokerage", Type: model.AccountTypeInvestment}
	testutil.MustUpsertAccount(t, store, "asset-snapshot-known", known)
	testutil.MustUpsertAccount(t, store, "asset-snapshot-unknown", unknown)

	asset := mustUpsertAsset(t, store, AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "AGGREGATE-QUANTITY", Classifier: model.AssetClassifierPublic})
	knownQuantity := 2.0
	must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, AccountBalanceSnapshot{
		AccountID: known.ID.Int64(), Source: "plaid", Date: "2026-06-01", SyncedAt: "2026-06-01T12:00:00Z",
		BalanceUSD: money.FromDollars(50),
		Holdings:   []AssetDailyHolding{{AssetID: asset.ID.Int64(), Quantity: &knownQuantity, ValueUSD: 50, CountsTowardValue: true}},
	}))
	must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, AccountBalanceSnapshot{
		AccountID: unknown.ID.Int64(), Source: "plaid", Date: "2026-06-02", SyncedAt: "2026-06-02T12:00:00Z",
		BalanceUSD: money.FromDollars(100),
		Holdings:   []AssetDailyHolding{{AssetID: asset.ID.Int64(), ValueUSD: 100, CountsTowardValue: true}},
	}))

	svc := testService(store)
	snapshots, err := svc.AssetSnapshotsByIDs(ctx, []int64{asset.ID.Int64()})
	must.NoErr(t, err)
	got := snapshots[asset.ID.Int64()]
	if got == nil || got.TotalHeldQuantity != nil || got.TotalHeldValueUsd != money.FromDollars(150) || got.AsOfDate != "2026-06-02" || len(got.Holdings) != 2 {
		t.Fatalf("snapshot = %#v, want unknown quantity, value 150, asOfDate 2026-06-02, 2 holdings", got)
	}
	if got.Holdings[0].ValueUsd < got.Holdings[1].ValueUsd {
		t.Fatalf("holdings = %#v, want sorted by value descending", got.Holdings)
	}

	// Once every contributing holding reports a known quantity, the total becomes known.
	secondQuantity := 3.0
	must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, AccountBalanceSnapshot{
		AccountID: unknown.ID.Int64(), Source: "plaid", Date: "2026-06-02", SyncedAt: "2026-06-02T12:00:00Z",
		BalanceUSD: money.FromDollars(100),
		Holdings:   []AssetDailyHolding{{AssetID: asset.ID.Int64(), Quantity: &secondQuantity, ValueUSD: 100, CountsTowardValue: true}},
	}))
	snapshots, err = svc.AssetSnapshotsByIDs(ctx, []int64{asset.ID.Int64()})
	must.NoErr(t, err)
	got = snapshots[asset.ID.Int64()]
	if got == nil || got.TotalHeldQuantity == nil || *got.TotalHeldQuantity != 5 {
		t.Fatalf("snapshot = %#v, want total quantity 5", got)
	}
}

func TestCurrentHoldingsFiltersAndCanonicalRows(t *testing.T) {
	ctx := context.Background()
	store := openWealthTestStore(t)
	owner := testutil.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "current-holdings-owner"})
	active := &model.Account{Owner: owner, Name: "Active Brokerage", Type: model.AccountTypeInvestment}
	hidden := &model.Account{Owner: owner, Name: "Hidden Brokerage", Type: model.AccountTypeInvestment, Hidden: true}
	closed := &model.Account{Owner: owner, Name: "Closed Brokerage", Type: model.AccountTypeInvestment, Closed: true}
	testutil.MustUpsertAccount(t, store, "current-active", active)
	testutil.MustUpsertAccount(t, store, "current-hidden", hidden)
	testutil.MustUpsertAccount(t, store, "current-closed", closed)

	target := mustUpsertAsset(t, store, AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "CURRENT-TARGET", Classifier: model.AssetClassifierPublic})
	other := mustUpsertAsset(t, store, AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "CURRENT-OTHER", Classifier: model.AssetClassifierPublic})
	zero := mustUpsertAsset(t, store, AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "CURRENT-ZERO", Classifier: model.AssetClassifierPublic})
	nonCountable := mustUpsertAsset(t, store, AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "CURRENT-NONCOUNT", Classifier: model.AssetClassifierPublic})
	one := 1.0
	two := 2.0
	zeroQuantity := 0.0

	must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, AccountBalanceSnapshot{
		AccountID: active.ID.Int64(), Source: "plaid", Date: "2026-06-01", SyncedAt: "2026-06-01T12:00:00Z",
		BalanceUSD: money.FromDollars(999),
		Holdings:   []AssetDailyHolding{{AssetID: target.ID.Int64(), Quantity: &one, ValueUSD: 999, CountsTowardValue: true}},
	}))
	must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, AccountBalanceSnapshot{
		AccountID: active.ID.Int64(), Source: "plaid", Date: "2026-06-02", SyncedAt: "2026-06-02T12:00:00Z",
		BalanceUSD: money.FromDollars(35),
		Holdings: []AssetDailyHolding{
			{AssetID: target.ID.Int64(), Quantity: &one, ValueUSD: 10, CountsTowardValue: true, Manual: true},
			{AssetID: target.ID.Int64(), Quantity: &two, ValueUSD: 20, CountsTowardValue: true},
			{AssetID: other.ID.Int64(), Quantity: &one, ValueUSD: 5, CountsTowardValue: true},
			{AssetID: zero.ID.Int64(), Quantity: &zeroQuantity, ValueUSD: 0, CountsTowardValue: true},
			{AssetID: nonCountable.ID.Int64(), Quantity: &one, ValueUSD: 100, CountsTowardValue: false},
		},
	}))
	for _, account := range []*model.Account{hidden, closed} {
		must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, AccountBalanceSnapshot{
			AccountID: account.ID.Int64(), Source: "plaid", Date: "2026-06-02", SyncedAt: "2026-06-02T12:00:00Z",
			BalanceUSD: money.FromDollars(100),
			Holdings:   []AssetDailyHolding{{AssetID: target.ID.Int64(), Quantity: &one, ValueUSD: 100, CountsTowardValue: true}},
		}))
	}

	holdings, err := store.CurrentHoldings(ctx, AccountFilter{})
	must.NoErr(t, err)
	if len(holdings) != 3 {
		t.Fatalf("holdings = %#v, want target, other, and zero-value rows only", holdings)
	}

	filtered, err := store.CurrentHoldings(ctx, AccountFilter{AssetIDs: []int64{target.ID.Int64()}})
	must.NoErr(t, err)
	if len(filtered) != 1 {
		t.Fatalf("filtered holdings = %#v, want one target row", filtered)
	}
	got := filtered[0]
	if got.Asset.ID != target.ID || got.Account.ID != active.ID || got.ValueUSD != money.FromDollars(30) || got.Quantity == nil || *got.Quantity != 3 || !got.Manual || got.SnapshotDate != "2026-06-02" {
		t.Fatalf("target holding = %#v, want folded latest active row", got)
	}
}

func TestAssetSnapshotsByIDsOmitsUnheldAssets(t *testing.T) {
	ctx := context.Background()
	store := openWealthTestStore(t)
	asset := mustUpsertAsset(t, store, AssetUpsert{AssetType: model.AssetTypeSecurity, Identifier: "NEVER-HELD", Classifier: model.AssetClassifierPublic})

	svc := testService(store)
	snapshots, err := svc.AssetSnapshotsByIDs(ctx, []int64{asset.ID.Int64()})
	must.NoErr(t, err)
	if _, ok := snapshots[asset.ID.Int64()]; ok {
		t.Fatalf("snapshots = %#v, want unheld asset absent", snapshots)
	}
}
