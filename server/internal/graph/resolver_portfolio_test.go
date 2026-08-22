package graph

import (
	"context"
	"reflect"
	"testing"

	"tallyo/internal/graph/model"
	"tallyo/internal/portfolio"
	"tallyo/internal/utils/must"
)

func TestResolverAnalysisDecodesFiltersAndEncodesHoldings(t *testing.T) {
	service := &recordingPortfolioService{report: &model.AnalysisReport{
		View:          model.AnalysisViewSectors,
		TotalValueUsd: 100,
		Slices: []*model.AnalysisSlice{{
			Label:    "Technology",
			ValueUsd: 100,
			Percent:  100,
			Holdings: []*model.AnalysisHolding{{
				Asset:    &model.Asset{ID: model.New(model.GlobalIDAsset, 42), Identifier: "AAPL"},
				ValueUsd: 100,
				Percent:  100,
			}},
		}},
	}}
	resolver := &Resolver{Portfolio: service}
	input := model.AnalysisInput{
		View:                model.AnalysisViewSectors,
		OwnerIds:            globalIDs(model.New(model.GlobalIDOwner, 1)),
		AccountSubtypes:     []string{"401k"},
		AccountIds:          globalIDs(model.New(model.GlobalIDAccount, 123)),
		IncludeUnclassified: new(true),
	}

	report, err := resolver.Query().(*queryResolver).Analysis(context.Background(), input)
	must.NoErr(t, err)
	if service.view != model.AnalysisViewSectors {
		t.Fatalf("view = %v, want %v", service.view, model.AnalysisViewSectors)
	}
	wantFilter := portfolio.HoldingsFilter{OwnerIDs: []int64{1}, AccountSubtypes: []string{"401k"}, AccountIDs: []int64{123}, IncludeUnclassified: true}
	if !reflect.DeepEqual(service.filter, wantFilter) {
		t.Fatalf("filter = %#v, want %#v", service.filter, wantFilter)
	}
	holding := report.Slices[0].Holdings[0]
	if holding.Asset.ID != model.New(model.GlobalIDAsset, 42) {
		t.Fatalf("encoded holding = %#v", holding)
	}
}

func TestResolverAnalysisRejectsBadOwnerIDs(t *testing.T) {
	resolver := &Resolver{Portfolio: &recordingPortfolioService{}}
	if _, err := resolver.Query().(*queryResolver).Analysis(context.Background(), model.AnalysisInput{View: model.AnalysisViewComposition, OwnerIds: globalIDs(model.New(model.GlobalIDAccount, 1))}); err == nil {
		t.Fatalf("Analysis(bad owner ID) returned nil error")
	}
}

type recordingPortfolioService struct {
	report *model.AnalysisReport
	view   model.AnalysisView
	filter portfolio.HoldingsFilter
}

func (s *recordingPortfolioService) Analyze(_ context.Context, view model.AnalysisView, filter portfolio.HoldingsFilter) (*model.AnalysisReport, error) {
	s.view = view
	s.filter = filter
	return s.report, nil
}
