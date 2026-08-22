package wealth

import (
	"cmp"
	"context"
	"slices"

	"tallyo/internal/graph/model"
)

// currentHoldingToModel is the canonical CurrentHolding -> Holding conversion,
// shared by classifier rollups and Asset.latestSnapshot. Account is already
// joined on CurrentHolding, so this never re-queries it.
func currentHoldingToModel(h CurrentHolding) *model.Holding {
	return &model.Holding{
		AssetID:   h.Asset.ID,
		Asset:     h.Asset,
		AccountID: h.Account.ID,
		Account:   h.Account,
		Quantity:  h.Quantity,
		ValueUsd:  h.ValueUSD,
		Manual:    h.Manual,
	}
}

// sortHoldingsByValueThenAccountID sorts in place by value descending, then
// account ID, for deterministic output.
func sortHoldingsByValueThenAccountID(holdings []*model.Holding) {
	slices.SortFunc(holdings, func(a, b *model.Holding) int {
		if c := cmp.Compare(b.ValueUsd, a.ValueUsd); c != 0 {
			return c
		}
		return cmp.Compare(a.AccountID.Int64(), b.AccountID.Int64())
	})
}

func holdingRollups(holdings []CurrentHolding) []*model.HoldingRollup {
	total := sumValueUSD(holdings)
	byAsset := map[int64]*model.HoldingRollup{}
	for _, holding := range holdings {
		assetID := holding.Asset.ID.Int64()
		rollup := byAsset[assetID]
		if rollup == nil {
			rollup = &model.HoldingRollup{Asset: holding.Asset, TotalQuantity: new(float64)}
			byAsset[assetID] = rollup
		}
		rollup.TotalQuantity = addQuantity(rollup.TotalQuantity, holding.Quantity)
		rollup.ValueUsd += holding.ValueUSD
		rollup.Holdings = append(rollup.Holdings, currentHoldingToModel(holding))
	}
	result := make([]*model.HoldingRollup, 0, len(byAsset))
	for _, rollup := range byAsset {
		if total != 0 {
			rollup.PercentOfClassifier = rollup.ValueUsd.Dollars() / total.Dollars() * 100
		}
		sortHoldingsByValueThenAccountID(rollup.Holdings)
		result = append(result, rollup)
	}
	slices.SortFunc(result, func(a, b *model.HoldingRollup) int {
		if c := cmp.Compare(b.ValueUsd, a.ValueUsd); c != 0 {
			return c
		}
		return cmp.Compare(a.Asset.ID.Int64(), b.Asset.ID.Int64())
	})
	return result
}

// AssetSnapshotsByIDs computes the current-position projection for each asset:
// the same latest-snapshot-per-account semantics as ListCurrentAccountHoldings,
// aggregated to totals plus per-account Holding rows. Assets with no current
// holdings are absent from the result.
func (s *Service) AssetSnapshotsByIDs(ctx context.Context, assetIDs []int64) (map[int64]*model.AssetSnapshot, error) {
	holdings, err := s.Store.CurrentHoldings(ctx, AccountFilter{AssetIDs: assetIDs})
	if err != nil {
		return nil, err
	}
	byAsset := map[int64]*model.AssetSnapshot{}
	for _, holding := range holdings {
		assetID := holding.Asset.ID.Int64()
		snapshot := byAsset[assetID]
		if snapshot == nil {
			snapshot = &model.AssetSnapshot{TotalHeldQuantity: new(float64)}
			byAsset[assetID] = snapshot
		}
		snapshot.TotalHeldQuantity = addQuantity(snapshot.TotalHeldQuantity, holding.Quantity)
		snapshot.TotalHeldValueUsd += holding.ValueUSD
		snapshot.Holdings = append(snapshot.Holdings, currentHoldingToModel(holding))
		if snapshot.AsOfDate == "" || holding.SnapshotDate > snapshot.AsOfDate {
			snapshot.AsOfDate = holding.SnapshotDate
		}
	}
	for _, snapshot := range byAsset {
		sortHoldingsByValueThenAccountID(snapshot.Holdings)
	}
	return byAsset, nil
}

func addQuantity(total, addend *float64) *float64 {
	if total == nil || addend == nil {
		return nil
	}
	sum := *total + *addend
	return &sum
}
