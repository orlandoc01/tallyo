package debank

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"tallyo/internal/accounts"
	apiClients "tallyo/internal/clients"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"

	"github.com/samber/lo"
)

const newAssetDustThresholdUSD = 0.05

type Adapter struct {
	wealth.BaseAdapter
	Wallets   WalletStore
	Schedules ScheduleStore
	Now       func() time.Time
	u.Sleeper
	reads  ReadStore
	client *apiClients.Debank
}

type ReadStore interface {
	wealth.AdapterReadStore
	AssetByAdapterSource(ctx context.Context, source wealth.AdapterSource) (*model.Asset, error)
	AssetByKey(ctx context.Context, assetType model.AssetType, identifier string) (*model.Asset, error)
}

func New(
	httpClient *http.Client,
	reads ReadStore,
	wallets WalletStore,
	schedules ScheduleStore,
	log *slog.Logger,
) *Adapter {
	return &Adapter{
		BaseAdapter: wealth.BaseAdapter{Reads: reads, Log: log},
		Wallets:     wallets,
		Schedules:   schedules,
		Now:         time.Now,
		reads:       reads,
		client:      apiClients.NewDebank(httpClient),
	}
}

func (s *Adapter) Source() syncerids.ID {
	return syncerids.Debank
}

func (s *Adapter) now() time.Time {
	return s.Now().UTC()
}

func (s *Adapter) walletTokens(ctx context.Context, wallet accounts.EVMWallet) ([]apiClients.TokenBalance, error) {
	if len(wallet.ChainIDs) == 0 {
		s.Log.Warn("evmchain: no selected chains; skipping wallet token balances", "address", wallet.Address)
		return nil, nil
	}

	var tokens []apiClients.TokenBalance
	for _, chainID := range wallet.ChainIDs {
		chainTokens, err := s.client.BalanceList(ctx, wallet.Address, chainID)
		if err != nil {
			return nil, fmt.Errorf("fetch token balances for %s chain %s: %w", wallet.Address, chainID, err)
		}
		tokens = append(tokens, chainTokens...)
	}
	return tokens, nil
}

func (s *Adapter) assetUpsertForHolding(holding wealth.AssetDailyHolding, priceAt time.Time) wealth.AssetUpsert {
	name := lo.CoalesceOrEmpty(lo.FromPtr(holding.TokenName), lo.FromPtr(holding.TokenSymbol), holding.TokenID)
	price := lo.CoalesceOrEmpty(holding.ProviderPrice, priceFromHolding(holding))
	classifier := cryptoClassifier(lo.FromPtr(holding.TokenSymbol))
	return wealth.AssetUpsert{
		AssetType:     model.AssetTypeCrypto,
		Identifier:    holding.Identifier,
		Name:          &name,
		Classifier:    classifier,
		LastPrice:     price,
		LastPriceAt:   &priceAt,
		LineType:      lo.EmptyableToPtr(holding.LineType),
		ChainID:       lo.EmptyableToPtr(holding.ChainID),
		TokenID:       lo.EmptyableToPtr(holding.TokenID),
		TokenSymbol:   holding.TokenSymbol,
		TokenName:     holding.TokenName,
		ProjectName:   holding.ProjectName,
		AdapterSource: &wealth.AdapterSource{Adapter: syncerids.Debank, SourceID: holding.Identifier},
	}
}

func (s *Adapter) enrichProjectHoldings(ctx context.Context, holdings []wealth.AssetDailyHolding) {
	for i := range holdings {
		if holdings[i].LineType != "PROJECT_TOKEN" {
			continue
		}
		metadata, err := s.client.Token(ctx, holdings[i].ChainID, holdings[i].TokenID)
		if err != nil {
			s.Log.Debug("evmchain: project token metadata unavailable", "identifier", holdings[i].Identifier, "error", err)
			continue
		}
		applyProjectMetadata(&holdings[i], metadata)
	}
}

func (s *Adapter) debankAssetKnown(ctx context.Context, identifier string) (bool, error) {
	asset, err := s.reads.AssetByAdapterSource(ctx, *debankAdapterSource(identifier))
	if err != nil || asset != nil {
		return asset != nil, err
	}
	asset, err = s.reads.AssetByKey(ctx, model.AssetTypeCrypto, identifier)
	return asset != nil, err
}

func applyProjectMetadata(holding *wealth.AssetDailyHolding, metadata *apiClients.TokenMetadata) {
	if metadata == nil {
		return
	}
	symbol := lo.CoalesceOrEmpty(metadata.Symbol, metadata.OptimizedSymbol, lo.FromPtr(holding.TokenSymbol))
	name := lo.CoalesceOrEmpty(metadata.Name, lo.FromPtr(holding.TokenName), symbol)
	holding.TokenSymbol = &symbol
	holding.TokenName = &name
	if metadata.Price > 0 {
		holding.ProviderPrice = &metadata.Price
	}
}
