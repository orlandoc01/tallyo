package plaid

import (
	"context"
	"fmt"
	"math"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/wealth"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
)

const emptyInvestmentHoldingsFlagReason = "Plaid returned zero holdings; carried forward the latest unflagged holdings with refreshed pricing"

type recalibrationEntry struct {
	asset            *model.Asset
	institutionPrice float64
	// sourceID is the Plaid security ID. Recalibration updates are keyed by
	// adapter source, not identifier, because a user can edit an asset's
	// identifier independently of the provider's own security ID.
	sourceID string
}

func (a *Adapter) investmentHoldingPrice(
	ctx context.Context,
	asset *model.Asset,
	holding plaidapi.Holding,
	security plaidapi.Security,
	date string,
) (*float64, bool, error) {
	if asset.ForcedUsdPrice != nil {
		return cloneFloat(asset.ForcedUsdPrice), false, nil
	}
	institutionPrice := holding.GetInstitutionPrice()
	if institutionPrice > 0 {
		return &institutionPrice, true, nil
	}
	price, err := a.holdingPriceFallback(ctx, asset, security, date)
	return price, false, err
}

func (a *Adapter) postSnapshotRecalibration(ctx context.Context, entries []recalibrationEntry, date string) map[string]wealth.AssetUpdate {
	updates := map[string]wealth.AssetUpdate{}
	if len(entries) == 0 {
		return updates
	}
	priceAt, err := time.ParseInLocation("2006-01-02", date, time.UTC)
	if err != nil {
		a.Log.Warn("parse recalibration date failed", "date", date, "error", err)
		return updates
	}
	for _, entry := range entries {
		if entry.asset == nil || entry.institutionPrice <= 0 {
			continue
		}
		assetUpdate := wealth.AssetUpdate{AssetID: entry.asset.ID.Int64(), Price: entry.institutionPrice, PriceAt: priceAt}
		if entry.asset.TrackingTicker == nil {
			updates[entry.sourceID] = assetUpdate
			continue
		}
		rawAsset := *entry.asset
		rawAsset.ID = model.GlobalID{}
		rawAsset.TrackingMultiplier = 1
		rawAsset.CurrentPrice = nil
		rawPrice, err := a.prices.PriceAt(ctx, &rawAsset, priceAt)
		if err != nil || rawPrice <= 0 {
			updates[entry.sourceID] = assetUpdate
			continue
		}
		trackingMultiplier := entry.institutionPrice / rawPrice
		if math.Abs(trackingMultiplier-1) < 0.001 {
			trackingMultiplier = 1
		}
		assetUpdate.TrackingMultiplier = &trackingMultiplier
		updates[entry.sourceID] = assetUpdate
	}
	return updates
}

func (a *Adapter) handleEmptyInvestmentHoldings(
	ctx context.Context,
	accountID int64,
	plaidBalance *float64,
	today, syncedAt string,
	rawPayload *string,
	events chan<- wealth.PersistEvent,
) (bool, error) {
	if plaidBalance != nil && *plaidBalance == 0 {
		draft := wealth.SnapshotDraft{
			AccountID:  accountID,
			Source:     a.Source().Str(),
			Date:       today,
			SyncedAt:   syncedAt,
			BalanceUSD: 0,
			RawPayload: rawPayload, Decision: wealth.DecisionClean}
		events <- wealth.PersistEvent{Snapshot: &draft}
		return true, nil
	}

	approved, err := a.ApprovedReviewMatches(ctx, accountID, 0)
	if err != nil {
		return false, err
	}
	return a.carryForwardEmptyInvestmentHoldings(
		ctx,
		accountID,
		today,
		syncedAt,
		rawPayload,
		emptyInvestmentHoldingsFlagReason,
		!approved,
		events,
	)
}

func (a *Adapter) carryForwardEmptyInvestmentHoldings(
	ctx context.Context,
	accountID int64,
	today string,
	syncedAt string,
	rawPayload *string,
	flagReason string,
	upsertReview bool,
	events chan<- wealth.PersistEvent,
) (bool, error) {
	prior, err := a.Reads.LatestUnflaggedSnapshotWithHoldings(ctx, accountID, today)
	if err != nil {
		return false, fmt.Errorf("load prior snapshot holdings: %w", err)
	}
	if !prior.Found {
		return false, nil
	}
	holdings, repricedUSD := a.repricePriorInvestmentHoldings(ctx, prior.Holdings, today)
	balanceUSD := money.FromDollars(repricedUSD)
	draft := wealth.SnapshotDraft{
		AccountID:  accountID,
		Source:     a.Source().Str(),
		Date:       today,
		SyncedAt:   syncedAt,
		BalanceUSD: balanceUSD,
		RawPayload: rawPayload,
		Holdings:   holdings,
		Flagged:    true,
		FlagReason: flagReason, Decision: wealth.DecisionApprovedCarryForward, CarryUSD: balanceUSD}
	if upsertReview {
		draft.Decision = wealth.DecisionFlagged
		draft.ProviderState = &wealth.SnapshotProviderState{
			ProviderBalanceUSD:   0,
			ProviderHoldingsJSON: "[]",
		}
		draft.Review = &wealth.BalanceReviewUpsert{
			AccountID:              accountID,
			FirstFlaggedDate:       today,
			LatestFlaggedDate:      today,
			FlaggedSnapshotCount:   1,
			ProviderBalanceUSD:     0,
			CarryForwardBalanceUSD: balanceUSD,
			FlagReason:             emptyInvestmentHoldingsFlagReason,
		}
	}
	events <- wealth.PersistEvent{Snapshot: &draft}
	return true, nil
}

func (a *Adapter) repricePriorInvestmentHoldings(
	ctx context.Context,
	prior []wealth.AssetDailyHolding,
	date string,
) ([]wealth.AssetDailyHolding, float64) {
	parsedDate, err := time.ParseInLocation("2006-01-02", date, time.UTC)
	if err != nil {
		parsedDate = time.Now().UTC()
	}
	holdings := make([]wealth.AssetDailyHolding, 0, len(prior))
	total := 0.0
	for _, holding := range prior {
		repriced := holding
		price := a.repricedHoldingPrice(ctx, holding, parsedDate)
		repriced.Price = cloneFloat(price)
		value := holding.ValueUSD
		if repriced.Quantity != nil && price != nil {
			value = *repriced.Quantity * *price
		}
		repriced.ValueUSD = value
		total += value
		holdings = append(holdings, repriced)
	}
	return holdings, total
}

func (a *Adapter) repricedHoldingPrice(ctx context.Context, holding wealth.AssetDailyHolding, date time.Time) *float64 {
	asset, err := a.Reads.AssetByID(ctx, holding.AssetID)
	if err == nil && asset != nil {
		price, err := a.prices.PriceAt(ctx, asset, date)
		if err == nil && price > 0 {
			return &price
		}
		if asset.CurrentPrice != nil && *asset.CurrentPrice > 0 {
			return cloneFloat(asset.CurrentPrice)
		}
	}
	if holding.Price != nil && *holding.Price > 0 {
		return cloneFloat(holding.Price)
	}
	return nil
}

func investmentAccountBalances(plaidAccounts []plaidapi.AccountBase) map[string]*float64 {
	accountBalances := map[string]*float64{}
	for _, account := range plaidAccounts {
		if account.GetType() != plaidapi.ACCOUNTTYPE_INVESTMENT {
			continue
		}
		plaidBalances := account.GetBalances()
		if current, ok := plaidBalances.GetCurrentOk(); ok && current != nil {
			accountBalances[account.GetAccountId()] = cloneFloat(current)
		}
	}
	return accountBalances
}
