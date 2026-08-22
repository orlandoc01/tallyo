package mcpserver

import (
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	u "tallyo/internal/utils"
)

type leanAnalysisHolding struct {
	Asset    leanAsset   `json:"asset"`
	ValueUsd money.Cents `json:"valueUSD"`
	Percent  float64     `json:"percent"`
}

type leanAnalysisSlice struct {
	Label    string                `json:"label"`
	ValueUsd money.Cents           `json:"valueUSD"`
	Percent  float64               `json:"percent"`
	Holdings []leanAnalysisHolding `json:"holdings"`
}

type leanAnalysisReport struct {
	View          model.AnalysisView  `json:"view"`
	TotalValueUsd money.Cents         `json:"totalValueUSD"`
	Slices        []leanAnalysisSlice `json:"slices"`
}

func mapAnalysisReport(report *model.AnalysisReport) *leanAnalysisReport {
	toHolding := func(h *model.AnalysisHolding) leanAnalysisHolding {
		return leanAnalysisHolding{Asset: mapAsset(h.Asset), ValueUsd: h.ValueUsd, Percent: h.Percent}
	}
	toSlice := func(s *model.AnalysisSlice) leanAnalysisSlice {
		return leanAnalysisSlice{Label: s.Label, ValueUsd: s.ValueUsd, Percent: s.Percent, Holdings: u.Map(s.Holdings, toHolding)}
	}
	return &leanAnalysisReport{View: report.View, TotalValueUsd: report.TotalValueUsd, Slices: u.Map(report.Slices, toSlice)}
}
