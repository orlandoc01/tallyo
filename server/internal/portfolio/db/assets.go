package portfoliodb

import (
	"context"
	"time"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
	"tallyo/internal/portfolio"
)

func (s *Store) PublicAssetsNeedingReport(ctx context.Context, olderThan time.Time) ([]portfolio.AssetStub, error) {
	rows, err := s.q.PublicAssetsForAnalysisReport(ctx, dbgen.PublicAssetsForAnalysisReportParams{OlderThan: olderThan.UTC()})
	fromRow := func(row dbgen.PublicAssetsForAnalysisReportRow) portfolio.AssetStub {
		return portfolio.AssetStub{ID: row.ID, Identifier: row.Identifier, TrackingTicker: row.TrackingTicker, InvestmentConnectivity: model.ConnectivityStatus(row.InvestmentConnectivity)}
	}
	return dbutil.MapRows(rows, err, fromRow)
}

func (s *Store) UpdateAssetInvestmentConnectivity(ctx context.Context, assetID int64, status model.ConnectivityStatus) error {
	investmentConnectivity := string(status)
	return s.q.UpdateAssetConnectivity(ctx, dbgen.UpdateAssetConnectivityParams{InvestmentConnectivity: &investmentConnectivity, ID: assetID})
}
