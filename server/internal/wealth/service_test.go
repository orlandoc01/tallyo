package wealth

import (
	"testing"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
)

func TestForwardFillSnapshot(t *testing.T) {
	tests := map[string]struct {
		snaps           []accountSnapshot
		date            string
		wantAssets      money.Cents
		wantLiabilities money.Cents
	}{
		"asset": {
			snaps:      []accountSnapshot{{LocalDate: "2026-01-01", Value: 500.0, Liability: false}},
			date:       "2026-01-01",
			wantAssets: 500.0,
		},
		"liability": {
			snaps:           []accountSnapshot{{LocalDate: "2026-01-01", Value: 300.0, Liability: true}},
			date:            "2026-01-01",
			wantLiabilities: 300.0,
		},
		"same-day latest": {
			snaps: []accountSnapshot{
				{LocalDate: "2026-06-22", SyncedAt: "2026-06-22T21:47:39Z", Value: 100.0},
				{LocalDate: "2026-06-22", SyncedAt: "2026-06-23T01:42:09Z", Value: 120.0},
			},
			date:       "2026-06-22",
			wantAssets: 120.0,
		},
		"before-first": {
			snaps: []accountSnapshot{{LocalDate: "2026-02-01", Value: 500.0, Liability: false}},
			date:  "2026-01-01",
		},
		"closed-after-last": {
			snaps: []accountSnapshot{{LocalDate: "2026-01-01", Value: 500.0, Closed: true}},
			date:  "2026-01-02",
		},
		"closed-between-snapshots": {
			snaps: []accountSnapshot{
				{LocalDate: "2026-01-01", Value: 500.0, Closed: true},
				{LocalDate: "2026-01-03", Value: 700.0, Closed: true},
			},
			date:       "2026-01-02",
			wantAssets: 500.0,
		},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			assets, liabilities := forwardFillSnapshot(tc.snaps, tc.date)
			if assets != tc.wantAssets || liabilities != tc.wantLiabilities {
				t.Errorf("forwardFillSnapshot(%s) = assets=%d, liabilities=%d", name, assets, liabilities)
			}
		})
	}
}

func TestHoldingRollupsRequireEveryQuantity(t *testing.T) {
	asset := &model.Asset{ID: model.New(model.GlobalIDAsset, 1)}
	account := &model.Account{ID: model.New(model.GlobalIDAccount, 1)}
	zero := 0.0
	two := 2.0
	holdings := []CurrentHolding{
		{Asset: asset, Account: account, Quantity: &zero, ValueUSD: 100},
		{Asset: asset, Account: account, Quantity: &two, ValueUSD: 200},
	}
	rollups := holdingRollups(holdings)
	if len(rollups) != 1 || rollups[0].TotalQuantity == nil || *rollups[0].TotalQuantity != 2 {
		t.Fatalf("rollups = %#v, want known total quantity 2", rollups)
	}

	rollups = holdingRollups(append(holdings, CurrentHolding{Asset: asset, Account: account, ValueUSD: 300}))
	if len(rollups) != 1 || rollups[0].TotalQuantity != nil {
		t.Fatalf("rollups = %#v, want unknown total quantity", rollups)
	}
}

func TestSnapshotCarryForwardQuantitySemantics(t *testing.T) {
	asset := &model.Asset{ID: model.New(model.GlobalIDAsset, 1)}
	firstQuantity := 2.0
	secondQuantity := 2.0
	zero := 0.0
	tests := map[string]struct {
		previous *float64
		next     *float64
		want     bool
	}{
		"both unknown": {want: true},
		"same known value": {
			previous: &firstQuantity,
			next:     &secondQuantity,
			want:     true,
		},
		"unknown and zero differ": {next: &zero},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			previous := []SnapshotHolding{{Asset: asset, Quantity: tc.previous}}
			next := []SnapshotHolding{{Asset: asset, Quantity: tc.next}}
			if got := isPureCarryForward(previous, 100, next, 100); got != tc.want {
				t.Fatalf("isPureCarryForward() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestPropagateHoldingsWithUnknownQuantityPreservesValue(t *testing.T) {
	asset := &model.Asset{ID: model.New(model.GlobalIDAsset, 1)}
	storedPrice := 20.0
	got := propagateHoldingsWithStoredPrices(
		[]SnapshotEditHolding{{AssetID: 1, ValueUSD: money.FromDollars(125)}},
		[]SnapshotHolding{{Asset: asset, Price: &storedPrice}},
	)
	if len(got) != 1 || got[0].Quantity != nil || got[0].Price == nil || *got[0].Price != 20 || got[0].ValueUSD != money.FromDollars(125) {
		t.Fatalf("propagated holdings = %#v, want unknown quantity and preserved value", got)
	}
}

func TestSnapshotHoldingsToModelPreservesUnknownQuantity(t *testing.T) {
	holdings := snapshotHoldingsToModel([]SnapshotHolding{{Asset: &model.Asset{ID: model.New(model.GlobalIDAsset, 1)}}}, 1)
	if len(holdings) != 1 || holdings[0].Quantity != nil {
		t.Fatalf("holdings = %#v, want unknown quantity", holdings)
	}
}
