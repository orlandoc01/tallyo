package debank

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	"github.com/samber/lo"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	apiClients "tallyo/internal/clients"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
	"tallyo/internal/wealth"
	wealthdb "tallyo/internal/wealth/db"
	"tallyo/internal/wealth/syncerids"
)

func TestSyncWallet(t *testing.T) {
	ctx := context.Background()

	tokens := []apiClients.TokenBalance{
		{Chain: "eth", ID: "eth", Symbol: "ETH", Name: "Ethereum", Price: 2500.0, Amount: 2.0, USDValue: 5000.0},
		{Chain: "base", ID: "usdc", Symbol: "USDC", Name: "USD Coin", Price: 1.0, Amount: 500.0, USDValue: 500.0},
		// Dust token — should be skipped.
		{Chain: "eth", ID: "dust", Symbol: "DUST", Name: "Dust Token", Price: 0.001, Amount: 1.0, USDValue: 0.001},
	}

	srv, store := debankHarness(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/portfolio/project_list":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []json.RawMessage{json.RawMessage(`{
				"chain":"base",
				"id":"beefy",
				"name":"Beefy",
				"portfolio_item_list":[{"pool":{"id":"0xpool"},"stats":{"net_usd_value":125},"detail":{"supply_token_list":[{"symbol":"USDC","amount":100,"price":1}]}}]
			}`)}})
		case "/token":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"chain": "base", "id": "0xpool", "symbol": "mooPool", "optimized_symbol": "mooPool", "name": "Moo Pool Token", "price": 1.25}})
		case "/token/balance_list":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": tokensForChain(tokens, r.URL.Query().Get("chain"))})
			return
		default:
			http.NotFound(w, r)
		}
	})

	// Create owner + EVM wallet connection + account.
	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "testuser"})
	const testAddr = "0xf7462c16f1eea90bc62cee10b4c66c656a752e18"
	conn, account := mustCreateEVMWallet(t, store, owner, evmWalletInput{Address: testAddr, ChainIDs: []string{"eth", "base"}})

	wallet, err := store.EVMWalletByConnectionID(ctx, conn.ID.Int64())
	if err != nil || wallet == nil {
		t.Fatalf("EVMWalletByConnectionID: %v, wallet = %v", err, wallet)
	}

	svc := newDebankTestService(t, srv, store)

	must.NoErr(t, svc.SyncWalletInto(ctx, *wallet, "0 0 * * *", adapterSink(svc, store)))

	// Verify latest snapshot holdings were stored (2 wallet tokens, 1 project token; dust skipped).
	holdings, err := store.CurrentHoldings(ctx, wealth.AccountFilter{
		AccountIDs: []int64{account.ID.Int64()},
	})
	must.NoErr(t, err)
	if len(holdings) != 3 {
		t.Errorf("holdings count = %d, want 3", len(holdings))
	}
	project := findHolding(holdings, "base:0xpool")
	if project == nil {
		t.Fatalf("missing project holding")
	}
	if project.Quantity != nil || project.ValueUSD != money.FromDollars(125) {
		t.Fatalf("project holding = %#v", project)
	}
	if project.Asset.Name == nil || *project.Asset.Name != "Moo Pool Token" {
		t.Fatalf("project asset name = %#v", project.Asset.Name)
	}
	if project.Asset.CurrentPrice == nil || *project.Asset.CurrentPrice != 1.25 {
		t.Fatalf("project asset price = %#v", project.Asset.CurrentPrice)
	}
}

func TestSyncWalletRemovedTokensReclaimedBySweep(t *testing.T) {
	ctx := context.Background()
	call := 0
	srv, store := debankHarness(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/portfolio/project_list":
			json.NewEncoder(w).Encode(map[string]any{"data": []any{}}) //nolint:errcheck
		case "/token/balance_list":
			call++
			tokens := []apiClients.TokenBalance{{Chain: "eth", ID: "eth", Symbol: "ETH", Name: "Ethereum", Price: 2500, Amount: 1, USDValue: 2500}}
			if call == 1 {
				tokens = append(tokens, apiClients.TokenBalance{Chain: "eth", ID: "gone", Symbol: "GONE", Name: "Gone Token", Price: 2, Amount: 2, USDValue: 4})
			}
			json.NewEncoder(w).Encode(map[string]any{"data": tokens}) //nolint:errcheck
		default:
			http.NotFound(w, r)
		}
	})
	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "pruneuser"})
	conn, _ := mustCreateEVMWallet(t, store, owner, evmWalletInput{Address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", ChainIDs: []string{"eth"}})
	wallet := mustEVMWallet(t, store, conn.ID.Int64())

	svc := newDebankTestService(t, srv, store)
	must.NoErr(t, svc.SyncWalletInto(ctx, *wallet, "0 0 * * *", adapterSink(svc, store)))
	assets, err := store.AllAssets(ctx, model.AssetsInput{})
	must.NoErr(t, err)
	if !hasAssetIdentifier(assets, "eth:gone") {
		t.Fatal("missing eth:gone after first sync")
	}

	must.NoErr(t, svc.SyncWalletInto(ctx, *wallet, "0 0 * * *", adapterSink(svc, store)))
	// The same-day re-sync drops eth:gone's holding. Its catalog row is reclaimed
	// by the post-run sweep — which the balance syncer runs after each pipeline —
	// not inside the sync itself.
	if _, err := store.SweepUnreferencedAssets(ctx); err != nil {
		t.Fatalf("SweepUnreferencedAssets: %v", err)
	}
	assets, err = store.AllAssets(ctx, model.AssetsInput{})
	must.NoErr(t, err)
	if hasAssetIdentifier(assets, "eth:gone") {
		t.Fatal("eth:gone asset was not reclaimed by the sweep")
	}
	if !hasAssetIdentifier(assets, "eth:eth") {
		t.Fatal("eth:eth asset was pruned unexpectedly")
	}
}

func hasAssetIdentifier(assets []*model.Asset, identifier string) bool {
	hasIdentifier := func(asset *model.Asset) bool { return asset.Identifier == identifier }
	return slices.ContainsFunc(assets, hasIdentifier)
}

func tokensForChain(tokens []apiClients.TokenBalance, chainID string) []apiClients.TokenBalance {
	matchesChain := func(token apiClients.TokenBalance, _ int) bool { return token.Chain == chainID }
	return lo.Filter(tokens, matchesChain)
}

func TestAssetUpsertForHoldingRecordsAdapterSource(t *testing.T) {
	svc := &Adapter{}
	symbol := "ETH"
	price := 2500.0
	priceAt := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	asset := svc.assetUpsertForHolding(wealth.AssetDailyHolding{
		Identifier:    "eth:eth",
		LineType:      "WALLET_TOKEN",
		ChainID:       "eth",
		TokenID:       "eth",
		TokenSymbol:   &symbol,
		TokenName:     new("Ether"),
		ProjectName:   new("Ethereum"),
		ProviderPrice: &price,
	}, priceAt)

	if asset.AdapterSource == nil || asset.AdapterSource.Adapter != syncerids.Debank || asset.AdapterSource.SourceID != "eth:eth" {
		t.Fatalf("AdapterSource = %#v, want debank eth:eth", asset.AdapterSource)
	}
	if asset.LineType == nil || *asset.LineType != "WALLET_TOKEN" || asset.ChainID == nil || *asset.ChainID != "eth" || asset.TokenID == nil || *asset.TokenID != "eth" || asset.TokenSymbol == nil || *asset.TokenSymbol != "ETH" || asset.TokenName == nil || *asset.TokenName != "Ether" || asset.ProjectName == nil || *asset.ProjectName != "Ethereum" {
		t.Fatalf("crypto metadata = %#v", asset)
	}
}

func findHolding(holdings []wealth.CurrentHolding, identifier string) *wealth.CurrentHolding {
	for _, holding := range holdings {
		if holding.Asset != nil && holding.Asset.Identifier == identifier {
			return &holding
		}
	}
	return nil
}

func TestSyncDueStaggersWalletStarts(t *testing.T) {
	var balanceCalls atomic.Int64
	secondStarted := make(chan struct{})
	srv, store := debankHarness(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/portfolio/project_list":
			json.NewEncoder(w).Encode(map[string]any{"data": []any{}}) //nolint:errcheck
		case "/token/balance_list":
			call := balanceCalls.Add(1)
			if call == 1 {
				select {
				case <-secondStarted:
				case <-r.Context().Done():
					return
				}
			}
			if call == 2 {
				close(secondStarted)
			}
			json.NewEncoder(w).Encode(map[string]any{"data": []any{}}) //nolint:errcheck
		default:
			http.NotFound(w, r)
		}
	})

	// Hang-guard for SyncDue only. Started after openTestStore so slow
	// migrations on a loaded runner can't eat the budget before setup.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "stagger-user"})
	mustCreateEVMWallet(t, store, owner, evmWalletInput{Address: "0x1000000000000000000000000000000000000001", Name: "one", ChainIDs: []string{"eth"}})
	mustCreateEVMWallet(t, store, owner, evmWalletInput{Address: "0x2000000000000000000000000000000000000002", Name: "two", ChainIDs: []string{"eth"}})

	svc := newDebankTestService(t, srv, store)

	var staggerCalls atomic.Int32
	var staggerDelay atomic.Int64
	svc.Sleep = func(_ context.Context, delay time.Duration) error {
		staggerCalls.Add(1)
		staggerDelay.Store(int64(delay))
		return nil
	}

	done := make(chan error, 1)
	go func() { done <- svc.SyncDue(ctx, adapterSink(svc, store)) }()

	// The stagger delay is mocked to return instantly, so the second wallet's
	// sync still starts promptly even though its launch was staggered.
	select {
	case <-secondStarted:
	case <-time.After(2 * time.Second):
		cancel()
		t.Fatal("second wallet did not start while first wallet was blocked")
	}

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("SyncDue: %v", err)
		}
	case <-ctx.Done():
		t.Fatalf("SyncDue did not finish: %v", ctx.Err())
	}
	if balanceCalls.Load() != 2 {
		t.Fatalf("balance calls = %d, want 2", balanceCalls.Load())
	}
	if got := staggerCalls.Load(); got != 2 {
		t.Fatalf("stagger calls = %d, want 2", got)
	}
	if got := time.Duration(staggerDelay.Load()); got != walletSyncStagger {
		t.Fatalf("stagger delay = %v, want %v", got, walletSyncStagger)
	}
}

func TestSyncDueBoundsWalletConcurrencyAndCancelsQueuedWallets(t *testing.T) {
	var active atomic.Int64
	var maxActive atomic.Int64
	var started atomic.Int64
	reachedLimit := make(chan struct{}, 1)
	release := make(chan struct{})
	srv, store := debankHarness(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/portfolio/project_list":
			json.NewEncoder(w).Encode(map[string]any{"data": []any{}}) //nolint:errcheck
		case "/token/balance_list":
			started.Add(1)
			current := active.Add(1)
			defer active.Add(-1)
			for previous := maxActive.Load(); current > previous && !maxActive.CompareAndSwap(previous, current); previous = maxActive.Load() {
			}
			if current == walletSyncMaxConcurrent {
				reachedLimit <- struct{}{}
			}
			select {
			case <-release:
			case <-r.Context().Done():
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"data": []any{}}) //nolint:errcheck
		default:
			http.NotFound(w, r)
		}
	})
	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "concurrency-user"})
	for i := range walletSyncMaxConcurrent + 1 {
		mustCreateEVMWallet(t, store, owner, evmWalletInput{Address: fmt.Sprintf("0x%040d", i+1), ChainIDs: []string{"eth"}})
	}

	svc := newDebankTestService(t, srv, store)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- svc.SyncDue(ctx, adapterSink(svc, store)) }()

	select {
	case <-reachedLimit:
	case <-time.After(2 * time.Second):
		close(release)
		t.Fatal("wallet syncs did not reach the concurrency limit")
	}
	cancel()
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("SyncDue() error = %v", err)
	}
	if got := maxActive.Load(); got != walletSyncMaxConcurrent {
		t.Fatalf("max active syncs = %d, want %d", got, walletSyncMaxConcurrent)
	}
	if got := started.Load(); got != walletSyncMaxConcurrent {
		t.Fatalf("started wallet syncs = %d, want queued wallet skipped after cancellation", got)
	}
}

func TestSyncWalletMissingAccount(t *testing.T) {
	ctx := context.Background()
	srv := debankServer(t, nil)

	store := openTestStore(t)

	svc := newDebankTestService(t, srv, store)

	// Wallet with an ID that has no matching account should return an error.
	wallet := accounts.EVMWallet{ID: 999, Address: "0xaaaa", ChainIDs: []string{"eth"}}
	err := svc.SyncWalletInto(ctx, wallet, "0 0 * * *", adapterSink(svc, store))
	if err == nil {
		t.Error("expected error for wallet with no account, got nil")
	}
}

func TestSyncWalletAPIError(t *testing.T) {
	ctx := context.Background()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "upstream error", http.StatusBadGateway)
	}))
	defer srv.Close()

	store := openTestStore(t)

	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "erruser"})
	conn, _, _ := store.CreateEVMWallet(ctx, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", owner.ID.Int64(), "", []string{"eth"})
	wallet, _ := store.EVMWalletByConnectionID(ctx, conn.ID.Int64())

	svc := newDebankTestService(t, srv, store)

	err := svc.SyncWalletInto(ctx, *wallet, "0 0 * * *", adapterSink(svc, store))
	if err == nil {
		t.Error("expected error for API failure, got nil")
	}
}

func TestSyncWalletAbortsWhenSelectedChainFetchFails(t *testing.T) {
	ctx := context.Background()
	srv, store := debankHarness(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/portfolio/project_list":
			json.NewEncoder(w).Encode(map[string]any{"data": []any{}}) //nolint:errcheck
		case "/token/balance_list":
			if r.URL.Query().Get("chain") == "base" {
				http.Error(w, "base unavailable", http.StatusBadGateway)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"data": []apiClients.TokenBalance{ //nolint:errcheck
				{Chain: "eth", ID: "eth", Symbol: "ETH", Name: "Ethereum", Price: 2500, Amount: 1, USDValue: 2500},
			}})
		default:
			http.NotFound(w, r)
		}
	})
	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "partial-chain-user"})
	conn, account := mustCreateEVMWallet(t, store, owner, evmWalletInput{Address: "0x3333333333333333333333333333333333333333", ChainIDs: []string{"eth", "base"}})
	wallet := mustEVMWallet(t, store, conn.ID.Int64())
	svc := newDebankTestService(t, srv, store)

	err := svc.SyncWalletInto(ctx, *wallet, "0 0 * * *", adapterSink(svc, store))
	if err == nil {
		t.Fatal("SyncWalletInto() error = nil, want chain fetch failure")
	}
	count, err := store.AccountBalanceSnapshotDayCount(ctx, account.ID.Int64())
	must.NoErr(t, err)
	if count != 0 {
		t.Fatalf("snapshot count = %d, want 0", count)
	}
	updated := mustEVMWallet(t, store, conn.ID.Int64())
	if updated.NextBalanceSyncAt != nil {
		t.Fatalf("NextBalanceSyncAt = %v, want nil after failed sync", updated.NextBalanceSyncAt)
	}
}

func TestSyncWalletPersistsCleanSnapshotWhenSelectedChainReturnsNoHoldings(t *testing.T) {
	ctx := context.Background()
	tokens := []apiClients.TokenBalance{{Chain: "eth", ID: "eth", Symbol: "ETH", Name: "Ethereum", Price: 2500, Amount: 1, USDValue: 2500}}
	srv := debankServer(t, tokens)
	store := openTestStore(t)
	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "omitted-chain-user"})
	conn, account := mustCreateEVMWallet(t, store, owner, evmWalletInput{Address: "0x4444444444444444444444444444444444444444", ChainIDs: []string{"eth", "base"}})
	wallet := mustEVMWallet(t, store, conn.ID.Int64())
	base := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	yesterday := base.AddDate(0, 0, -1).Format(time.DateOnly)
	today := base.Format(time.DateOnly)
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  account.ID.Int64(),
		Source:     syncerids.Debank.Str(),
		Date:       yesterday,
		SyncedAt:   yesterday + "T12:00:00Z",
		BalanceUSD: money.FromDollars(3000),
		Holdings: []wealth.AssetDailyHolding{
			cryptoSnapshotHolding("eth:eth", 2500, 1),
			cryptoSnapshotHolding("base:usdc", 1, 500),
		},
	})

	svc := newDebankTestService(t, srv, store)
	svc.Now = func() time.Time { return base }
	sleepCalled := false
	svc.Sleep = func(context.Context, time.Duration) error {
		sleepCalled = true
		return nil
	}
	must.NoErr(t, svc.SyncWalletInto(ctx, *wallet, "0 0 * * *", adapterSink(svc, store)))
	if sleepCalled {
		t.Fatal("selected-chain omission should not trigger retry sleep")
	}
	values := snapshotValuesOnDate(t, ctx, store, today)
	if len(values) != 1 || snapshotBalance(values) != 2500 {
		t.Fatalf("snapshot values = %#v, want clean 2500 snapshot", values)
	}
	assertNoWalletReview(t, ctx, store)
}

func TestSyncWalletPersistsCleanEmptyWalletSnapshot(t *testing.T) {
	ctx := context.Background()
	srv := debankServer(t, nil)
	store := openTestStore(t)
	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "empty-wallet-user"})
	conn, account := mustCreateEVMWallet(t, store, owner, evmWalletInput{Address: "0x5555555555555555555555555555555555555555", ChainIDs: []string{"eth", "base"}})
	wallet := mustEVMWallet(t, store, conn.ID.Int64())
	base := time.Date(2026, 6, 16, 12, 0, 0, 0, time.UTC)
	yesterday := base.AddDate(0, 0, -1).Format(time.DateOnly)
	today := base.Format(time.DateOnly)
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  account.ID.Int64(),
		Source:     syncerids.Debank.Str(),
		Date:       yesterday,
		SyncedAt:   yesterday + "T12:00:00Z",
		BalanceUSD: money.FromDollars(2500),
		Holdings:   []wealth.AssetDailyHolding{cryptoSnapshotHolding("eth:eth", 2500, 1)},
	})

	svc := newDebankTestService(t, srv, store)
	svc.Now = func() time.Time { return base }
	sleepCalled := false
	svc.Sleep = func(context.Context, time.Duration) error {
		sleepCalled = true
		return nil
	}
	must.NoErr(t, svc.SyncWalletInto(ctx, *wallet, "0 0 * * *", adapterSink(svc, store)))
	if sleepCalled {
		t.Fatal("empty provider response should not trigger retry sleep")
	}
	values := snapshotValuesOnDate(t, ctx, store, today)
	if len(values) != 1 || snapshotBalance(values) != 0 {
		t.Fatalf("snapshot values = %#v, want clean zero snapshot", values)
	}
	holdings, err := store.CurrentHoldings(ctx, wealth.AccountFilter{AccountIDs: []int64{account.ID.Int64()}})
	must.NoErr(t, err)
	if len(holdings) != 0 {
		t.Fatalf("current holdings = %#v, want none", holdings)
	}
	assertNoWalletReview(t, ctx, store)
}

func TestSyncWalletPersistsKnownExplicitZeroHolding(t *testing.T) {
	ctx := context.Background()
	srv, store := debankHarness(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/portfolio/project_list":
			json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{ //nolint:errcheck
				"id":   "zero-project",
				"name": "Zero Project",
				"portfolio_item_list": []any{map[string]any{
					"pool":  map[string]any{"id": "0xpool", "chain": "eth"},
					"stats": map[string]any{"net_usd_value": 0},
				}},
			}}})
		case "/token/balance_list":
			json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{ //nolint:errcheck
				"chain":     "eth",
				"id":        "zero",
				"symbol":    "ZERO",
				"name":      "Zero Token",
				"price":     1,
				"amount":    10,
				"usd_value": 0,
			}}})
		default:
			http.NotFound(w, r)
		}
	})
	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "known-zero-user"})
	conn, account := mustCreateEVMWallet(t, store, owner, evmWalletInput{Address: "0x6666666666666666666666666666666666666666", ChainIDs: []string{"eth"}})
	wallet := mustEVMWallet(t, store, conn.ID.Int64())
	base := time.Date(2026, 6, 17, 12, 0, 0, 0, time.UTC)
	yesterday := base.AddDate(0, 0, -1).Format(time.DateOnly)
	today := base.Format(time.DateOnly)
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  account.ID.Int64(),
		Source:     syncerids.Debank.Str(),
		Date:       yesterday,
		SyncedAt:   yesterday + "T12:00:00Z",
		BalanceUSD: money.FromDollars(10),
		Holdings: []wealth.AssetDailyHolding{
			cryptoSnapshotHolding("eth:zero", 1, 10),
			cryptoSnapshotHolding("eth:0xpool", 1, 10),
		},
	})

	svc := newDebankTestService(t, srv, store)
	svc.Now = func() time.Time { return base }
	sleepCalled := false
	svc.Sleep = func(context.Context, time.Duration) error {
		sleepCalled = true
		return nil
	}
	must.NoErr(t, svc.SyncWalletInto(ctx, *wallet, "0 0 * * *", adapterSink(svc, store)))
	if sleepCalled {
		t.Fatal("explicit zero holding should not trigger retry sleep")
	}
	values := snapshotValuesOnDate(t, ctx, store, today)
	if len(values) != 1 || snapshotBalance(values) != 0 {
		t.Fatalf("snapshot values = %#v, want clean zero snapshot", values)
	}
	holdings, err := store.CurrentHoldings(ctx, wealth.AccountFilter{AccountIDs: []int64{account.ID.Int64()}})
	must.NoErr(t, err)
	if len(holdings) != 2 || zeroHoldingValue(holdings, "eth:zero") != 0 || zeroHoldingValue(holdings, "eth:0xpool") != 0 {
		t.Fatalf("current holdings = %#v, want known zero token and project", holdings)
	}
	assertNoWalletReview(t, ctx, store)
}

func TestSyncWalletSkipsMalformedUnselectedProjectItem(t *testing.T) {
	ctx := context.Background()
	srv, store := debankHarness(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/portfolio/project_list":
			json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{ //nolint:errcheck
				"id":   "mixed-project",
				"name": "Mixed Project",
				"portfolio_item_list": []any{
					map[string]any{"pool": map[string]any{"id": "0xeth", "chain": "eth"}, "stats": map[string]any{"net_usd_value": 125}},
					map[string]any{"pool": map[string]any{"id": "0xbase", "chain": "base"}, "stats": map[string]any{}},
				},
			}}})
		case "/token/balance_list":
			json.NewEncoder(w).Encode(map[string]any{"data": []any{}}) //nolint:errcheck
		default:
			http.NotFound(w, r)
		}
	})
	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "unselected-project-user"})
	conn, account := mustCreateEVMWallet(t, store, owner, evmWalletInput{Address: "0x7777777777777777777777777777777777777777", ChainIDs: []string{"eth"}})
	wallet := mustEVMWallet(t, store, conn.ID.Int64())
	svc := newDebankTestService(t, srv, store)

	must.NoErr(t, svc.SyncWalletInto(ctx, *wallet, "0 0 * * *", adapterSink(svc, store)))
	values := snapshotValuesOnDate(t, ctx, store, svc.now().Format(time.DateOnly))
	if len(values) != 1 || snapshotBalance(values) != 125 {
		t.Fatalf("snapshot values = %#v, want selected project value", values)
	}
	holdings, err := store.CurrentHoldings(ctx, wealth.AccountFilter{AccountIDs: []int64{account.ID.Int64()}})
	must.NoErr(t, err)
	if len(holdings) != 1 || holdings[0].Asset.Identifier != "eth:0xeth" {
		t.Fatalf("current holdings = %#v, want selected project only", holdings)
	}
}

func TestSyncWalletAbortsOnMalformedSelectedProjectItem(t *testing.T) {
	ctx := context.Background()
	srv, store := debankHarness(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/portfolio/project_list":
			json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{ //nolint:errcheck
				"id":   "bad-project",
				"name": "Bad Project",
				"portfolio_item_list": []any{map[string]any{
					"pool":  map[string]any{"id": "0xeth", "chain": "eth"},
					"stats": map[string]any{},
				}},
			}}})
		case "/token/balance_list":
			json.NewEncoder(w).Encode(map[string]any{"data": []any{}}) //nolint:errcheck
		default:
			http.NotFound(w, r)
		}
	})
	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "selected-project-user"})
	conn, account := mustCreateEVMWallet(t, store, owner, evmWalletInput{Address: "0x8888888888888888888888888888888888888888", ChainIDs: []string{"eth"}})
	wallet := mustEVMWallet(t, store, conn.ID.Int64())
	svc := newDebankTestService(t, srv, store)

	if err := svc.SyncWalletInto(ctx, *wallet, "0 0 * * *", adapterSink(svc, store)); err == nil {
		t.Fatal("SyncWalletInto() error = nil, want malformed selected project failure")
	}
	count, err := store.AccountBalanceSnapshotDayCount(ctx, account.ID.Int64())
	must.NoErr(t, err)
	if count != 0 {
		t.Fatalf("snapshot count = %d, want 0", count)
	}
	updated := mustEVMWallet(t, store, conn.ID.Int64())
	if updated.NextBalanceSyncAt != nil {
		t.Fatalf("NextBalanceSyncAt = %v, want nil after failed sync", updated.NextBalanceSyncAt)
	}
}

// TestSyncDueWithFailingWallet covers the error-log branch in SyncDue when a wallet sync fails.
func TestSyncDueWithFailingWallet(t *testing.T) {
	ctx := context.Background()
	// Server that always returns an error.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "server error", http.StatusInternalServerError)
	}))
	defer srv.Close()

	store := openTestStore(t)

	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "failuser"})
	store.CreateEVMWallet(ctx, "0xdddddddddddddddddddddddddddddddddddddddd", owner.ID.Int64(), "", []string{"eth"}) //nolint:errcheck

	svc := newDebankTestService(t, srv, store)

	// SyncDue should not return an error — wallet failures are logged, not propagated.
	must.NoErr(t, svc.SyncDue(ctx, adapterSink(svc, store)))
}

// TestSyncWalletFlagsDeviatingSnapshot verifies that a snapshot whose holding price
// exceeds the deviation threshold is retried with backoff, then flagged with the prior
// balance carried forward once the retry window is exhausted.
func TestSyncWalletFlagsDeviatingSnapshot(t *testing.T) {
	ctx := context.Background()

	spikeTokens := []apiClients.TokenBalance{
		{Chain: "opbnb", ID: "usdt", Symbol: "USDT", Name: "Tether", Price: 150, Amount: 500_000, USDValue: 75_000_000},
	}

	srv := debankServer(t, spikeTokens)

	store := openTestStore(t)

	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "spike-user"})
	conn, account := mustCreateEVMWallet(t, store, owner, evmWalletInput{Address: "0xf2347000000000000000000000000000004012", Name: "wallet", ChainIDs: []string{"opbnb"}})
	wallet := mustEVMWallet(t, store, conn.ID.Int64())

	// Seed a prior-day snapshot (yesterday) with a normal balance (~$110k).
	const priorBalance = 110_108.92
	priorBalanceCents := money.FromDollars(priorBalance)
	base := time.Date(2026, 6, 15, 9, 0, 0, 0, time.UTC)
	yesterday := base.AddDate(0, 0, -1).Format("2006-01-02")
	today := base.Format("2006-01-02")
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  account.ID.Int64(),
		Source:     "debank",
		Date:       yesterday,
		SyncedAt:   yesterday + "T12:00:00Z",
		BalanceUSD: priorBalanceCents,
		Holdings:   []wealth.AssetDailyHolding{cryptoSnapshotHolding("opbnb:usdt", 1, priorBalance)},
	})

	svc := newDebankTestService(t, srv, store)
	clock := base
	svc.Now = func() time.Time { return clock }
	svc.Sleep = func(_ context.Context, delay time.Duration) error {
		clock = clock.Add(delay)
		return nil
	}

	// The spike never resolves, so the retry loop should run until the deadline
	// and then persist a flagged carry-forward snapshot.
	must.NoErr(t, svc.SyncWalletInto(ctx, *wallet, "0 0 * * *", adapterSink(svc, store)))
	if !clock.Equal(base.Add(2 * time.Hour)) {
		t.Fatalf("retry clock = %v, want %v", clock, base.Add(2*time.Hour))
	}

	// The net-worth series for today should show the carry-forward balance, not the spike.
	values := snapshotValuesOnDate(t, ctx, store, today)
	if len(values) != 1 {
		t.Fatalf("snapshot values len = %d, want 1", len(values))
	}
	const spikeValue = 71_000_000.0
	balance := snapshotBalance(values)
	if balance > spikeValue {
		t.Fatalf("snapshot balance = %.2f; spike was not suppressed", balance)
	}
	if balance < 50_000 {
		t.Fatalf("snapshot balance = %.2f; carry-forward too low, expected ~$110k", balance)
	}

	// Holdings for the flagged snapshot should be carried from the prior clean snapshot.
	holdings, err := store.CurrentHoldings(ctx, wealth.AccountFilter{
		AccountIDs: []int64{account.ID.Int64()},
	})
	must.NoErr(t, err)
	if len(holdings) != 1 || holdings[0].ValueUSD != priorBalanceCents {
		t.Fatalf("holdings after flagged snapshot = %#v", holdings)
	}
	reviews, err := store.ListInReviewBalanceReviews(ctx)
	must.NoErr(t, err)
	if len(reviews) != 1 || reviews[0].AccountID != account.ID.Int64() || reviews[0].ProviderBalanceUSD < money.FromDollars(50_000_000) || reviews[0].CarryForwardBalanceUSD != priorBalanceCents {
		t.Fatalf("balance reviews = %#v", reviews)
	}
}

func TestSyncWalletAutoCarryForwardsApprovedReview(t *testing.T) {
	ctx := context.Background()
	spikeTokens := []apiClients.TokenBalance{
		{Chain: "opbnb", ID: "usdt", Symbol: "USDT", Name: "Tether", Price: 150, Amount: 460_000, USDValue: 69_000_000},
	}
	srv := debankServer(t, spikeTokens)

	store := openTestStore(t)
	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "approved-review-user"})
	conn, account := mustCreateEVMWallet(t, store, owner, evmWalletInput{Address: "0xf2347000000000000000000000000000007777", Name: "wallet", ChainIDs: []string{"opbnb"}})
	wallet := mustEVMWallet(t, store, conn.ID.Int64())

	const priorBalance = 110_000.0
	const providerBalance = 69_000_000.0
	priorBalanceCents := money.FromDollars(priorBalance)
	base := time.Date(2026, 6, 15, 9, 0, 0, 0, time.UTC)
	twoDaysAgo := base.AddDate(0, 0, -2).Format("2006-01-02")
	yesterday := base.AddDate(0, 0, -1).Format("2006-01-02")
	today := base.Format("2006-01-02")
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  account.ID.Int64(),
		Source:     "debank",
		Date:       twoDaysAgo,
		SyncedAt:   twoDaysAgo + "T12:00:00Z",
		BalanceUSD: priorBalanceCents,
		Holdings:   []wealth.AssetDailyHolding{cryptoSnapshotHolding("opbnb:usdt", 1, priorBalance)},
	})
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  account.ID.Int64(),
		Source:     "debank",
		Date:       yesterday,
		SyncedAt:   yesterday + "T12:00:00Z",
		BalanceUSD: priorBalanceCents,
		Holdings:   []wealth.AssetDailyHolding{cryptoSnapshotHolding("opbnb:usdt", 1, priorBalance)},
		Flagged:    true,
		FlagReason: "approved spike",
	})
	must.NoErr(t, store.UpsertBalanceReview(ctx, wealth.BalanceReviewUpsert{
		AccountID:              account.ID.Int64(),
		FirstFlaggedDate:       yesterday,
		LatestFlaggedDate:      yesterday,
		FlaggedSnapshotCount:   1,
		ProviderBalanceUSD:     money.FromDollars(providerBalance),
		CarryForwardBalanceUSD: priorBalanceCents,
		FlagReason:             "approved spike",
	}))
	reviews, err := store.ListInReviewBalanceReviews(ctx)
	if err != nil || len(reviews) != 1 {
		t.Fatalf("ListInReviewBalanceReviews = %#v, %v", reviews, err)
	}
	must.NoErr(t, store.ApproveBalanceReview(ctx, reviews[0].ID))

	svc := newDebankTestService(t, srv, store)
	svc.Now = func() time.Time { return base }
	sleepCalled := false
	svc.Sleep = func(context.Context, time.Duration) error {
		sleepCalled = true
		return nil
	}

	must.NoErr(t, svc.SyncWalletInto(ctx, *wallet, "0 0 * * *", adapterSink(svc, store)))
	if sleepCalled {
		t.Fatal("approved review should bypass retry sleep")
	}
	values := snapshotValuesOnDate(t, ctx, store, today)
	if len(values) != 1 || snapshotBalance(values) != priorBalance {
		t.Fatalf("snapshot values = %#v", values)
	}
	approved, err := store.GetApprovedBalanceReviewByAccount(ctx, account.ID.Int64())
	if err != nil || approved == nil {
		t.Fatalf("approved review = %#v, %v", approved, err)
	}
}

func TestSyncWalletRecoversFromPriceSpike(t *testing.T) {
	tests := map[string]struct {
		ownerName        string
		address          string
		base             time.Time
		seedDayOffsets   []int
		recoveredAfter   time.Duration
		assertRetrySleep bool
	}{
		"during backoff window": {
			ownerName: "recover-during-window", address: "0xf2347000000000000000000000000000006789",
			base: time.Date(2026, 6, 15, 9, 0, 0, 0, time.UTC), seedDayOffsets: []int{-1}, assertRetrySleep: true,
		},
		"after midnight persists new date": {
			ownerName: "midnight-recover", address: "0xf2347000000000000000000000000000006790",
			base: time.Date(2026, 6, 15, 23, 58, 0, 0, time.UTC), seedDayOffsets: []int{-1, 0}, recoveredAfter: 2 * time.Hour,
		},
	}
	spikeTokens := []apiClients.TokenBalance{
		{Chain: "eth", ID: "eth", Symbol: "ETH", Name: "Ethereum", Price: 250_000, Amount: 40, USDValue: 10_000_000},
	}
	normalTokens := []apiClients.TokenBalance{
		{Chain: "eth", ID: "eth", Symbol: "ETH", Name: "Ethereum", Price: 2500, Amount: 44, USDValue: 110_000},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			var spiking atomic.Bool
			spiking.Store(true)
			srv, store := debankHarness(t, func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/portfolio/project_list":
					json.NewEncoder(w).Encode(map[string]any{"data": []any{}}) //nolint:errcheck
				case "/token/balance_list":
					tokens := normalTokens
					if spiking.Load() {
						tokens = spikeTokens
					}
					json.NewEncoder(w).Encode(map[string]any{"data": tokensForChain(tokens, r.URL.Query().Get("chain"))}) //nolint:errcheck
				default:
					http.NotFound(w, r)
				}
			})

			owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: tc.ownerName})
			conn, account := mustCreateEVMWallet(t, store, owner, evmWalletInput{Address: tc.address, Name: "wallet", ChainIDs: []string{"eth"}})
			wallet := mustEVMWallet(t, store, conn.ID.Int64())
			for _, dayOffset := range tc.seedDayOffsets {
				date := tc.base.AddDate(0, 0, dayOffset).Format(time.DateOnly)
				mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
					AccountID:  account.ID.Int64(),
					Source:     "debank",
					Date:       date,
					SyncedAt:   date + "T12:00:00Z",
					BalanceUSD: money.FromDollars(110_000),
					Holdings:   []wealth.AssetDailyHolding{cryptoSnapshotHolding("eth:eth", 2500, 44)},
				})
			}

			svc := newDebankTestService(t, srv, store)
			clock := tc.base
			svc.Now = func() time.Time { return clock }
			var retrySleeps int
			svc.Sleep = func(_ context.Context, delay time.Duration) error {
				retrySleeps++
				spiking.Store(false)
				clock = clock.Add(delay)
				return nil
			}
			must.NoErr(t, svc.SyncWalletInto(ctx, *wallet, "0 0 * * *", adapterSink(svc, store)))
			if tc.assertRetrySleep && retrySleeps != 1 {
				t.Fatalf("retry sleeps = %d, want 1", retrySleeps)
			}

			recoveredDate := tc.base.Add(tc.recoveredAfter).Format(time.DateOnly)
			values := snapshotValuesOnDate(t, ctx, store, recoveredDate)
			if len(values) != 1 {
				t.Fatalf("snapshot values len for %s = %d, want 1", recoveredDate, len(values))
			}
			balance := snapshotBalance(values)
			if balance < 100_000 || balance > 120_000 {
				t.Fatalf("snapshot balance = %.2f, want clean retry balance", balance)
			}
		})
	}
}

// TestSyncWalletAutoRecovery verifies that when a sync day's holdings pass the sanity
// check after one or more flagged blip days, the flagged snapshots are automatically cleared.
func TestSyncWalletAutoRecovery(t *testing.T) {
	ctx := context.Background()

	normalTokens := []apiClients.TokenBalance{
		{Chain: "eth", ID: "eth", Symbol: "ETH", Name: "Ethereum", Price: 2500.0, Amount: 44.0, USDValue: 110_000.0},
	}

	srv := debankServer(t, normalTokens)

	store := openTestStore(t)

	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "recovery-user"})
	conn, account := mustCreateEVMWallet(t, store, owner, evmWalletInput{Address: "0xf2347000000000000000000000000000005555", Name: "wallet", ChainIDs: []string{"eth"}})
	wallet := mustEVMWallet(t, store, conn.ID.Int64())

	svc := newDebankTestService(t, srv, store)
	now := svc.now()
	twoDaysAgo := now.AddDate(0, 0, -2).Format("2006-01-02")
	yesterday := now.AddDate(0, 0, -1).Format("2006-01-02")
	today := now.Format("2006-01-02")

	// Seed an unflagged anchor snapshot two days ago (~$110k).
	anchorBalance := money.FromDollars(110_000.0)
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  account.ID.Int64(),
		Source:     "debank",
		Date:       twoDaysAgo,
		SyncedAt:   twoDaysAgo + "T12:00:00Z",
		BalanceUSD: anchorBalance,
		Holdings:   []wealth.AssetDailyHolding{cryptoSnapshotHolding("eth:eth", 2500, 44)},
	})

	// Seed a flagged blip snapshot for yesterday carrying the anchor balance.
	mustReplaceSnapshot(t, store, wealth.AccountBalanceSnapshot{
		AccountID:  account.ID.Int64(),
		Source:     "debank",
		Date:       yesterday,
		SyncedAt:   yesterday + "T12:00:00Z",
		BalanceUSD: anchorBalance,
		Flagged:    true,
		FlagReason: "simulated blip",
	})
	must.NoErr(t, store.UpsertBalanceReview(ctx, wealth.BalanceReviewUpsert{
		AccountID:              account.ID.Int64(),
		FirstFlaggedDate:       yesterday,
		LatestFlaggedDate:      yesterday,
		FlaggedSnapshotCount:   1,
		ProviderBalanceUSD:     10_000_000,
		CarryForwardBalanceUSD: anchorBalance,
		FlagReason:             "simulated blip",
	}))

	// Sync normal-looking holdings today (~$110k) — should pass the price check
	// against the anchor (twoDaysAgo) and auto-recover the blip (yesterday).
	must.NoErr(t, svc.SyncWalletInto(ctx, *wallet, "0 0 * * *", adapterSink(svc, store)))

	// Today's snapshot should be stored unflagged.
	values := snapshotValuesOnDate(t, ctx, store, today)
	if len(values) != 1 {
		t.Fatalf("snapshot values len = %d, want 1", len(values))
	}
	if balance := snapshotBalance(values); balance < 100_000 {
		t.Fatalf("snapshot balance = %.2f; expected ~$110k", balance)
	}

	// The blip (yesterday) should now also appear as unflagged.
	blipValues := snapshotValuesOnDate(t, ctx, store, yesterday)
	if len(blipValues) != 1 {
		t.Fatalf("blip snapshot values len = %d, want 1", len(blipValues))
	}
	// Verify yesterday's row is now unflagged via LatestUnflaggedSnapshotWithHoldings:
	// after auto-recovery, the latest unflagged snapshot before today should be yesterday.
	anchor, err := store.LatestUnflaggedSnapshotWithHoldings(ctx, account.ID.Int64(), today)
	must.NoErr(t, err)
	if !anchor.Found {
		t.Fatal("LatestUnflaggedSnapshotWithHoldings: no row found after recovery")
	}
	if anchor.Date != yesterday {
		t.Fatalf("latest unflagged date = %q, want %q (blip should be auto-recovered)", anchor.Date, yesterday)
	}
	if anchor.AmountUSD.Dollars() < 100_000 {
		t.Fatalf("latest unflagged balance = %.2f, expected ~$110k", anchor.AmountUSD.Dollars())
	}
	reviews, err := store.ListInReviewBalanceReviews(ctx)
	must.NoErr(t, err)
	if len(reviews) != 0 {
		t.Fatalf("recovered review still listed: %#v", reviews)
	}
}

// TestSyncDueOnlySyncsDueWallets verifies that SyncDue (the periodic background
// path) only syncs wallets whose next_balance_sync_at is due, while a wallet
// scheduled in the future is left untouched.
func TestSyncDueOnlySyncsDueWallets(t *testing.T) {
	ctx := context.Background()
	srv := debankServer(t, nil)

	store := openTestStore(t)

	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "due-test"})
	dueConn, _ := mustCreateEVMWallet(t, store, owner, evmWalletInput{Address: "0x1111111111111111111111111111111111111111", Name: "due", ChainIDs: []string{"eth"}})
	notDueConn, _ := mustCreateEVMWallet(t, store, owner, evmWalletInput{Address: "0x2222222222222222222222222222222222222222", Name: "not-due", ChainIDs: []string{"eth"}})
	notDueWallet := mustEVMWallet(t, store, notDueConn.ID.Int64())
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	if _, err := store.SQL().ExecContext(
		ctx,
		`UPDATE balance_sync_schedules SET balance_sync_cron = '0 9 * * *' WHERE id = 'debank'`,
	); err != nil {
		t.Fatalf("update debank balance schedule: %v", err)
	}
	future := now.Add(24 * time.Hour)
	must.NoErr(t, store.SetEVMWalletBalanceSynced(ctx, notDueWallet.ID, future))

	svc := newDebankTestService(t, srv, store)
	svc.Now = func() time.Time { return now }

	must.NoErr(t, svc.SyncDue(ctx, adapterSink(svc, store)))

	dueAfter, err := store.EVMWalletByConnectionID(ctx, dueConn.ID.Int64())
	must.NoErr(t, err)
	if dueAfter.NextBalanceSyncAt == nil {
		t.Fatal("expected due wallet to have NextBalanceSyncAt scheduled after SyncDue")
	}
	expected := time.Date(2026, 6, 1, 13, 0, 0, 0, time.UTC)
	if !dueAfter.NextBalanceSyncAt.Equal(expected) {
		t.Fatalf("due wallet NextBalanceSyncAt = %v, want %v", dueAfter.NextBalanceSyncAt, expected)
	}

	notDueAfter, err := store.EVMWalletByConnectionID(ctx, notDueConn.ID.Int64())
	must.NoErr(t, err)
	if notDueAfter.NextBalanceSyncAt == nil || !notDueAfter.NextBalanceSyncAt.Equal(future.Truncate(time.Second)) {
		t.Fatalf("expected not-due wallet's NextBalanceSyncAt to remain unchanged at %v, got %v", future, notDueAfter.NextBalanceSyncAt)
	}
}

func newDebankTestService(t *testing.T, srv *httptest.Server, store *evmTestStore) *Adapter {
	t.Helper()
	svc := New(srv.Client(), store, store, store, test.Logger)
	svc.client.BaseURL = srv.URL
	svc.Now = func() time.Time { return time.Date(2026, time.June, 1, 12, 0, 0, 0, time.UTC) }
	svc.Sleep = func(context.Context, time.Duration) error { return nil }
	return svc
}

func debankHarness(t *testing.T, handler http.HandlerFunc) (*httptest.Server, *evmTestStore) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	store := openTestStore(t)
	return srv, store
}

func debankServer(t *testing.T, tokens []apiClients.TokenBalance) *httptest.Server {
	t.Helper()
	if tokens == nil {
		tokens = []apiClients.TokenBalance{}
	}
	projects := []any{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/portfolio/project_list":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": projects})
		case "/token/balance_list":
			_ = json.NewEncoder(w).Encode(map[string]any{"data": tokensForChain(tokens, r.URL.Query().Get("chain"))})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

type evmTestStore struct {
	*test.Store
	*evmAccountStore
	*evmWealthStore
}

type evmAccountStore struct{ *accountsdb.Store }
type evmWealthStore struct{ *wealthdb.Store }

type evmWalletInput struct {
	Address  string
	Name     string
	ChainIDs []string
}

// AccountByID disambiguates the method promoted from both embedded stores.
func (s *evmTestStore) AccountByID(ctx context.Context, id int64) (*model.Account, error) {
	return s.evmWealthStore.AccountByID(ctx, id)
}

func mustCreateEVMWallet(tb testing.TB, store *evmTestStore, owner *model.Owner, input evmWalletInput) (*model.Connection, *model.Account) {
	tb.Helper()
	connection, account, err := store.CreateEVMWallet(context.Background(), input.Address, owner.ID.Int64(), input.Name, input.ChainIDs)
	must.NoErr(tb, err)
	return connection, account
}

func mustEVMWallet(tb testing.TB, store *evmTestStore, connectionID int64) *accounts.EVMWallet {
	tb.Helper()
	wallet, err := store.EVMWalletByConnectionID(context.Background(), connectionID)
	must.NoErr(tb, err)
	return wallet
}

func mustReplaceSnapshot(t *testing.T, store *evmTestStore, snapshot wealth.AccountBalanceSnapshot) {
	t.Helper()
	must.NoErr(t, store.ReplaceAccountBalanceSnapshot(context.Background(), snapshot))
}

func cryptoSnapshotHolding(identifier string, price, quantity float64) wealth.AssetDailyHolding {
	name := identifier
	return wealth.AssetDailyHolding{
		Asset: &wealth.AssetUpsert{
			AssetType:  model.AssetTypeCrypto,
			Identifier: identifier,
			Name:       &name,
			Classifier: model.AssetClassifierCryptocurrency,
		},
		Quantity:          &quantity,
		Price:             &price,
		ValueUSD:          price * quantity,
		CountsTowardValue: true,
	}
}

func snapshotValuesOnDate(t *testing.T, ctx context.Context, store *evmTestStore, date string) []wealth.SnapshotValue {
	t.Helper()
	start, err := time.Parse(time.DateOnly, date)
	must.NoErr(t, err)
	values, err := store.AccountBalanceSnapshotValues(
		ctx,
		start.Format(time.RFC3339),
		start.AddDate(0, 0, 1).Format(time.RFC3339),
		wealth.AccountFilter{},
	)
	must.NoErr(t, err)
	return values
}

func snapshotBalance(values []wealth.SnapshotValue) float64 {
	toBalanceUSD := func(value wealth.SnapshotValue) money.Cents { return value.BalanceUSD }
	return lo.SumBy(values, toBalanceUSD).Dollars()
}

func zeroHoldingValue(holdings []wealth.CurrentHolding, identifier string) money.Cents {
	for _, holding := range holdings {
		if holding.Asset.Identifier == identifier {
			return holding.ValueUSD
		}
	}
	return -1
}

func assertNoWalletReview(t *testing.T, ctx context.Context, store *evmTestStore) {
	t.Helper()
	reviews, err := store.ListInReviewBalanceReviews(ctx)
	must.NoErr(t, err)
	if len(reviews) != 0 {
		t.Fatalf("balance reviews = %#v, want none", reviews)
	}
}

func openTestStore(t *testing.T) *evmTestStore {
	t.Helper()
	store := test.OpenStore(t)
	return &evmTestStore{
		Store:           store,
		evmAccountStore: &evmAccountStore{Store: accountsdb.New(store.Database())},
		evmWealthStore:  &evmWealthStore{Store: wealthdb.New(store.Database())},
	}
}

func adapterSink(svc *Adapter, store *evmTestStore) wealth.PersistSink {
	now := svc.now()
	return (&wealth.SnapshotPersister{Wealth: store}).WithRun(wealth.UTCDate(now), now)
}
