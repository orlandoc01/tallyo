package debank

import (
	"context"
	"fmt"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/wealth"

	"github.com/samber/lo"
)

type walletSnapshotEvaluation struct {
	accountID     int64
	snapshot      wealth.AccountBalanceSnapshot
	prior         wealth.LastUnflaggedSnapshotResult
	anomalyReason string
	syncedAt      time.Time
}

func (s *Adapter) evaluateWalletSnapshot(
	ctx context.Context,
	wallet accounts.EVMWallet,
	accountID int64,
	today string,
) (walletSnapshotEvaluation, error) {
	tokens, err := s.walletTokens(ctx, wallet)
	if err != nil {
		return walletSnapshotEvaluation{}, err
	}
	projects, projectRaw, err := s.client.ProjectList(ctx, wallet.Address)
	if err != nil {
		return walletSnapshotEvaluation{}, fmt.Errorf("fetch project list for %s: %w", wallet.Address, err)
	}

	syncedAt := s.now()
	date := today
	if date == "" {
		date = wealth.UTCDate(syncedAt)
	}
	snapshot, err := buildSnapshotWithKnown(
		accountID,
		wallet.Address,
		date,
		syncedAt,
		tokens,
		projects,
		projectRaw,
		wallet.ChainIDs,
		func(identifier string) (bool, error) { return s.debankAssetKnown(ctx, identifier) },
		s.Log,
	)
	if err != nil {
		return walletSnapshotEvaluation{}, err
	}
	s.enrichProjectHoldings(ctx, snapshot.Holdings)
	eval := walletSnapshotEvaluation{
		accountID: accountID,
		snapshot:  snapshot,
		syncedAt:  syncedAt,
	}

	prior, err := s.Reads.LatestUnflaggedSnapshotWithHoldings(
		ctx,
		accountID,
		snapshot.Date,
	)
	if err != nil {
		return walletSnapshotEvaluation{}, fmt.Errorf("load prior unflagged snapshot: %w", err)
	}
	eval.prior = prior
	if !prior.Found {
		return eval, nil
	}

	if reason := wealth.HoldingPriceDeviates(
		prior.Holdings,
		snapshot.Holdings,
		wealth.HoldingPriceDeviationRatio,
	); reason != "" {
		eval.anomalyReason = reason
		return eval, nil
	}
	return eval, nil
}

func (s *Adapter) emitWalletSnapshot(
	eval walletSnapshotEvaluation,
	events chan<- wealth.PersistEvent,
) {
	snapshot := eval.snapshot
	snapshot.Holdings = s.persistableHoldings(snapshot.Holdings, eval.syncedAt)
	wealth.EmitClean(snapshot, wealth.AnchorFromSnapshot(eval.prior), events)

	s.Log.Info(
		"evmchain: wallet synced",
		"address", snapshot.WalletAddress,
		"holdings", len(snapshot.Holdings),
		"value_usd", snapshot.BalanceUSD,
	)
}

func (s *Adapter) persistableHoldings(
	holdings []wealth.AssetDailyHolding,
	syncedAt time.Time,
) []wealth.AssetDailyHolding {
	for i := range holdings {
		asset := s.assetUpsertForHolding(holdings[i], syncedAt)
		holdings[i].Asset = &asset
		holdings[i].Price = priceForPersistedHolding(holdings[i])
	}
	return holdings
}

func priceForPersistedHolding(holding wealth.AssetDailyHolding) *float64 {
	return lo.Ternary(holding.ProviderPrice != nil && *holding.ProviderPrice > 0, holding.ProviderPrice, priceFromHolding(holding))
}

func (s *Adapter) emitFlaggedSnapshot(
	eval walletSnapshotEvaluation,
	events chan<- wealth.PersistEvent,
) error {
	providerHoldings := s.persistableProviderHoldings(eval.snapshot.Holdings, eval.syncedAt)
	return s.EmitFlagged(eval.snapshot, eval.prior, eval.anomalyReason, providerHoldings, events)
}

func (s *Adapter) persistableProviderHoldings(
	holdings []wealth.AssetDailyHolding,
	syncedAt time.Time,
) []wealth.AssetDailyHolding {
	providerHoldings := append([]wealth.AssetDailyHolding{}, holdings...)
	return s.persistableHoldings(providerHoldings, syncedAt)
}
