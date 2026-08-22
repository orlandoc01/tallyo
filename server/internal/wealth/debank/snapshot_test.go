package debank

import (
	"log/slog"
	"testing"
	"time"

	apiClients "tallyo/internal/clients"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/nooplog"
	"tallyo/internal/wealth"
)

func buildSnapshot(syncedAt time.Time, tokens []apiClients.TokenBalance, projects []apiClients.Project, log *slog.Logger) wealth.AccountBalanceSnapshot {
	snapshot, err := buildSnapshotWithKnown(
		1,
		"0xABC",
		"2026-06-01",
		syncedAt,
		tokens,
		projects,
		`[]`,
		snapshotChains(tokens, projects),
		func(string) (bool, error) { return false, nil },
		log,
	)
	if err != nil {
		log.Warn("evmchain: build snapshot failed", "error", err)
	}
	return snapshot
}

func snapshotChains(tokens []apiClients.TokenBalance, projects []apiClients.Project) []string {
	seen := map[string]bool{}
	chains := []string{}
	addChain := func(chainID string) {
		if chainID == "" || seen[chainID] {
			return
		}
		seen[chainID] = true
		chains = append(chains, chainID)
	}
	for _, token := range tokens {
		addChain(token.Chain)
	}
	for _, project := range projects {
		addChain(project.Chain)
		for _, item := range project.PortfolioItems {
			addChain(item.Pool.Chain)
		}
	}
	return chains
}

func TestBuildSnapshotExtractsWalletAndProjectHoldings(t *testing.T) {
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	projects := []apiClients.Project{{
		Chain: "base",
		ID:    "beefy",
		Name:  "Beefy",
		PortfolioItems: []apiClients.ProjectItem{{
			Pool:  apiClients.ProjectPool{ID: "0xpool"},
			Stats: apiClients.ProjectStats{NetUSDValue: 42.5},
			Raw:   `{"detail":{"supply_token_list":[{"symbol":"msUSD","amount":10,"price":1},{"symbol":"USDC","amount":20,"price":1}]}}`,
		}},
	}}
	snapshot := buildSnapshot(now, []apiClients.TokenBalance{{
		Chain:           "eth",
		ID:              "eth",
		OptimizedSymbol: "ETH",
		Name:            "Ethereum",
		Price:           2000,
		Amount:          2,
		Raw:             `{"id":"eth"}`,
	}}, projects, nooplog.Logger)

	if snapshot.Date != "2026-06-01" {
		t.Fatalf("date = %q, want 2026-06-01", snapshot.Date)
	}
	if snapshot.BalanceUSD != money.FromDollars(4042.5) {
		t.Fatalf("total = %v, want 4042.5", snapshot.BalanceUSD)
	}
	if len(snapshot.Holdings) != 2 {
		t.Fatalf("holdings = %d, want 2", len(snapshot.Holdings))
	}
	if snapshot.Holdings[1].Identifier != "base:0xpool" {
		t.Fatalf("project identifier = %q", snapshot.Holdings[1].Identifier)
	}
	if *snapshot.Holdings[1].TokenSymbol != "msUSD-USDC" {
		t.Fatalf("project symbol = %q", *snapshot.Holdings[1].TokenSymbol)
	}
}

func TestCryptoClassifier(t *testing.T) {
	cases := map[string]model.AssetClassifier{
		"USDC":                                  model.AssetClassifierStablecoin,
		"USDT0-AUSD":                            model.AssetClassifierStablecoin,
		"msUSD-USDC":                            model.AssetClassifierStablecoin,
		"mooBalancerMonadwnUSDT0-wnAUSD-wnUSDC": model.AssetClassifierStablecoin,
		"ETH":                                   model.AssetClassifierCryptocurrency,
		"rETH":                                  model.AssetClassifierCryptocurrency,
		"USDC-PENDLE":                           model.AssetClassifierCryptocurrency,
		"":                                      model.AssetClassifierCryptocurrency,
	}
	for symbol, want := range cases {
		if got := cryptoClassifier(symbol); got != want {
			t.Fatalf("cryptoClassifier(%q) = %q, want %q", symbol, got, want)
		}
	}
}

func TestProjectTokenHoldingRequiresTokenID(t *testing.T) {
	_, ok, err := projectTokenHolding(apiClients.Project{Chain: "eth", Name: "Unsupported"}, apiClients.ProjectItem{Stats: apiClients.ProjectStats{NetUSDValue: 1}})
	if err != nil {
		t.Fatalf("projectTokenHolding() error = %v", err)
	}
	if ok {
		t.Fatal("projectTokenHolding returned ok for missing pool id/controller")
	}
}

func TestBuildSnapshotSkipsUnknownDustWalletTokens(t *testing.T) {
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	snapshot := buildSnapshot(now, []apiClients.TokenBalance{
		{Chain: "eth", ID: "dust", Symbol: "DUST", Price: 0.04, Amount: 1, Raw: `{"id":"dust"}`},
		{Chain: "eth", ID: "kept", Symbol: "KEPT", Price: 0.05, Amount: 1, Raw: `{"id":"kept"}`},
	}, nil, nooplog.Logger)

	if len(snapshot.Holdings) != 1 {
		t.Fatalf("holdings = %d, want 1", len(snapshot.Holdings))
	}
	if snapshot.Holdings[0].Identifier != "eth:kept" {
		t.Fatalf("holding identifier = %q, want eth:kept", snapshot.Holdings[0].Identifier)
	}
}

func TestBuildSnapshotSkipsUnknownDustProjectPositions(t *testing.T) {
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	snapshot := buildSnapshot(now, nil, []apiClients.Project{{
		Chain: "eth",
		Name:  "Tiny Protocol",
		PortfolioItems: []apiClients.ProjectItem{
			{Pool: apiClients.ProjectPool{ID: "0xtiny"}, Stats: apiClients.ProjectStats{NetUSDValue: 0.04}},
			{Pool: apiClients.ProjectPool{ID: "0xtinydebt"}, Stats: apiClients.ProjectStats{NetUSDValue: -0.04}},
			{Pool: apiClients.ProjectPool{ID: "0xkept"}, Stats: apiClients.ProjectStats{NetUSDValue: 0.05}},
		},
	}}, nooplog.Logger)

	if len(snapshot.Holdings) != 1 {
		t.Fatalf("holdings = %d, want 1", len(snapshot.Holdings))
	}
	if snapshot.Holdings[0].Identifier != "eth:0xkept" {
		t.Fatalf("holding identifier = %q, want eth:0xkept", snapshot.Holdings[0].Identifier)
	}
}

func TestBuildSnapshotWithNoSelectedChainsDropsProjects(t *testing.T) {
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	snapshot, err := buildSnapshotWithKnown(
		1,
		"0xABC",
		"2026-06-01",
		now,
		[]apiClients.TokenBalance{{Chain: "eth", ID: "eth", Symbol: "ETH", Price: 100, Amount: 1, USDValue: 100}},
		[]apiClients.Project{{
			Chain: "eth",
			Name:  "Project",
			PortfolioItems: []apiClients.ProjectItem{{
				Pool:  apiClients.ProjectPool{ID: "0xpool"},
				Stats: apiClients.ProjectStats{NetUSDValue: 50},
			}},
		}},
		`[]`,
		[]string{},
		func(string) (bool, error) { return false, nil },
		nooplog.Logger,
	)
	if err != nil {
		t.Fatalf("buildSnapshotWithKnown() error = %v", err)
	}
	if len(snapshot.Holdings) != 0 || snapshot.BalanceUSD != 0 {
		t.Fatalf("snapshot = %#v, want no holdings or balance", snapshot)
	}
}

func TestPersistableHoldingsPreservesWalletQuantityBelowDollar(t *testing.T) {
	quantity := 2.0
	providerPrice := 0.04
	svc := &Adapter{}
	holdings := svc.persistableHoldings([]wealth.AssetDailyHolding{{
		LineType:      "WALLET_TOKEN",
		Identifier:    "eth:dust",
		TokenID:       "dust",
		Quantity:      &quantity,
		ProviderPrice: &providerPrice,
		ValueUSD:      0.04,
	}}, time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC))
	if len(holdings) != 1 || holdings[0].Quantity == nil || *holdings[0].Quantity != quantity {
		t.Fatalf("holdings = %#v", holdings)
	}
	if holdings[0].Price == nil || *holdings[0].Price != providerPrice {
		t.Fatalf("price = %#v, want provider price", holdings[0].Price)
	}
}

func TestBuildSnapshotKeepsNegativeProjectPositions(t *testing.T) {
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	snapshot := buildSnapshot(now, nil, []apiClients.Project{{
		Chain: "eth",
		Name:  "Borrow Protocol",
		PortfolioItems: []apiClients.ProjectItem{{
			Pool:  apiClients.ProjectPool{ID: "0xdebt"},
			Stats: apiClients.ProjectStats{NetUSDValue: -100},
			Raw:   `{"stats":{"net_usd_value":-100}}`,
		}},
	}}, nooplog.Logger)

	if snapshot.BalanceUSD != money.FromDollars(-100) {
		t.Fatalf("BalanceUSD = %v, want -100", snapshot.BalanceUSD)
	}
	if len(snapshot.Holdings) != 1 {
		t.Fatalf("holdings = %d, want 1", len(snapshot.Holdings))
	}
	if snapshot.Holdings[0].ValueUSD != -100 {
		t.Fatalf("holding value = %v, want -100", snapshot.Holdings[0].ValueUSD)
	}
}
