package debank

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"slices"
	"strings"
	"time"

	apiClients "tallyo/internal/clients"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"

	"github.com/samber/lo"
)

type knownDebankAsset func(identifier string) (bool, error)

func buildSnapshotWithKnown(
	accountID int64,
	address string,
	date string,
	syncedAt time.Time,
	tokens []apiClients.TokenBalance,
	projects []apiClients.Project,
	projectRaw string,
	selectedChains []string,
	knownAsset knownDebankAsset,
	log *slog.Logger,
) (wealth.AccountBalanceSnapshot, error) {
	holdings := walletTokenHoldings(tokens)
	selected := lo.Keyify(selectedChains)
	for _, project := range projects {
		for _, item := range project.PortfolioItems {
			chainID := projectItemChainID(project, item)
			if _, ok := selected[chainID]; chainID != "" && !ok {
				continue
			}
			holding, ok, err := projectTokenHolding(project, item)
			if err != nil {
				return wealth.AccountBalanceSnapshot{}, err
			}
			if !ok {
				log.Debug("evmchain: unsupported project item", "project", project.Name, "chain", project.Chain)
				continue
			}
			holdings = append(holdings, holding)
		}
	}
	holdings = filterSelectedChainHoldings(holdings, selected)
	holdings, err := filterKnownOrDiscoverableHoldings(holdings, knownAsset)
	if err != nil {
		return wealth.AccountBalanceSnapshot{}, err
	}
	holdingValue := func(holding wealth.AssetDailyHolding) float64 {
		return lo.Ternary(holding.CountsTowardValue, holding.ValueUSD, 0)
	}
	total := lo.SumBy(holdings, holdingValue)
	raw := snapshotRawPayload(tokens, projectRaw)
	return wealth.AccountBalanceSnapshot{
		AccountID:     accountID,
		WalletAddress: strings.ToLower(address),
		Source:        syncerids.Debank.Str(),
		Date:          date,
		SyncedAt:      syncedAt.Format(time.RFC3339),
		BalanceUSD:    money.FromDollars(total),
		RawPayload:    &raw,
		Holdings:      holdings,
	}, nil
}

func walletTokenHoldings(tokens []apiClients.TokenBalance) []wealth.AssetDailyHolding {
	toTokenHolding := func(token apiClients.TokenBalance, _ int) (wealth.AssetDailyHolding, bool) {
		if token.ID == "" {
			return wealth.AssetDailyHolding{}, false
		}
		return walletTokenHolding(token), true
	}
	return lo.FilterMap(tokens, toTokenHolding)
}

func walletTokenHolding(token apiClients.TokenBalance) wealth.AssetDailyHolding {
	symbol := lo.CoalesceOrEmpty(token.Symbol, token.OptimizedSymbol, token.DisplaySymbol, token.ID)
	name := lo.CoalesceOrEmpty(token.Name, symbol)
	quantity := token.Amount
	identifier := token.Chain + ":" + token.ID
	return wealth.AssetDailyHolding{
		LineType:          "WALLET_TOKEN",
		ChainID:           token.Chain,
		TokenID:           token.ID,
		Identifier:        identifier,
		AdapterSource:     debankAdapterSource(identifier),
		TokenSymbol:       &symbol,
		TokenName:         &name,
		Quantity:          &quantity,
		ProviderPrice:     lo.Ternary(token.Price > 0, &token.Price, nil),
		ValueUSD:          tokenValueUSD(token),
		CountsTowardValue: true,
	}
}

func projectTokenHolding(project apiClients.Project, item apiClients.ProjectItem) (wealth.AssetDailyHolding, bool, error) {
	chainID := projectItemChainID(project, item)
	tokenID := lo.CoalesceOrEmpty(item.Pool.ID, item.Pool.Controller)
	if chainID == "" || tokenID == "" {
		return wealth.AssetDailyHolding{}, false, nil
	}
	if !projectNetUSDValuePresent(item.Stats) {
		return wealth.AssetDailyHolding{}, false, fmt.Errorf("project %q item %q missing net_usd_value", project.ID, tokenID)
	}
	projectName := lo.CoalesceOrEmpty(project.Name, project.ID)
	symbol := projectSymbol(item)
	identifier := chainID + ":" + tokenID
	return wealth.AssetDailyHolding{
		LineType:          "PROJECT_TOKEN",
		ChainID:           chainID,
		ProjectName:       &projectName,
		TokenID:           tokenID,
		Identifier:        identifier,
		AdapterSource:     debankAdapterSource(identifier),
		TokenSymbol:       &symbol,
		TokenName:         &projectName,
		ValueUSD:          item.Stats.NetUSDValue,
		CountsTowardValue: true,
	}, true, nil
}

func projectItemChainID(project apiClients.Project, item apiClients.ProjectItem) string {
	return lo.CoalesceOrEmpty(project.Chain, item.Pool.Chain)
}

func debankAdapterSource(identifier string) *wealth.AdapterSource {
	return &wealth.AdapterSource{Adapter: syncerids.Debank, SourceID: identifier}
}

func filterSelectedChainHoldings(holdings []wealth.AssetDailyHolding, selected map[string]struct{}) []wealth.AssetDailyHolding {
	if len(selected) == 0 {
		return []wealth.AssetDailyHolding{}
	}
	return lo.Filter(holdings, func(holding wealth.AssetDailyHolding, _ int) bool {
		_, ok := selected[holding.ChainID]
		return ok
	})
}

func filterKnownOrDiscoverableHoldings(
	holdings []wealth.AssetDailyHolding,
	knownAsset knownDebankAsset,
) ([]wealth.AssetDailyHolding, error) {
	groups := lo.GroupBy(holdings, func(holding wealth.AssetDailyHolding) string { return holding.Identifier })
	keepByIdentifier := map[string]bool{}
	for identifier, group := range groups {
		valueUSD := lo.SumBy(group, func(holding wealth.AssetDailyHolding) float64 { return holding.ValueUSD })
		keep := math.Abs(valueUSD) >= newAssetDustThresholdUSD
		if !keep {
			known, err := knownAsset(identifier)
			if err != nil {
				return nil, fmt.Errorf("lookup DeBank asset %q: %w", identifier, err)
			}
			keep = known
		}
		keepByIdentifier[identifier] = keep
	}
	return lo.Filter(holdings, func(holding wealth.AssetDailyHolding, _ int) bool {
		return keepByIdentifier[holding.Identifier]
	}), nil
}

func projectNetUSDValuePresent(stats apiClients.ProjectStats) bool {
	return stats.NetUSDValuePresent || stats.NetUSDValue != 0
}

func projectSymbol(item apiClients.ProjectItem) string {
	if tokenLike(item.Detail.Description) {
		return item.Detail.Description
	}
	symbols := suppliedTokenSymbols(item.Raw)
	if len(symbols) > 0 {
		return strings.Join(symbols, "-")
	}
	return lo.CoalesceOrEmpty(item.Pool.ID, item.Pool.Controller)
}

func suppliedTokenSymbols(raw string) []string {
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil
	}
	seen := map[string]bool{}
	var symbols []string
	walkJSON(value, func(obj map[string]any) {
		symbol, ok := obj["symbol"].(string)
		if ok && symbol != "" && !seen[symbol] && obj["amount"] != nil && obj["price"] != nil {
			seen[symbol] = true
			symbols = append(symbols, symbol)
		}
	})
	return symbols
}

func walkJSON(value any, visit func(map[string]any)) {
	switch typed := value.(type) {
	case map[string]any:
		visit(typed)
		for _, child := range typed {
			walkJSON(child, visit)
		}
	case []any:
		for _, child := range typed {
			walkJSON(child, visit)
		}
	}
}

func tokenLike(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && !strings.Contains(value, " ") && len(value) <= 24
}

func tokenValueUSD(token apiClients.TokenBalance) float64 {
	return lo.Ternary(token.USDValuePresent || token.USDValue != 0, token.USDValue, token.Amount*token.Price)
}

func snapshotRawPayload(tokens []apiClients.TokenBalance, projectRaw string) string {
	payload := map[string]any{"tokens": tokens, "projects": json.RawMessage(projectRaw)}
	raw, _ := json.Marshal(payload)
	return string(raw)
}

func priceFromHolding(holding wealth.AssetDailyHolding) *float64 {
	if holding.Quantity == nil || *holding.Quantity == 0 {
		return nil
	}
	price := holding.ValueUSD / *holding.Quantity
	if math.IsNaN(price) || math.IsInf(price, 0) || price <= 0 {
		return nil
	}
	return &price
}

func cryptoClassifier(symbol string) model.AssetClassifier {
	parts := strings.FieldsFunc(strings.ToUpper(symbol), func(r rune) bool { return r == '-' || r == '/' || r == '_' })
	if len(parts) == 0 {
		return model.AssetClassifierCryptocurrency
	}
	for _, part := range parts {
		if !stableSymbol(part) {
			return model.AssetClassifierCryptocurrency
		}
	}
	return model.AssetClassifierStablecoin
}

func stableSymbol(symbol string) bool {
	stableSuffixes := []string{"USDT0", "MSUSD", "USDC", "USDT", "AUSD", "DAI"}
	return slices.ContainsFunc(stableSuffixes, func(suffix string) bool {
		return strings.HasSuffix(symbol, suffix)
	})
}
