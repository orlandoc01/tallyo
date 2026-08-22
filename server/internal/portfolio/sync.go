package portfolio

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"tallyo/internal/clients"
	"tallyo/internal/clients/yfinance"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"
)

const reportRefreshInterval = 14 * 24 * time.Hour

type ReportSyncer struct {
	Yahoo        yfinance.Client
	Reports      ReportStore
	Holdings     HoldingsProvider
	Connectivity ConnectivityUpdater
	Log          *slog.Logger
	Now          func() time.Time
	u.Sleeper
}

func (s *ReportSyncer) SyncAll(ctx context.Context) error {
	assets, err := s.Holdings.PublicAssetsNeedingReport(ctx, s.Now().UTC().Add(-reportRefreshInterval))
	if err != nil {
		return err
	}
	return s.syncAssets(ctx, assets)
}

func (s *ReportSyncer) syncAssets(ctx context.Context, assets []AssetStub) error {
	for i, asset := range assets {
		if i > 0 {
			if err := s.SleepBeforeContinue(ctx, 250*time.Millisecond); err != nil {
				return err
			}
		}
		if err := s.syncAsset(ctx, asset); err != nil {
			s.Log.Warn("portfolio analysis report sync failed", "asset_id", asset.ID, "ticker", asset.Identifier, "error", err)
		}
	}
	return nil
}

func (s *ReportSyncer) syncAsset(ctx context.Context, asset AssetStub) error {
	if asset.InvestmentConnectivity == model.ConnectivityStatusIgnore {
		return nil
	}
	ticker := strings.TrimSpace(strings.ToUpper(asset.Identifier))
	if asset.TrackingTicker != nil && strings.TrimSpace(*asset.TrackingTicker) != "" {
		ticker = strings.TrimSpace(strings.ToUpper(*asset.TrackingTicker))
	}
	if ticker == "" {
		return nil
	}
	if clients.IsSyntheticYahooTicker(ticker) {
		return nil
	}
	fund, err := s.Yahoo.FetchFund(ctx, ticker)
	if err != nil {
		if yfinance.IsNotFound(err) {
			s.updateConnectivity(ctx, asset.ID, model.ConnectivityStatusNotFound)
		}
		return err
	}
	if fund != nil && fund.Valid() {
		if err := s.Reports.UpsertReport(ctx, reportFromFund(asset.ID, *fund, s.Now().UTC())); err != nil {
			return err
		}
		s.updateConnectivity(ctx, asset.ID, model.ConnectivityStatusHealthy)
		return nil
	}
	equity, err := s.Yahoo.FetchEquity(ctx, ticker)
	if err != nil {
		if yfinance.IsNotFound(err) {
			s.updateConnectivity(ctx, asset.ID, model.ConnectivityStatusNotFound)
		}
		return err
	}
	if equity == nil || !equity.Valid() {
		s.Log.Warn("portfolio analysis data unavailable", "asset_id", asset.ID, "ticker", ticker)
		s.updateConnectivity(ctx, asset.ID, model.ConnectivityStatusNotFound)
		return nil
	}
	if err := s.Reports.UpsertReport(ctx, reportFromEquity(asset.ID, *equity, s.Now().UTC())); err != nil {
		return err
	}
	s.updateConnectivity(ctx, asset.ID, model.ConnectivityStatusHealthy)
	return nil
}

func (s *ReportSyncer) updateConnectivity(ctx context.Context, assetID int64, status model.ConnectivityStatus) {
	if err := s.Connectivity.UpdateAssetInvestmentConnectivity(ctx, assetID, status); err != nil {
		s.Log.Warn("portfolio analysis connectivity update failed", "asset_id", assetID, "status", status, "error", err)
	}
}

func reportFromFund(assetID int64, fund yfinance.FundReport, fetchedAt time.Time) AssetReport {
	return AssetReport{AssetID: assetID, FundReport: fund, FetchedAt: fetchedAt}
}

func reportFromEquity(assetID int64, equity yfinance.EquityReport, fetchedAt time.Time) AssetReport {
	sector := strings.TrimSpace(equity.Sector)
	return AssetReport{AssetID: assetID, FundReport: yfinance.FundReport{Category: "Individual Equity", Group: "Individual Equity", StockPosition: 1}, EquitySector: &sector, FetchedAt: fetchedAt}
}
