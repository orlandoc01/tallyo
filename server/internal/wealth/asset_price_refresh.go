package wealth

import (
	"context"
	"fmt"
	"time"

	"tallyo/internal/graph/model"
)

func (s *Service) refreshChangedAssetMarketPrice(
	ctx context.Context,
	input model.UpdateAssetInput,
	asset *model.Asset,
) (*model.Asset, error) {
	newIdentifier := asset.Identifier
	if input.Identifier != nil {
		newIdentifier = *input.Identifier
	}
	tempAsset := &model.Asset{
		ID:                 asset.ID,
		AssetType:          asset.AssetType,
		Identifier:         newIdentifier,
		TrackingTicker:     asset.TrackingTicker,
		TrackingMultiplier: asset.TrackingMultiplier,
	}
	price, err := s.PriceProvider.PriceAt(ctx, tempAsset, time.Now())
	switch {
	case err != nil:
		s.Log.Warn(
			"update asset: price fetch failed",
			"asset_id", asset.ID,
			"identifier", newIdentifier,
			"error", err,
		)
	case price <= 0:
		s.Log.Warn(
			"update asset: skipping non-positive price",
			"asset_id", asset.ID,
			"identifier", newIdentifier,
			"price", price,
		)
	default:
		now := time.Now()
		if writeErr := s.Store.UpdateAssetPrice(ctx, asset.ID.Int64(), price, now); writeErr != nil {
			s.Log.Warn(
				"update asset: write price failed",
				"asset_id", asset.ID.Int64(),
				"error", writeErr,
			)
		} else {
			asset.CurrentPrice = &price
			asset.CurrentPriceAt = &now

			if revalErr := s.Store.RevalueLatestAssetHoldings(ctx, asset.ID.Int64(), price); revalErr != nil {
				s.Log.Warn(
					"update asset: revalue holdings failed",
					"asset_id", asset.ID.Int64(),
					"error", revalErr,
				)
			}
		}
	}

	updated, err := s.Store.AssetByID(ctx, asset.ID.Int64())
	if err != nil {
		return nil, fmt.Errorf("re-read asset after update: %w", err)
	}
	if updated != nil {
		return updated, nil
	}
	return asset, nil
}
