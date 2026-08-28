package portfolio

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"strings"
	"testing"
	"time"

	"tallyo/internal/clients/yfinance"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	testutil "tallyo/internal/utils/test"
)

func TestReportSyncerSyncAllSkipsSyntheticAssetsAndContinuesAfterErrors(t *testing.T) {
	reports := &fakeReportStore{}
	yahoo := &fakeYahoo{funds: map[string]*yfinance.FundReport{"VTI": {Category: "Large Blend", Group: "US Equity", StockPosition: 1}}, equities: map[string]*yfinance.EquityReport{"AAPL": {Sector: "Technology"}}, errors: map[string]error{"BAD": fmt.Errorf("boom")}}
	var logBuf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelWarn}))
	simplefin := "simplefin:sec"
	tracking := "VTI"
	syncer := &ReportSyncer{Yahoo: yahoo, Reports: reports, Holdings: fakeAssetProvider{needing: []AssetStub{{ID: 1, Identifier: "plaid:sec"}, {ID: 2, Identifier: "VTI"}, {ID: 3, Identifier: "AAPL"}, {ID: 4, Identifier: "BAD"}, {ID: 5, Identifier: "ignored", TrackingTicker: &simplefin}, {ID: 6, Identifier: "PLAID:synthetic", TrackingTicker: &tracking}}}, Connectivity: &fakeConnectivityUpdater{}, Now: fixedNow, Sleep: noSleep, Log: logger}

	must.NoErr(t, syncer.SyncAll(context.Background()))
	if !strings.Contains(logBuf.String(), "BAD") {
		t.Fatalf("expected warning log for BAD ticker, got: %s", logBuf.String())
	}
	if len(reports.upserts) != 3 {
		t.Fatalf("upserts = %#v, want 3", reports.upserts)
	}
	if reports.upserts[0].AssetID != 2 || reports.upserts[0].Group != "US Equity" {
		t.Fatalf("fund report = %#v", reports.upserts[0])
	}
	if reports.upserts[1].AssetID != 3 || reports.upserts[1].StockPosition != 1 || reports.upserts[1].EquitySector == nil || *reports.upserts[1].EquitySector != "Technology" {
		t.Fatalf("equity report = %#v", reports.upserts[1])
	}
	if reports.upserts[2].AssetID != 6 || reports.upserts[2].Group != "US Equity" {
		t.Fatalf("tracking ticker report = %#v", reports.upserts[2])
	}
	if yahoo.fundCalls["PLAID:SEC"] != 0 || yahoo.fundCalls["SIMPLEFIN:SEC"] != 0 {
		t.Fatalf("synthetic plaid asset was fetched")
	}
}

func TestReportSyncerConnectivityUpdates(t *testing.T) {
	connectivity := &fakeConnectivityUpdater{}
	yahoo := &fakeYahoo{
		funds:  map[string]*yfinance.FundReport{"VTI": {Category: "Large Blend", Group: "US Equity", StockPosition: 1}},
		errors: map[string]error{"BAD": yfinance.YahooStatusError{StatusCode: 404, Ticker: "BAD"}},
	}
	syncer := &ReportSyncer{Yahoo: yahoo, Reports: &fakeReportStore{}, Connectivity: connectivity, Now: fixedNow, Sleep: noSleep, Log: testutil.Logger}

	must.NoErr(t, syncer.syncAsset(context.Background(), AssetStub{ID: 1, Identifier: "IGN", InvestmentConnectivity: model.ConnectivityStatusIgnore}))
	if err := syncer.syncAsset(context.Background(), AssetStub{ID: 2, Identifier: "BAD"}); err == nil {
		t.Fatalf("sync BAD error = nil, want 404 error")
	}
	must.NoErr(t, syncer.syncAsset(context.Background(), AssetStub{ID: 3, Identifier: "VTI"}))

	if yahoo.fundCalls["IGN"] != 0 {
		t.Fatalf("ignored asset was fetched")
	}
	want := map[int64]model.ConnectivityStatus{2: model.ConnectivityStatusNotFound, 3: model.ConnectivityStatusHealthy}
	if fmt.Sprint(connectivity.statuses) != fmt.Sprint(want) {
		t.Fatalf("connectivity statuses = %#v, want %#v", connectivity.statuses, want)
	}
}

func TestReportSyncerSkipsEmptyFundReport(t *testing.T) {
	reports := &fakeReportStore{}
	yahoo := &fakeYahoo{funds: map[string]*yfinance.FundReport{"EMPTY": {}}}
	syncer := &ReportSyncer{Yahoo: yahoo, Reports: reports, Connectivity: &fakeConnectivityUpdater{}, Now: fixedNow, Sleep: noSleep, Log: testutil.Logger}

	must.NoErr(t, syncer.syncAsset(context.Background(), AssetStub{ID: 1, Identifier: "EMPTY"}))
	if len(reports.upserts) != 0 {
		t.Fatalf("upserts = %#v, want none", reports.upserts)
	}
}

func TestReportSyncerSkipsEmptyEquityReport(t *testing.T) {
	reports := &fakeReportStore{}
	connectivity := &fakeConnectivityUpdater{}
	yahoo := &fakeYahoo{equities: map[string]*yfinance.EquityReport{"EMPTY": {}}}
	syncer := &ReportSyncer{Yahoo: yahoo, Reports: reports, Connectivity: connectivity, Now: fixedNow, Sleep: noSleep, Log: testutil.Logger}

	must.NoErr(t, syncer.syncAsset(context.Background(), AssetStub{ID: 1, Identifier: "EMPTY"}))
	if len(reports.upserts) != 0 {
		t.Fatalf("upserts = %#v, want none", reports.upserts)
	}
	if connectivity.statuses[1] != model.ConnectivityStatusNotFound {
		t.Fatalf("connectivity status = %s, want %s", connectivity.statuses[1], model.ConnectivityStatusNotFound)
	}
}

type fakeYahoo struct {
	funds     map[string]*yfinance.FundReport
	equities  map[string]*yfinance.EquityReport
	errors    map[string]error
	fundCalls map[string]int
}

func (f *fakeYahoo) FetchFund(_ context.Context, ticker string) (*yfinance.FundReport, error) {
	if f.fundCalls == nil {
		f.fundCalls = map[string]int{}
	}
	f.fundCalls[ticker]++
	if err := f.errors[ticker]; err != nil {
		return nil, err
	}
	return f.funds[ticker], nil
}

func (f *fakeYahoo) FetchEquity(_ context.Context, ticker string) (*yfinance.EquityReport, error) {
	if err := f.errors[ticker]; err != nil {
		return nil, err
	}
	return f.equities[ticker], nil
}

type fakeReportStore struct {
	upserts []AssetReport
}

func (f *fakeReportStore) UpsertReport(_ context.Context, report AssetReport) error {
	f.upserts = append(f.upserts, report)
	return nil
}

type fakeAssetProvider struct {
	needing []AssetStub
}

type fakeConnectivityUpdater struct {
	statuses map[int64]model.ConnectivityStatus
}

func (f *fakeConnectivityUpdater) UpdateAssetInvestmentConnectivity(_ context.Context, assetID int64, status model.ConnectivityStatus) error {
	if f.statuses == nil {
		f.statuses = map[int64]model.ConnectivityStatus{}
	}
	f.statuses[assetID] = status
	return nil
}

func (f fakeAssetProvider) PublicAssetsNeedingReport(context.Context, time.Time) ([]AssetStub, error) {
	return f.needing, nil
}
func fixedNow() time.Time                          { return time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC) }
func noSleep(context.Context, time.Duration) error { return nil }
