package portfolio

import (
	"context"
	"time"

	"tallyo/internal/graph/model"
)

type ReportStore interface {
	UpsertReport(ctx context.Context, report AssetReport) error
}

type HoldingsProvider interface {
	PublicAssetsNeedingReport(ctx context.Context, olderThan time.Time) ([]AssetStub, error)
}

type ConnectivityUpdater interface {
	UpdateAssetInvestmentConnectivity(ctx context.Context, assetID int64, status model.ConnectivityStatus) error
}

type AnalysisReportReader interface {
	ReportsByAssetIDs(ctx context.Context, assetIDs []int64) (map[int64]AssetReport, error)
}

type AnalysisHoldingsReader interface {
	CurrentPublicHoldings(ctx context.Context, filter HoldingsFilter) ([]AnalysisHolding, error)
}
