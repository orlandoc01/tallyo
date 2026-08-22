package portfolio

import (
	"time"

	"tallyo/internal/clients/yfinance"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
)

const UnclassifiedLabel = "Unclassified"
const UnassignedLabel = "Unassigned"

type AssetStub struct {
	ID                     int64
	Identifier             string
	TrackingTicker         *string
	InvestmentConnectivity model.ConnectivityStatus
}

type AssetReport struct {
	AssetID int64
	yfinance.FundReport
	EquitySector *string
	FetchedAt    time.Time
}

type HoldingsFilter struct {
	OwnerIDs            []int64
	AccountSubtypes     []string
	AccountIDs          []int64
	IncludeUnclassified bool
}

type AnalysisHolding struct {
	AssetID  int64
	Asset    *model.Asset
	ValueUSD money.Cents
}
