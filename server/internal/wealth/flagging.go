package wealth

import (
	"context"
	"fmt"
	"math"

	"tallyo/internal/money"
)

// HoldingPriceDeviationRatio is the shared per-holding anomaly threshold for
// provider snapshots where a 100x price move indicates provider corruption.
const HoldingPriceDeviationRatio = 100.0

func AnchorFromSnapshot(prior LastUnflaggedSnapshotResult) LastUnflaggedBalanceResult {
	return LastUnflaggedBalanceResult{Found: prior.Found, AmountUSD: prior.AmountUSD, Date: prior.Date}
}

// ApprovedReviewMatches reports whether the account has an approved balance
// review whose provider balance matches the freshly fetched one closely enough
// to auto-carry forward instead of re-flagging.
func (a BaseAdapter) ApprovedReviewMatches(
	ctx context.Context,
	accountID int64,
	providerBalanceUSD money.Cents,
) (bool, error) {
	approved, err := a.Reads.GetApprovedBalanceReviewByAccount(ctx, accountID)
	if err != nil {
		return false, fmt.Errorf("lookup approved balance review: %w", err)
	}
	if approved == nil {
		return false, nil
	}
	return ProviderBalanceWithinTolerance(
		providerBalanceUSD.Dollars(),
		approved.ProviderBalanceUSD.Dollars(),
	), nil
}

func (a BaseAdapter) EmitWithPriceCheck(
	ctx context.Context,
	snapshot AccountBalanceSnapshot,
	events chan<- PersistEvent,
) error {
	prior, err := a.Reads.LatestUnflaggedSnapshotWithHoldings(ctx, snapshot.AccountID, snapshot.Date)
	if err != nil {
		return fmt.Errorf("load prior unflagged snapshot: %w", err)
	}
	anchor := AnchorFromSnapshot(prior)
	reason := HoldingPriceDeviates(prior.Holdings, snapshot.Holdings, HoldingPriceDeviationRatio)
	if reason == "" {
		EmitClean(snapshot, anchor, events)
		return nil
	}
	matches, err := a.ApprovedReviewMatches(ctx, snapshot.AccountID, snapshot.BalanceUSD)
	if err != nil {
		return err
	}
	if matches {
		EmitApprovedCarryForward(snapshot, prior, reason, events)
		return nil
	}
	return a.EmitFlagged(snapshot, prior, reason, snapshot.Holdings, events)
}

func ProviderStateFromSnapshot(
	snapshot AccountBalanceSnapshot,
	providerHoldings []AssetDailyHolding,
) (*SnapshotProviderState, error) {
	holdingsJSON, err := MarshalBalanceReviewProviderHoldings(providerHoldings)
	if err != nil {
		return nil, fmt.Errorf("marshal provider holdings: %w", err)
	}
	return &SnapshotProviderState{
		ProviderBalanceUSD:   snapshot.BalanceUSD,
		ProviderHoldingsJSON: *holdingsJSON,
	}, nil
}

func carriedSnapshot(
	snapshot AccountBalanceSnapshot,
	prior LastUnflaggedSnapshotResult,
	flagReason string,
) AccountBalanceSnapshot {
	snapshot.BalanceUSD = prior.AmountUSD
	snapshot.Holdings = prior.Holdings
	snapshot.Flagged = true
	snapshot.FlagReason = flagReason
	return snapshot
}

func emitCarried(
	snapshot AccountBalanceSnapshot,
	prior LastUnflaggedSnapshotResult,
	decision SnapshotDecision,
	providerState *SnapshotProviderState,
	review *BalanceReviewUpsert,
	events chan<- PersistEvent,
) {
	draft := SnapshotDraft{
		AccountBalanceSnapshot: snapshot,
		Decision:               decision,
		Anchor:                 AnchorFromSnapshot(prior),
		Review:                 review,
		ProviderState:          providerState,
		CarryUSD:               prior.AmountUSD,
	}
	events <- PersistEvent{Snapshot: &draft}
}

// EmitClean emits a snapshot that passed all sanity checks. The anchor rides
// along so the persister can unflag any recovered flagged history.
func EmitClean(
	snapshot AccountBalanceSnapshot,
	anchor LastUnflaggedBalanceResult,
	events chan<- PersistEvent,
) {
	draft := SnapshotDraft{
		AccountBalanceSnapshot: snapshot,
		Decision:               DecisionClean,
		Anchor:                 anchor,
	}
	events <- PersistEvent{Snapshot: &draft}
}

// EmitApprovedCarryForward emits a flagged snapshot that carries the anchor
// balance forward because the user already approved this provider balance.
func EmitApprovedCarryForward(
	snapshot AccountBalanceSnapshot,
	prior LastUnflaggedSnapshotResult,
	flagReason string,
	events chan<- PersistEvent,
) {
	snapshot = carriedSnapshot(snapshot, prior, flagReason)
	emitCarried(snapshot, prior, DecisionApprovedCarryForward, nil, nil, events)
}

// EmitFlagged emits an anomalous snapshot: the anchor balance is carried
// forward and reviewHoldings are recorded on the balance review so the
// provider-reported state can be restored if the user approves it.
func (a BaseAdapter) EmitFlagged(
	snapshot AccountBalanceSnapshot,
	prior LastUnflaggedSnapshotResult,
	flagReason string,
	reviewHoldings []AssetDailyHolding,
	events chan<- PersistEvent,
) error {
	providerState, err := ProviderStateFromSnapshot(snapshot, reviewHoldings)
	if err != nil {
		return err
	}
	review := BalanceReviewUpsert{
		AccountID:              snapshot.AccountID,
		FirstFlaggedDate:       snapshot.Date,
		LatestFlaggedDate:      snapshot.Date,
		FlaggedSnapshotCount:   1,
		ProviderBalanceUSD:     snapshot.BalanceUSD,
		CarryForwardBalanceUSD: prior.AmountUSD,
		FlagReason:             flagReason,
	}
	a.Log.Error(
		"snapshot flagged, carrying forward prior balance",
		"source", snapshot.Source,
		"account_id", snapshot.AccountID,
		"new_usd", snapshot.BalanceUSD,
		"carry_usd", prior.AmountUSD,
		"reason", flagReason,
	)
	snapshot = carriedSnapshot(snapshot, prior, flagReason)
	emitCarried(snapshot, prior, DecisionFlagged, providerState, &review, events)
	return nil
}

// ProviderBalanceWithinTolerance reports whether a freshly fetched balance is
// close enough to the balance a user already approved that we can auto-carry
// forward instead of re-flagging.
func ProviderBalanceWithinTolerance(providerBalance, approvedProviderBalance float64) bool {
	if approvedProviderBalance == 0 {
		return math.Abs(providerBalance) <= 0.01
	}
	const tolerance = 0.05
	ratio := math.Abs(providerBalance-approvedProviderBalance) /
		math.Abs(approvedProviderBalance)
	return ratio <= tolerance
}
