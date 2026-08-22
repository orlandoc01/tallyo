package mcpserver

import (
	"context"

	"tallyo/internal/auth"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	u "tallyo/internal/utils"
)

type leanHolding struct {
	AssetID   string      `json:"assetId"`
	AccountID string      `json:"accountId"`
	Quantity  *float64    `json:"quantity"`
	ValueUsd  money.Cents `json:"valueUSD"`
	Manual    bool        `json:"manual"`
}

func mapHolding(h *model.Holding) leanHolding {
	return leanHolding{
		AssetID:   h.AssetID.EncodedString(),
		AccountID: h.AccountID.EncodedString(),
		Quantity:  h.Quantity,
		ValueUsd:  h.ValueUsd,
		Manual:    h.Manual,
	}
}

type leanHoldingRollup struct {
	Asset               leanAsset   `json:"asset"`
	TotalQuantity       *float64    `json:"totalQuantity"`
	ValueUsd            money.Cents `json:"valueUSD"`
	PercentOfClassifier float64     `json:"percentOfClassifier"`
	// Omitted (not empty) without read:holdings — an empty list would read as
	// "held in zero accounts", which is not what a forbidden field means.
	Holdings []leanHolding `json:"holdings,omitempty"`
}

func mapHoldingRollups(ctx context.Context, rollups []*model.HoldingRollup) []leanHoldingRollup {
	includeHoldings := auth.HasScope(ctx, auth.ScopeReadHoldings)
	toHoldingRollup := func(r *model.HoldingRollup) leanHoldingRollup {
		rollup := leanHoldingRollup{
			Asset:               mapAsset(r.Asset),
			TotalQuantity:       r.TotalQuantity,
			ValueUsd:            r.ValueUsd,
			PercentOfClassifier: r.PercentOfClassifier,
		}
		if includeHoldings {
			rollup.Holdings = u.Map(r.Holdings, mapHolding)
		}
		return rollup
	}
	return u.Map(rollups, toHoldingRollup)
}

type leanClassifierBreakdown struct {
	Classifier      model.AssetClassifier `json:"classifier"`
	Label           string                `json:"label"`
	ValueUsd        money.Cents           `json:"valueUSD"`
	PercentOfAssets float64               `json:"percentOfAssets"`
	AssetCount      int32                 `json:"assetCount"`
	Holdings        []leanHoldingRollup   `json:"holdings"`
}

type leanLiabilityBreakdown struct {
	Category             model.LiabilityCategory `json:"category"`
	Label                string                  `json:"label"`
	ValueUsd             money.Cents             `json:"valueUSD"`
	PercentOfLiabilities float64                 `json:"percentOfLiabilities"`
	AccountCount         int32                   `json:"accountCount"`
	Accounts             []leanAccount           `json:"accounts"`
}

type leanNetWorthReport struct {
	AsOfDate              *model.Date               `json:"asOfDate,omitempty"`
	CurrentNetWorthUsd    money.Cents               `json:"currentNetWorthUSD"`
	CurrentAssetsUsd      money.Cents               `json:"currentAssetsUSD"`
	CurrentLiabilitiesUsd money.Cents               `json:"currentLiabilitiesUSD"`
	ClassifierBreakdown   []leanClassifierBreakdown `json:"classifierBreakdown"`
	LiabilityBreakdown    []leanLiabilityBreakdown  `json:"liabilityBreakdown"`
}

func mapNetWorthReport(ctx context.Context, report *model.NetWorthReport) *leanNetWorthReport {
	toClassifier := func(c *model.ClassifierBreakdown) leanClassifierBreakdown {
		return leanClassifierBreakdown{
			Classifier:      c.Classifier,
			Label:           c.Label,
			ValueUsd:        c.ValueUsd,
			PercentOfAssets: c.PercentOfAssets,
			AssetCount:      c.AssetCount,
			Holdings:        mapHoldingRollups(ctx, c.Holdings),
		}
	}
	toLiability := func(l *model.LiabilityBreakdown) leanLiabilityBreakdown {
		return leanLiabilityBreakdown{
			Category:             l.Category,
			Label:                l.Label,
			ValueUsd:             l.ValueUsd,
			PercentOfLiabilities: l.PercentOfLiabilities,
			AccountCount:         l.AccountCount,
			Accounts:             mapAccounts(l.Accounts),
		}
	}
	return &leanNetWorthReport{
		AsOfDate:              report.AsOfDate,
		CurrentNetWorthUsd:    report.CurrentNetWorthUsd,
		CurrentAssetsUsd:      report.CurrentAssetsUsd,
		CurrentLiabilitiesUsd: report.CurrentLiabilitiesUsd,
		ClassifierBreakdown:   u.Map(report.ClassifierBreakdown, toClassifier),
		LiabilityBreakdown:    u.Map(report.LiabilityBreakdown, toLiability),
	}
}
