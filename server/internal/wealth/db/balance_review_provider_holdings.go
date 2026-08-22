package wealthdb

import (
	"context"
	"fmt"
	"strconv"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/money"
	"tallyo/internal/wealth"
)

type providerHoldingsInput struct {
	AccountID  int64
	SnapshotID int64
	Date       string
	Holdings   []wealth.BalanceReviewProviderHolding
}

func insertProviderHoldings(ctx context.Context, q *dbgen.Queries, input providerHoldingsInput) error {
	for _, holding := range input.Holdings {
		assetID, err := providerHoldingAssetID(ctx, q, holding)
		if err != nil {
			return err
		}
		if holding.PriceUpdate != nil {
			update := *holding.PriceUpdate
			update.AssetID = assetID
			if err := applyAssetUpdate(ctx, q, assetID, update); err != nil {
				return fmt.Errorf("apply provider holding price update %s: %w", holding.AssetID, err)
			}
		}
		if err := q.InsertAssetDailyHolding(ctx, dbgen.InsertAssetDailyHoldingParams{
			SnapshotID:        input.SnapshotID,
			AccountID:         input.AccountID,
			Date:              input.Date,
			AssetID:           assetID,
			Quantity:          holding.Quantity,
			Price:             holding.Price,
			ValueUsdCents:     money.FromDollars(holding.ValueUSD),
			CountsTowardValue: holding.CountsTowardValue,
		}); err != nil {
			return fmt.Errorf("insert provider holding %s: %w", holding.AssetID, err)
		}
	}
	return nil
}

func providerHoldingAssetID(
	ctx context.Context,
	q *dbgen.Queries,
	holding wealth.BalanceReviewProviderHolding,
) (int64, error) {
	if holding.Asset != nil {
		asset := *holding.Asset
		if asset.LastPrice == nil {
			asset.LastPrice = holding.Price
		}
		return upsertProviderAsset(ctx, q, asset)
	}
	assetID, err := parseProviderAssetID(holding.AssetID)
	if err != nil {
		return 0, err
	}
	if assetID > 0 {
		return assetID, nil
	}
	return 0, fmt.Errorf("provider holding %q missing asset id and asset description", holding.AssetID)
}

func upsertProviderAsset(ctx context.Context, q *dbgen.Queries, asset wealth.AssetUpsert) (int64, error) {
	upserted, err := upsertAsset(ctx, q, asset)
	if err != nil {
		return 0, fmt.Errorf("upsert provider asset %q: %w", asset.Identifier, err)
	}
	if upserted == nil {
		return 0, fmt.Errorf("upsert provider asset %q returned no row", asset.Identifier)
	}
	return upserted.ID.Int64(), nil
}

func parseProviderAssetID(raw string) (int64, error) {
	if raw == "" {
		return 0, nil
	}
	assetID, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse provider asset id %q: %w", raw, err)
	}
	return assetID, nil
}
