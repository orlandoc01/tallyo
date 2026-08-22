package model

import (
	"time"
)

// Asset carries the shared fields for all asset types plus unexported details
// data that the Asset.details field resolver reads to construct the right
// *AssetDetails variant. The json:"-" fields are visible to Go code but
// omitted from GraphQL responses; they are populated by the database layer.
type Asset struct {
	ID                     GlobalID           `json:"id"`
	AssetType              AssetType          `json:"assetType"`
	Identifier             string             `json:"identifier"`
	Name                   *string            `json:"name,omitempty"`
	Classifier             AssetClassifier    `json:"classifier"`
	CurrentPrice           *float64           `json:"currentPrice,omitempty"`
	CurrentPriceAt         *time.Time         `json:"currentPriceAt,omitempty"`
	ForcedUsdPrice         *float64           `json:"forcedUsdPrice,omitempty"`
	TrackingTicker         *string            `json:"trackingTicker,omitempty"`
	TrackingMultiplier     float64            `json:"trackingMultiplier"`
	PriceConnectivity      ConnectivityStatus `json:"priceConnectivity"`
	InvestmentConnectivity ConnectivityStatus `json:"investmentConnectivity"`

	// Details data — populated by the store but not exposed directly via GraphQL.
	Cusip       *string  `json:"-"`
	Isin        *string  `json:"-"`
	ChainID     *string  `json:"-"`
	TokenSymbol *string  `json:"-"`
	TokenName   *string  `json:"-"`
	ProjectName *string  `json:"-"`
	Address     *Address `json:"-"`
}

func (Asset) IsNode() {}

func (a Asset) GetID() GlobalID { return a.ID }
