package portfolio

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	u "tallyo/internal/utils"

	"github.com/samber/lo"
)

type AnalysisService struct {
	Reports  AnalysisReportReader
	Holdings AnalysisHoldingsReader
}

type weightedComponent struct {
	label    string
	fraction float64
}

type assetContribution struct {
	asset    *model.Asset
	valueUSD float64
}

type sliceAccumulator struct {
	label     string
	valueUSD  float64
	byAssetID map[int64]*assetContribution
}

func (s *AnalysisService) Analyze(ctx context.Context, view model.AnalysisView, filter HoldingsFilter) (*model.AnalysisReport, error) {
	holdings, err := s.Holdings.CurrentPublicHoldings(ctx, filter)
	if err != nil {
		return nil, fmt.Errorf("current public holdings: %w", err)
	}
	reports, err := s.Reports.ReportsByAssetIDs(ctx, distinctAssetIDs(holdings))
	if err != nil {
		return nil, fmt.Errorf("analysis reports: %w", err)
	}

	total := totalValue(holdings)
	acc := map[string]*sliceAccumulator{}
	for _, holding := range holdings {
		report, ok := reports[holding.AssetID]
		if !ok {
			addContribution(acc, UnclassifiedLabel, holding, holding.ValueUSD.Dollars())
			continue
		}
		switch view {
		case model.AnalysisViewComposition:
			addWeightedContributions(acc, holding, compositionComponents(report))
		case model.AnalysisViewMorningstarCategory:
			addContribution(acc, categoryLabel(report), holding, holding.ValueUSD.Dollars())
		case model.AnalysisViewMorningstarGroup:
			addContribution(acc, fallbackLabel(report.Group), holding, holding.ValueUSD.Dollars())
		case model.AnalysisViewSectors:
			if report.EquitySector != nil && strings.TrimSpace(*report.EquitySector) != "" {
				addContribution(acc, strings.TrimSpace(*report.EquitySector), holding, holding.ValueUSD.Dollars())
			} else {
				addWeightedContributions(acc, holding, sectorComponents(report))
			}
		default:
			return nil, fmt.Errorf("unsupported analysis view %q", view)
		}
	}

	return &model.AnalysisReport{View: view, TotalValueUsd: money.FromDollars(total), Slices: finalizeSlices(acc, total)}, nil
}

func distinctAssetIDs(holdings []AnalysisHolding) []int64 {
	assetID := func(holding AnalysisHolding) int64 { return holding.AssetID }
	return lo.Uniq(u.Map(holdings, assetID))
}

func totalValue(holdings []AnalysisHolding) float64 {
	holdingDollars := func(holding AnalysisHolding) float64 { return holding.ValueUSD.Dollars() }
	return lo.SumBy(holdings, holdingDollars)
}

func addWeightedContributions(acc map[string]*sliceAccumulator, holding AnalysisHolding, components []weightedComponent) {
	var contributed float64
	for _, component := range components {
		if component.fraction <= 0 || component.label == "" {
			continue
		}
		value := holding.ValueUSD.Dollars() * component.fraction
		if math.Abs(value) < 0.0000001 {
			continue
		}
		contributed += value
		addContribution(acc, component.label, holding, value)
	}
	if math.Abs(contributed) < 0.0000001 && holding.ValueUSD != 0 {
		addContribution(acc, UnassignedLabel, holding, holding.ValueUSD.Dollars())
	}
}

func addContribution(acc map[string]*sliceAccumulator, label string, holding AnalysisHolding, valueUSD float64) {
	if math.Abs(valueUSD) < 0.0000001 {
		return
	}
	slice := acc[label]
	if slice == nil {
		slice = &sliceAccumulator{label: label, byAssetID: map[int64]*assetContribution{}}
		acc[label] = slice
	}
	slice.valueUSD += valueUSD
	contribution := slice.byAssetID[holding.AssetID]
	if contribution == nil {
		contribution = &assetContribution{asset: holding.Asset}
		slice.byAssetID[holding.AssetID] = contribution
	}
	contribution.valueUSD += valueUSD
}

func finalizeSlices(acc map[string]*sliceAccumulator, total float64) []*model.AnalysisSlice {
	slices := make([]*model.AnalysisSlice, 0, len(acc))
	for _, slice := range acc {
		if math.Abs(slice.valueUSD) < 0.0000001 {
			continue
		}
		slices = append(slices, &model.AnalysisSlice{
			Label:    slice.label,
			ValueUsd: money.FromDollars(slice.valueUSD),
			Percent:  percent(slice.valueUSD, total),
			Holdings: finalizeHoldings(slice),
		})
	}
	sort.SliceStable(slices, func(i, j int) bool {
		if slices[i].Label == UnclassifiedLabel {
			return false
		}
		if slices[j].Label == UnclassifiedLabel {
			return true
		}
		if slices[i].Label == UnassignedLabel {
			return false
		}
		if slices[j].Label == UnassignedLabel {
			return true
		}
		return slices[i].ValueUsd > slices[j].ValueUsd
	})
	return slices
}

func finalizeHoldings(slice *sliceAccumulator) []*model.AnalysisHolding {
	assetIDs := lo.Keys(slice.byAssetID)
	sort.SliceStable(assetIDs, func(i, j int) bool {
		a, b := slice.byAssetID[assetIDs[i]], slice.byAssetID[assetIDs[j]]
		return lo.Ternary(a.valueUSD != b.valueUSD, a.valueUSD > b.valueUSD, assetIDs[i] < assetIDs[j])
	})
	toHolding := func(assetID int64) *model.AnalysisHolding {
		contribution := slice.byAssetID[assetID]
		return &model.AnalysisHolding{
			Asset:    contribution.asset,
			ValueUsd: money.FromDollars(contribution.valueUSD),
			Percent:  percent(contribution.valueUSD, slice.valueUSD),
		}
	}
	return u.Map(assetIDs, toHolding)
}

func percent(value, total float64) float64 {
	return lo.Ternary(math.Abs(total) < 0.0000001, 0, value/total*100)
}

// fallbackLabel returns UnassignedLabel for holdings that have a report but no
// grouping data for the current view. The no-report case uses UnclassifiedLabel directly.
func fallbackLabel(label string) string {
	label = strings.TrimSpace(label)
	return lo.Ternary(label == "", UnassignedLabel, label)
}

func categoryLabel(report AssetReport) string {
	category := strings.TrimSpace(report.Category)
	if category == "" {
		return UnassignedLabel
	}
	group := strings.TrimSpace(report.Group)
	return lo.Ternary(group == "", category, group+": "+category)
}

func compositionComponents(report AssetReport) []weightedComponent {
	return []weightedComponent{
		{label: "Cash", fraction: report.CashPosition},
		{label: "Stock", fraction: report.StockPosition},
		{label: "Bond", fraction: report.BondPosition},
		{label: "Preferred", fraction: report.PreferredPosition},
		{label: "Convertible", fraction: report.ConvertiblePosition},
		{label: "Other", fraction: report.OtherPosition},
	}
}

func sectorComponents(report AssetReport) []weightedComponent {
	return []weightedComponent{
		{label: "Real Estate", fraction: report.SectorRealEstate},
		{label: "Consumer Cyclical", fraction: report.SectorConsumerCyclical},
		{label: "Basic Materials", fraction: report.SectorBasicMaterials},
		{label: "Consumer Defensive", fraction: report.SectorConsumerDefensive},
		{label: "Technology", fraction: report.SectorTechnology},
		{label: "Communication Services", fraction: report.SectorCommunicationServices},
		{label: "Financial Services", fraction: report.SectorFinancialServices},
		{label: "Utilities", fraction: report.SectorUtilities},
		{label: "Industrials", fraction: report.SectorIndustrials},
		{label: "Energy", fraction: report.SectorEnergy},
		{label: "Healthcare", fraction: report.SectorHealthcare},
	}
}
