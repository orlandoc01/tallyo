package plaid

import (
	"context"
	"fmt"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/wealth"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"github.com/samber/lo"
)

func (a *Adapter) reconcileHoldings(
	ctx context.Context,
	resp plaidapi.InvestmentsHoldingsGetResponse,
	balanceAccounts []plaidapi.AccountBase,
	dbAccounts map[string]resolvedAccount,
	sink wealth.PersistSink,
	events chan<- wealth.PersistEvent,
) error {
	accountTypes, snapshots := investmentSnapshotDrafts(resp.GetAccounts(), dbAccounts)
	accountBalances := investmentAccountBalances(balanceAccounts)
	securities := securitiesByID(resp.GetSecurities())
	recalibrations := map[string][]recalibrationEntry{}
	rawPayload, err := wealth.MarshalRawPayload(resp, "plaid investment payload")
	if err != nil {
		return err
	}

	targetBalances := investmentAccountBalances(resp.GetAccounts())
	for _, holding := range dedupeAggregateHoldings(resp.GetHoldings(), targetBalances) {
		accountID := holding.GetAccountId()
		if accountType, ok := accountTypes[accountID]; ok && accountType != model.AccountTypeInvestment {
			continue
		}
		draft := snapshotDraftForAccount(snapshots, accountID)
		security := securities[holding.GetSecurityId()]
		assetUpsert := assetFromSecurity(security)
		asset, err := a.pricingAssetForHolding(ctx, assetUpsert)
		if err != nil {
			return err
		}
		price, institutionPriceUsed, err := a.investmentHoldingPrice(ctx, asset, holding, security, sink.Today())
		if err != nil {
			return err
		}
		if institutionPriceUsed {
			recalibrations[accountID] = append(recalibrations[accountID], recalibrationEntry{
				asset:            asset,
				institutionPrice: holding.GetInstitutionPrice(),
				sourceID:         holding.GetSecurityId(),
			})
		}
		addInvestmentHolding(draft, &assetUpsert, holding.GetQuantity(), price)
	}

	syncedAt := sink.Now().Format(time.RFC3339)
	for accountID, draft := range snapshots {
		// A holdings-response account can be absent from the resolved balance set.
		localAccountID := dbAccounts[accountID].ID
		if localAccountID == 0 {
			var err error
			if localAccountID, _, err = a.Reads.AccountByExternalID(ctx, accountID); err != nil {
				return fmt.Errorf("lookup account %s: %w", accountID, err)
			}
		}
		if len(draft.Holdings) == 0 {
			if _, err := a.handleEmptyInvestmentHoldings(
				ctx,
				localAccountID,
				accountBalances[accountID],
				sink.Today(),
				syncedAt,
				rawPayload,
				events,
			); err != nil {
				return fmt.Errorf("handle empty investment holdings for %s: %w", accountID, err)
			}
			continue
		}
		updates := a.postSnapshotRecalibration(ctx, recalibrations[accountID], sink.Today())
		for i := range draft.Holdings {
			source := draft.Holdings[i].Asset
			if source == nil || source.AdapterSource == nil {
				continue
			}
			if update, ok := updates[source.AdapterSource.SourceID]; ok {
				draft.Holdings[i].PriceUpdate = &update
			}
		}
		snapshot := wealth.AccountBalanceSnapshot{
			AccountID:  localAccountID,
			Source:     a.Source().Str(),
			Date:       sink.Today(),
			SyncedAt:   syncedAt,
			BalanceUSD: money.FromDollars(draft.Total),
			RawPayload: rawPayload,
			Holdings:   draft.Holdings,
		}
		if err := a.EmitWithPriceCheck(ctx, snapshot, events); err != nil {
			return err
		}
	}
	return nil
}

// pricingAssetForHolding resolves the asset to price a holding against.
// A previously discovered security has a persisted row carrying its stored
// custom tracking ticker, multiplier, forced price, and any user-edited
// identifier — none of which are on the transient provider-derived asset used
// for discovery. Falls back to the transient asset on first discovery, before
// the shared snapshot sink has upserted a persisted row.
func (a *Adapter) pricingAssetForHolding(ctx context.Context, assetUpsert wealth.AssetUpsert) (*model.Asset, error) {
	transient := modelAssetFromSecurity(assetUpsert)
	if assetUpsert.AdapterSource == nil {
		return transient, nil
	}
	persisted, err := a.reads.AssetByAdapterSource(ctx, *assetUpsert.AdapterSource)
	if err != nil {
		return nil, fmt.Errorf("lookup persisted asset for security %s: %w", assetUpsert.AdapterSource.SourceID, err)
	}
	if persisted == nil {
		return transient, nil
	}
	return persisted, nil
}

func investmentSnapshotDrafts(plaidAccounts []plaidapi.AccountBase, dbAccounts map[string]resolvedAccount) (map[string]model.AccountType, map[string]*wealth.InvestmentSnapshotDraft) {
	accountTypes := map[string]model.AccountType{}
	snapshots := map[string]*wealth.InvestmentSnapshotDraft{}
	for _, account := range plaidAccounts {
		accountID := account.GetAccountId()
		accountType := accounts.TypeFromPlaid(string(account.GetType()))
		if resolved, ok := dbAccounts[accountID]; ok {
			accountType = resolved.Type
		}
		accountTypes[accountID] = accountType
		if accountType == model.AccountTypeInvestment {
			snapshots[accountID] = wealth.NewInvestmentSnapshotDraft()
		}
	}
	return accountTypes, snapshots
}

func securitiesByID(securities []plaidapi.Security) map[string]plaidapi.Security {
	toSecurityByID := func(security plaidapi.Security) (string, plaidapi.Security) {
		return security.GetSecurityId(), security
	}
	return lo.SliceToMap(securities, toSecurityByID)
}

func snapshotDraftForAccount(snapshots map[string]*wealth.InvestmentSnapshotDraft, accountID string) *wealth.InvestmentSnapshotDraft {
	if draft, ok := snapshots[accountID]; ok {
		return draft
	}
	draft := wealth.NewInvestmentSnapshotDraft()
	snapshots[accountID] = draft
	return draft
}

func addInvestmentHolding(d *wealth.InvestmentSnapshotDraft, asset *wealth.AssetUpsert, quantity float64, price *float64) {
	value := 0.0
	if price != nil {
		value = quantity * *price
	}
	d.Add(wealth.AssetDailyHolding{
		Asset:             asset,
		Quantity:          new(quantity),
		Price:             cloneFloat(price),
		ValueUSD:          value,
		CountsTowardValue: true,
	})
}

func (a *Adapter) holdingPriceFallback(ctx context.Context, asset *model.Asset, security plaidapi.Security, date string) (*float64, error) {
	plaidPrice, _ := securityPrice(security)
	parsed, err := time.ParseInLocation("2006-01-02", date, time.UTC)
	if err != nil {
		return nil, fmt.Errorf("parse holdings price date: %w", err)
	}
	pricedAsset := *asset
	pricedAsset.CurrentPrice = nil
	price, err := a.prices.PriceAt(ctx, &pricedAsset, parsed)
	if err != nil {
		a.Log.Warn("holding price provider failed", "asset_id", asset.ID, "identifier", asset.Identifier, "error", err)
	}
	return firstPrice(lo.EmptyableToPtr(price), plaidPrice, asset.CurrentPrice), nil
}

func firstPrice(prices ...*float64) *float64 {
	for _, price := range prices {
		if price != nil && *price != 0 {
			return cloneFloat(price)
		}
	}
	return nil
}

func cloneFloat(value *float64) *float64 {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
