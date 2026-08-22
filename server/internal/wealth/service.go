package wealth

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"tallyo/internal/apierror"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/wealth/syncerids"

	"github.com/samber/lo"
)

// MaxHistoricalNetWorthPoints bounds sampled points per historical net-worth
// request; a finer granularity over a long range can otherwise blow up
// per-date report work.
const MaxHistoricalNetWorthPoints = 400

type Service struct {
	Store         ServiceStore
	Log           *slog.Logger
	PriceProvider PriceProvider
	Timezone      func() string
}

func (s *Service) NetWorth(ctx context.Context, input model.NetWorthInput) (*model.NetWorthReport, error) {
	filter := accountFilterFromNetWorthInput(&input)
	position, err := s.currentPosition(ctx, filter)
	if err != nil {
		return nil, err
	}
	return &model.NetWorthReport{
		CurrentNetWorthUsd:    position.Assets - position.Liabilities,
		CurrentAssetsUsd:      position.Assets,
		CurrentLiabilitiesUsd: position.Liabilities,
		ClassifierBreakdown:   classifierBreakdown(position.AssetHoldings, position.Assets),
		LiabilityBreakdown:    liabilityBreakdown(position.LiabilityBalances, position.Liabilities),
		AsOfDate:              timestampToLocalDate(position.TimestampRange.Latest, s.Timezone()),
	}, nil
}

type currentPosition struct {
	AssetHoldings     []CurrentHolding
	LiabilityBalances []LiabilityAccountBalance
	Assets            money.Cents
	Liabilities       money.Cents
	TimestampRange    SnapshotTimestampRange
}

func (s *Service) currentPosition(ctx context.Context, filter AccountFilter) (currentPosition, error) {
	filter.ExcludeLiabilities = true
	holdings, err := s.Store.CurrentHoldings(ctx, filter)
	if err != nil {
		return currentPosition{}, err
	}
	liabilityBalances, err := s.Store.LatestLiabilityAccountBalances(ctx, filter)
	if err != nil {
		return currentPosition{}, err
	}
	timestampRange, err := s.Store.AccountBalanceSnapshotTimestampRange(ctx, filter)
	if err != nil {
		return currentPosition{}, err
	}
	return currentPosition{
		AssetHoldings:     holdings,
		LiabilityBalances: liabilityBalances,
		Assets:            sumValueUSD(holdings),
		Liabilities:       lo.SumBy(liabilityBalances, func(b LiabilityAccountBalance) money.Cents { return b.BalanceUSD }),
		TimestampRange:    timestampRange,
	}, nil
}

func timestampToLocalDate(ts *time.Time, tz string) *model.Date {
	if ts == nil {
		return nil
	}
	d := model.Date(LocalDate(*ts, tz))
	return &d
}

func (s *Service) HistoricalNetWorth(ctx context.Context, input model.HistoricalNetWorthInput) (*model.HistoricalNetWorthReport, error) {
	filter := accountFilterFromNetWorthInput(input.Filters)
	position, err := s.currentPosition(ctx, filter)
	if err != nil {
		return nil, err
	}
	now := localNow(s.Timezone())
	tz := s.Timezone()
	dates := sampleDates(input, position.TimestampRange.Earliest, now)
	if len(dates) > MaxHistoricalNetWorthPoints {
		return nil, apierror.Publicf("historical net worth range produces %d points (max %d); choose a coarser granularity", len(dates), MaxHistoricalNetWorthPoints)
	}
	startTime, endTime := seriesWindow(dates)
	snapshotValues, err := s.Store.AccountBalanceSnapshotValues(ctx, startTime, endTime, filter)
	if err != nil {
		return nil, err
	}
	series := s.series(dates, now, tz, position.Assets, position.Liabilities, snapshotValues)
	classifierSeries, err := s.classifierSeries(ctx, input, dates, tz)
	if err != nil {
		return nil, err
	}
	liabilitySeries := s.liabilitySeries(dates, tz, snapshotValues)
	return &model.HistoricalNetWorthReport{
		Series:           series,
		ClassifierSeries: classifierSeries,
		LiabilitySeries:  liabilitySeries,
	}, nil
}

func accountFilterFromNetWorthInput(input *model.NetWorthInput) AccountFilter {
	if input == nil {
		return AccountFilter{}
	}
	return AccountFilter{
		OwnerIDs:   model.LocalInt64IDsPtr(input.OwnerIds),
		AccountIDs: model.LocalInt64IDsPtr(input.AccountIds),
	}
}

func (s *Service) Quote(ctx context.Context, ticker string) (*model.AssetQuote, error) {
	upper := strings.ToUpper(strings.TrimSpace(ticker))
	asset := &model.Asset{AssetType: model.AssetTypeSecurity, Identifier: upper}
	price, err := s.PriceProvider.PriceAt(ctx, asset, time.Now())
	if err != nil {
		return nil, fmt.Errorf("fetch price for %q: %w", upper, err)
	}
	return &model.AssetQuote{Ticker: upper, PriceUsd: price, AsOf: time.Now().UTC()}, nil
}

func (s *Service) AccountsLastSyncedAt(ctx context.Context, accountIDs []int64) (map[int64]*time.Time, error) {
	syncedAtByAccountID, err := s.Store.AccountLastBalanceSyncedAtForAccounts(ctx, accountIDs)
	if err != nil {
		return nil, err
	}
	toPtr := func(t time.Time, _ int64) *time.Time { return &t }
	return lo.MapValues(syncedAtByAccountID, toPtr), nil
}

func (s *Service) Assets(ctx context.Context, input model.AssetsInput) ([]*model.Asset, error) {
	return s.Store.AllAssets(ctx, input)
}

func (s *Service) MergeAsset(ctx context.Context, input model.MergeAssetInput) (*model.Asset, error) {
	assetID, err := input.AssetID.Int64OfType(model.GlobalIDAsset)
	if err != nil {
		return nil, err
	}
	return s.Store.MergeAssetBySource(ctx, syncerIDFromSourceAdapter(input.SourceAdapter), input.SourceID, assetID)
}

var syncerIDBySourceAdapter = map[model.AssetSourceAdapter]syncerids.ID{
	model.AssetSourceAdapterPlaid:     syncerids.Plaid,
	model.AssetSourceAdapterSimplefin: syncerids.SimpleFin,
	model.AssetSourceAdapterDebank:    syncerids.Debank,
}

var sourceAdapterBySyncerID = lo.Invert(syncerIDBySourceAdapter)

func syncerIDFromSourceAdapter(adapter model.AssetSourceAdapter) syncerids.ID {
	return lo.CoalesceOrEmpty(syncerIDBySourceAdapter[adapter], syncerids.ID(adapter))
}

func SourceAdapterFromSyncerID(id syncerids.ID) model.AssetSourceAdapter {
	return lo.CoalesceOrEmpty(sourceAdapterBySyncerID[id], model.AssetSourceAdapter(id))
}

func classifierBreakdown(holdings []CurrentHolding, totalAssets money.Cents) []*model.ClassifierBreakdown {
	byClassifier := lo.GroupBy(holdings, classifierOf)
	order := []model.AssetClassifier{model.AssetClassifierCash, model.AssetClassifierPublic, model.AssetClassifierCompanyEquity, model.AssetClassifierCryptocurrency, model.AssetClassifierStablecoin, model.AssetClassifierRealEstate}
	toBreakdown := func(classifier model.AssetClassifier, _ int) (*model.ClassifierBreakdown, bool) {
		items := byClassifier[classifier]
		if len(items) == 0 {
			return nil, false
		}
		value := sumValueUSD(items)
		percent := 0.0
		if totalAssets != 0 {
			percent = value.Dollars() / totalAssets.Dollars() * 100
		}
		rollups := holdingRollups(items)
		return &model.ClassifierBreakdown{
			Classifier:      classifier,
			Label:           classifierLabel(classifier),
			ValueUsd:        value,
			PercentOfAssets: percent,
			AssetCount:      int32(len(rollups)),
			Holdings:        rollups,
		}, true
	}
	return lo.FilterMap(order, toBreakdown)
}

func sumValueUSD(holdings []CurrentHolding) money.Cents {
	return lo.SumBy(holdings, func(h CurrentHolding) money.Cents { return h.ValueUSD })
}

func classifierOf(holding CurrentHolding) model.AssetClassifier {
	return holding.Asset.Classifier
}

var classifierLabels = map[model.AssetClassifier]string{
	model.AssetClassifierCash:           "Cash & Equivalents",
	model.AssetClassifierPublic:         "Public Assets",
	model.AssetClassifierCompanyEquity:  "Company Equity",
	model.AssetClassifierCryptocurrency: "Cryptocurrency",
	model.AssetClassifierStablecoin:     "Stablecoin",
	model.AssetClassifierRealEstate:     "Real Estate",
}

func classifierLabel(classifier model.AssetClassifier) string {
	return lo.CoalesceOrEmpty(classifierLabels[classifier], string(classifier))
}

// IsLiabilityType reports whether an account type is a liability (credit or
// loan). Net worth subtracts liability balances, and providers that report
// signed balances normalize them to a positive magnitude using this.
func IsLiabilityType(t model.AccountType) bool {
	return t == model.AccountTypeCredit || t == model.AccountTypeLoan
}
