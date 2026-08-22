package wealth

import (
	"context"
	"testing"

	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	testutil "tallyo/internal/utils/test"
)

func TestEmitCleanCarriesAnchor(t *testing.T) {
	events := make(chan PersistEvent, 1)
	anchor := LastUnflaggedBalanceResult{Found: true, AmountUSD: 50, Date: "2026-07-01"}
	EmitClean(AccountBalanceSnapshot{AccountID: 7, BalanceUSD: 100}, anchor, events)

	draft := (<-events).Snapshot
	if draft.Decision != DecisionClean || draft.Anchor != anchor || draft.BalanceUSD != 100 {
		t.Fatalf("draft = %#v", draft)
	}
}

func TestEmitApprovedCarryForward(t *testing.T) {
	events := make(chan PersistEvent, 1)
	prior := LastUnflaggedSnapshotResult{
		Found:     true,
		AmountUSD: 50,
		Date:      "2026-07-01",
		Holdings:  []AssetDailyHolding{{AssetID: 1, ValueUSD: 50, CountsTowardValue: true}},
	}
	snapshot := AccountBalanceSnapshot{
		AccountID:  7,
		BalanceUSD: 9000,
		Holdings:   []AssetDailyHolding{{ValueUSD: 9000}},
	}
	EmitApprovedCarryForward(snapshot, prior, "fresh spike", events)

	draft := (<-events).Snapshot
	if draft.Decision != DecisionApprovedCarryForward || draft.CarryUSD != 50 {
		t.Fatalf("draft = %#v", draft)
	}
	if draft.BalanceUSD != 50 || !draft.Flagged || len(draft.Holdings) != 1 || draft.Review != nil || draft.ProviderState != nil {
		t.Fatalf("carried snapshot = %#v", draft.AccountBalanceSnapshot)
	}
	if draft.FlagReason != "fresh spike" {
		t.Fatalf("flag reason = %q, want current anomaly reason", draft.FlagReason)
	}
}

func TestEmitFlaggedRaisesReviewAndCarriesForward(t *testing.T) {
	events := make(chan PersistEvent, 1)
	adapter := BaseAdapter{Log: testutil.Logger}
	prior := LastUnflaggedSnapshotResult{
		Found:     true,
		AmountUSD: 50,
		Date:      "2026-07-01",
		Holdings:  []AssetDailyHolding{{AssetID: 1, ValueUSD: 50, CountsTowardValue: true}},
	}
	snapshot := AccountBalanceSnapshot{
		AccountID:  7,
		Source:     "simplefin",
		Date:       "2026-07-02",
		BalanceUSD: 9000,
		Holdings:   []AssetDailyHolding{{ValueUSD: 9000}},
	}
	must.NoErr(t, adapter.EmitFlagged(snapshot, prior, "spike", snapshot.Holdings, events))

	draft := (<-events).Snapshot
	if draft.Decision != DecisionFlagged || draft.CarryUSD != 50 {
		t.Fatalf("draft = %#v", draft)
	}
	if draft.BalanceUSD != 50 || !draft.Flagged || draft.FlagReason != "spike" || len(draft.Holdings) != 1 || draft.ProviderState == nil {
		t.Fatalf("flagged snapshot = %#v", draft.AccountBalanceSnapshot)
	}
	review := draft.Review
	if review == nil {
		t.Fatal("expected a balance review")
	}
	if review.AccountID != 7 || review.ProviderBalanceUSD != 9000 || review.CarryForwardBalanceUSD != 50 {
		t.Fatalf("review = %#v", review)
	}
	if review.FirstFlaggedDate != "2026-07-02" || review.LatestFlaggedDate != "2026-07-02" || review.FlagReason != "spike" {
		t.Fatalf("review = %#v", review)
	}
}

func TestEmitWithPriceCheckAutoCarriesByProviderTotalOnly(t *testing.T) {
	priorPrice := 1.0
	nextPrice := 150.0
	store := flaggingReadStore{
		prior: LastUnflaggedSnapshotResult{
			Found:     true,
			AmountUSD: 50,
			Date:      "2026-07-01",
			Holdings:  []AssetDailyHolding{{Identifier: "VTI", Price: &priorPrice, ValueUSD: 50}},
		},
		approved: &ApprovedBalanceReview{ProviderBalanceUSD: 100},
	}
	adapter := BaseAdapter{Reads: store, Log: testutil.Logger}
	snapshot := AccountBalanceSnapshot{
		AccountID:  7,
		Source:     "plaid",
		Date:       "2026-07-02",
		BalanceUSD: 104,
		Holdings:   []AssetDailyHolding{{Identifier: "VTI", Price: &nextPrice, ValueUSD: 104}},
	}
	events := make(chan PersistEvent, 1)

	must.NoErr(t, adapter.EmitWithPriceCheck(context.Background(), snapshot, events))
	draft := (<-events).Snapshot
	if draft.Decision != DecisionApprovedCarryForward || draft.Review != nil || draft.ProviderState != nil {
		t.Fatalf("draft = %#v", draft)
	}
	if draft.FlagReason == "" || draft.BalanceUSD != 50 {
		t.Fatalf("carried snapshot = %#v", draft.AccountBalanceSnapshot)
	}
}

func TestEmitWithPriceCheckCreatesReviewBeyondApprovedTotalTolerance(t *testing.T) {
	priorPrice := 1.0
	nextPrice := 150.0
	store := flaggingReadStore{
		prior: LastUnflaggedSnapshotResult{
			Found:     true,
			AmountUSD: 50,
			Date:      "2026-07-01",
			Holdings:  []AssetDailyHolding{{Identifier: "VTI", Price: &priorPrice, ValueUSD: 50}},
		},
		approved: &ApprovedBalanceReview{ProviderBalanceUSD: 100},
	}
	adapter := BaseAdapter{Reads: store, Log: testutil.Logger}
	snapshot := AccountBalanceSnapshot{
		AccountID:  7,
		Source:     "plaid",
		Date:       "2026-07-02",
		BalanceUSD: 106,
		Holdings:   []AssetDailyHolding{{Identifier: "VTI", Price: &nextPrice, ValueUSD: 106}},
	}
	events := make(chan PersistEvent, 1)

	must.NoErr(t, adapter.EmitWithPriceCheck(context.Background(), snapshot, events))
	draft := (<-events).Snapshot
	if draft.Decision != DecisionFlagged || draft.Review == nil || draft.ProviderState == nil {
		t.Fatalf("draft = %#v", draft)
	}
	if draft.Review.ProviderBalanceUSD != 106 {
		t.Fatalf("review provider balance = %v, want 106", draft.Review.ProviderBalanceUSD)
	}
}

func TestEmitWithPriceCheckCleanViewIgnoresApprovedReview(t *testing.T) {
	priorPrice := 100.0
	nextPrice := 101.0
	store := flaggingReadStore{
		prior: LastUnflaggedSnapshotResult{
			Found:     true,
			AmountUSD: 50,
			Date:      "2026-07-01",
			Holdings:  []AssetDailyHolding{{Identifier: "VTI", Price: &priorPrice, ValueUSD: 50}},
		},
		approved: &ApprovedBalanceReview{ProviderBalanceUSD: 100},
	}
	adapter := BaseAdapter{Reads: store, Log: testutil.Logger}
	snapshot := AccountBalanceSnapshot{
		AccountID:  7,
		Source:     "plaid",
		Date:       "2026-07-02",
		BalanceUSD: 100,
		Holdings:   []AssetDailyHolding{{Identifier: "VTI", Price: &nextPrice, ValueUSD: 100}},
	}
	events := make(chan PersistEvent, 1)

	must.NoErr(t, adapter.EmitWithPriceCheck(context.Background(), snapshot, events))
	draft := (<-events).Snapshot
	if draft.Decision != DecisionClean || draft.Flagged || draft.Review != nil || draft.ProviderState != nil {
		t.Fatalf("draft = %#v", draft)
	}
}

func TestProviderBalanceWithinTolerance(t *testing.T) {
	cases := []struct {
		name     string
		provider float64
		approved float64
		want     bool
	}{
		{"exact match", 100, 100, true},
		{"exact 5 percent high", 105, 100, true},
		{"exact 5 percent low", 95, 100, true},
		{"within 5 percent", 104, 100, true},
		{"beyond 5 percent", 106, 100, false},
		{"approved zero, provider near zero", 0.005, 0, true},
		{"approved zero, provider exact cent", 0.01, 0, true},
		{"approved zero, provider nonzero", 5, 0, false},
		{"negative approved within tolerance", -104, -100, true},
		{"sign flip", 100, -100, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ProviderBalanceWithinTolerance(tc.provider, tc.approved); got != tc.want {
				t.Errorf("ProviderBalanceWithinTolerance(%v, %v) = %v, want %v", tc.provider, tc.approved, got, tc.want)
			}
		})
	}
}

type flaggingReadStore struct {
	prior    LastUnflaggedSnapshotResult
	approved *ApprovedBalanceReview
}

func (s flaggingReadStore) AssetByID(context.Context, int64) (*model.Asset, error) {
	return nil, nil
}

func (s flaggingReadStore) AccountByID(context.Context, int64) (*model.Account, error) {
	return nil, nil
}

func (s flaggingReadStore) AccountByExternalID(context.Context, string) (int64, model.AccountType, error) {
	return 0, "", nil
}

func (s flaggingReadStore) LatestUnflaggedSnapshotWithHoldings(context.Context, int64, string) (LastUnflaggedSnapshotResult, error) {
	return s.prior, nil
}

func (s flaggingReadStore) GetApprovedBalanceReviewByAccount(context.Context, int64) (*ApprovedBalanceReview, error) {
	return s.approved, nil
}
