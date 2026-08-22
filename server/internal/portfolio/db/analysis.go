package portfoliodb

import (
	"context"

	"github.com/samber/lo"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
	"tallyo/internal/portfolio"
)

func (s *Store) CurrentPublicHoldings(ctx context.Context, filter portfolio.HoldingsFilter) ([]portfolio.AnalysisHolding, error) {
	classifier := string(model.AssetClassifierPublic)
	params := dbgen.ListCurrentAccountHoldingsParams{
		OwnerIds:        filter.OwnerIDs,
		AccountSubtypes: lo.ToSlicePtr(filter.AccountSubtypes),
		AccountIds:      filter.AccountIDs,
		Classifier:      &classifier,
		ClassifiedOnly:  !filter.IncludeUnclassified,
	}
	rows, err := s.q.ListCurrentAccountHoldings(ctx, params)
	return dbutil.MapRows(rows, err, analysisHoldingFromRow)
}

func analysisHoldingFromRow(row dbgen.ListCurrentAccountHoldingsRow) portfolio.AnalysisHolding {
	asset := &model.Asset{
		ID:                     model.New(model.GlobalIDAsset, row.Asset.ID),
		AssetType:              model.AssetType(row.Asset.AssetType),
		Identifier:             row.Asset.Identifier,
		Name:                   row.Asset.Name,
		Classifier:             model.AssetClassifier(row.Asset.Classifier),
		CurrentPrice:           row.Asset.LastPrice,
		CurrentPriceAt:         row.Asset.LastPriceAt,
		ForcedUsdPrice:         row.Asset.ForcedUsdPrice,
		TrackingTicker:         row.Asset.TrackingTicker,
		TrackingMultiplier:     row.Asset.TrackingMultiplier,
		PriceConnectivity:      model.ConnectivityStatus(row.Asset.PriceConnectivity),
		InvestmentConnectivity: model.ConnectivityStatus(row.Asset.InvestmentConnectivity),
	}
	return portfolio.AnalysisHolding{AssetID: row.Asset.ID, Asset: asset, ValueUSD: row.ValueUsdCents}
}
