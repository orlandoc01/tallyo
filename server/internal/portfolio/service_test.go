package portfolio

import (
	"context"
	"reflect"
	"testing"

	"tallyo/internal/clients/yfinance"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"

	"github.com/samber/lo"
)

func mustAnalyze(t *testing.T, service *AnalysisService, view model.AnalysisView, filter HoldingsFilter) *model.AnalysisReport {
	t.Helper()
	report, err := service.Analyze(context.Background(), view, filter)
	must.NoErr(t, err)
	return report
}

func TestAnalysisServiceComposition(t *testing.T) {
	service := &AnalysisService{
		Reports:  fakeReportReader{reports: map[int64]AssetReport{1: {AssetID: 1, FundReport: yfinance.FundReport{Category: "Large Blend", Group: "US Equity", StockPosition: 0.6, BondPosition: 0.4}}}},
		Holdings: &fakeHoldingsReader{holdings: []AnalysisHolding{holding(1, "VTI", 100), holding(2, "MISSING", 50)}},
	}

	report := mustAnalyze(t, service, model.AnalysisViewComposition, HoldingsFilter{IncludeUnclassified: true})
	if report.TotalValueUsd != 150 {
		t.Fatalf("total = %v, want 150", report.TotalValueUsd)
	}
	got := sliceValues(report.Slices)
	want := map[string]money.Cents{"Stock": 60, UnclassifiedLabel: 50, "Bond": 40}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("slices = %#v, want %#v", got, want)
	}
	if report.Slices[len(report.Slices)-1].Label != UnclassifiedLabel {
		t.Fatalf("unclassified slice should be last: %#v", report.Slices)
	}
}

func TestAnalysisServiceAggregatesDuplicateAssetsAndRoundsOnce(t *testing.T) {
	service := &AnalysisService{
		Reports:  fakeReportReader{reports: map[int64]AssetReport{1: {AssetID: 1, FundReport: yfinance.FundReport{StockPosition: 0.5, BondPosition: 0.5}}}},
		Holdings: &fakeHoldingsReader{holdings: []AnalysisHolding{holding(1, "VTI", 1), holding(1, "VTI", 1)}},
	}

	report := mustAnalyze(t, service, model.AnalysisViewComposition, HoldingsFilter{})
	stock := sliceByLabel(report.Slices, "Stock")
	bond := sliceByLabel(report.Slices, "Bond")
	if report.TotalValueUsd != 2 || stock == nil || bond == nil {
		t.Fatalf("report = %#v, want two one-cent slices from a two-cent portfolio", report)
	}
	if stock.ValueUsd != 1 || len(stock.Holdings) != 1 || stock.Holdings[0].ValueUsd != 1 || stock.Holdings[0].Percent != 100 {
		t.Fatalf("stock slice = %#v, want one folded VTI row rounded once to one cent", stock)
	}
	if bond.ValueUsd != 1 || len(bond.Holdings) != 1 || bond.Holdings[0].ValueUsd != 1 || bond.Holdings[0].Percent != 100 {
		t.Fatalf("bond slice = %#v, want one folded VTI row rounded once to one cent", bond)
	}
}

func sliceByLabel(slices []*model.AnalysisSlice, label string) *model.AnalysisSlice {
	for _, slice := range slices {
		if slice.Label == label {
			return slice
		}
	}
	return nil
}

func TestAnalysisServiceSectorsMixesFundsAndEquities(t *testing.T) {
	sector := "Technology"
	service := &AnalysisService{
		Reports: fakeReportReader{reports: map[int64]AssetReport{
			1: {AssetID: 1, FundReport: yfinance.FundReport{SectorTechnology: 0.7, SectorHealthcare: 0.3}},
			2: {AssetID: 2, FundReport: yfinance.FundReport{Category: "Individual Equity", Group: "Individual Equity", StockPosition: 1}, EquitySector: &sector},
		}},
		Holdings: &fakeHoldingsReader{holdings: []AnalysisHolding{holding(1, "VFFVX", 100), holding(2, "AAPL", 50)}},
	}

	report := mustAnalyze(t, service, model.AnalysisViewSectors, HoldingsFilter{})
	got := sliceValues(report.Slices)
	want := map[string]money.Cents{"Technology": 120, "Healthcare": 30}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("slices = %#v, want %#v", got, want)
	}
	if report.Slices[0].Label != "Technology" || report.Slices[0].Percent != 80 {
		t.Fatalf("top slice = %#v, want Technology at 80%%", report.Slices[0])
	}
}

func TestAnalysisServiceMorningstarCategory(t *testing.T) {
	service := &AnalysisService{
		Reports: fakeReportReader{reports: map[int64]AssetReport{
			1: {AssetID: 1, FundReport: yfinance.FundReport{Category: "Large Blend", Group: "US Equity"}},
			2: {AssetID: 2, FundReport: yfinance.FundReport{Category: "Small Growth", Group: "US Equity"}},
			3: {AssetID: 3},
		}},
		Holdings: &fakeHoldingsReader{holdings: []AnalysisHolding{holding(1, "VTI", 100), holding(2, "VBK", 60), holding(3, "UNKNOWN", 40)}},
	}

	report := mustAnalyze(t, service, model.AnalysisViewMorningstarCategory, HoldingsFilter{IncludeUnclassified: true})
	if report.TotalValueUsd != 200 {
		t.Fatalf("total = %v, want 200", report.TotalValueUsd)
	}
	got := sliceValues(report.Slices)
	want := map[string]money.Cents{"US Equity: Large Blend": 100, "US Equity: Small Growth": 60, UnassignedLabel: 40}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("slices = %#v, want %#v", got, want)
	}
	if report.Slices[len(report.Slices)-1].Label != UnassignedLabel {
		t.Fatalf("unassigned slice should be last: %#v", report.Slices)
	}
}

// TestAnalysisServiceSectorsBondFundBecomesUnassigned verifies that a holding with a valid
// analysis report but no equity sector data (e.g. a bond fund) is labeled "Unassigned" in the
// SECTORS view — not "Unclassified". Unclassified is reserved for holdings missing a report.
func TestAnalysisServiceSectorsBondFundBecomesUnassigned(t *testing.T) {
	sector := "Technology"
	service := &AnalysisService{
		Reports: fakeReportReader{reports: map[int64]AssetReport{
			1: {AssetID: 1, FundReport: yfinance.FundReport{SectorTechnology: 1.0}, EquitySector: &sector},
			2: {AssetID: 2, FundReport: yfinance.FundReport{}}, // bond fund: has report but no equity sector / sector fractions
		}},
		Holdings: &fakeHoldingsReader{holdings: []AnalysisHolding{holding(1, "AAPL", 80), holding(2, "BND", 20)}},
	}

	report := mustAnalyze(t, service, model.AnalysisViewSectors, HoldingsFilter{IncludeUnclassified: false})
	got := sliceValues(report.Slices)
	want := map[string]money.Cents{"Technology": 80, UnassignedLabel: 20}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("slices = %#v, want %#v", got, want)
	}
	if report.TotalValueUsd != 100 {
		t.Fatalf("total = %v, want 100 (unassigned bond fund is always included)", report.TotalValueUsd)
	}
	if report.Slices[len(report.Slices)-1].Label != UnassignedLabel {
		t.Fatalf("unassigned slice should be last: %#v", report.Slices)
	}
}

// TestAnalysisServiceUnclassifiedFilterHidesNoReportHoldings verifies that when the DB omits
// no-report holdings (IncludeUnclassified=false enforced at SQL level), the service still shows
// "Unassigned" (has report but no grouping for the view) and never shows "Unclassified".
func TestAnalysisServiceUnclassifiedFilterHidesNoReportHoldings(t *testing.T) {
	sector := "Technology"
	service := &AnalysisService{
		Reports: fakeReportReader{reports: map[int64]AssetReport{
			1: {AssetID: 1, FundReport: yfinance.FundReport{SectorTechnology: 1.0}, EquitySector: &sector},
			2: {AssetID: 2, FundReport: yfinance.FundReport{}}, // has report but no sectors → Unassigned
		}},
		// SQL omits no-report holdings when IncludeUnclassified=false; simulate that here.
		Holdings: &fakeHoldingsReader{holdings: []AnalysisHolding{holding(1, "AAPL", 80), holding(2, "BND", 20)}},
	}

	got := mustAnalyze(t, service, model.AnalysisViewSectors, HoldingsFilter{IncludeUnclassified: false})
	values := sliceValues(got.Slices)
	if _, hasUnclassified := values[UnclassifiedLabel]; hasUnclassified {
		t.Fatalf("Unclassified slice should not appear when SQL omits no-report holdings, got slices = %#v", values)
	}
	if _, hasUnassigned := values[UnassignedLabel]; !hasUnassigned {
		t.Fatalf("Unassigned slice should always be shown, got slices = %#v", values)
	}
	if got.TotalValueUsd != 100 {
		t.Fatalf("total = %v, want 100", got.TotalValueUsd)
	}
}

func TestAnalysisServicePassesFilterAndHandlesEmptyPortfolio(t *testing.T) {
	holdings := fakeHoldingsReader{}
	service := &AnalysisService{Reports: fakeReportReader{}, Holdings: &holdings}
	filter := HoldingsFilter{OwnerIDs: []int64{1}, AccountSubtypes: []string{"401k"}, AccountIDs: []int64{123}, IncludeUnclassified: true}
	wantFilter := HoldingsFilter{OwnerIDs: []int64{1}, AccountSubtypes: []string{"401k"}, AccountIDs: []int64{123}, IncludeUnclassified: true}

	report := mustAnalyze(t, service, model.AnalysisViewMorningstarGroup, filter)
	if report.TotalValueUsd != 0 || len(report.Slices) != 0 {
		t.Fatalf("empty report = %#v", report)
	}
	if !reflect.DeepEqual(holdings.filter, wantFilter) {
		t.Fatalf("filter = %#v, want %#v", holdings.filter, wantFilter)
	}
}

type fakeReportReader struct{ reports map[int64]AssetReport }

func (f fakeReportReader) ReportsByAssetIDs(_ context.Context, assetIDs []int64) (map[int64]AssetReport, error) {
	out := map[int64]AssetReport{}
	for _, id := range assetIDs {
		if report, ok := f.reports[id]; ok {
			out[id] = report
		}
	}
	return out, nil
}

type fakeHoldingsReader struct {
	holdings []AnalysisHolding
	filter   HoldingsFilter
}

func (f *fakeHoldingsReader) CurrentPublicHoldings(_ context.Context, filter HoldingsFilter) ([]AnalysisHolding, error) {
	f.filter = filter
	return f.holdings, nil
}

func holding(assetID int64, identifier string, valueUSD money.Cents) AnalysisHolding {
	return AnalysisHolding{
		AssetID:  assetID,
		Asset:    &model.Asset{ID: model.New(model.GlobalIDAsset, assetID), AssetType: model.AssetTypeSecurity, Identifier: identifier, Classifier: model.AssetClassifierPublic},
		ValueUSD: valueUSD,
	}
}

func sliceValues(slices []*model.AnalysisSlice) map[string]money.Cents {
	toValueByLabel := func(slice *model.AnalysisSlice) (string, money.Cents) { return slice.Label, slice.ValueUsd }
	return lo.Associate(slices, toValueByLabel)
}
