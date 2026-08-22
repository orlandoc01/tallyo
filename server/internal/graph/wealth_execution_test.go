package graph

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/99designs/gqlgen/client"

	"tallyo/internal/auth"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
	"tallyo/internal/wealth"
)

func TestWealthGraphQLExecution(t *testing.T) {
	ctx := allScopesCtx()
	store := openGraphTestStore(t)
	account := mustSeedGraphAccount(t, store, "cash", "alex", "Checking", model.AccountTypeDepository)
	accountID := account.ID.Int64()
	balance := 123.0
	usdPrice := 1.0
	must.NoErr(t, store.WealthDB.ReplaceAccountBalanceSnapshot(context.Background(), wealth.AccountBalanceSnapshot{
		AccountID: accountID, Source: "plaid", Date: "2026-06-01", SyncedAt: "2026-06-01T21:00:00Z",
		BalanceUSD: money.FromDollars(balance),
		Holdings:   []wealth.AssetDailyHolding{{AssetID: 1, Quantity: &balance, Price: &usdPrice, ValueUSD: balance, CountsTowardValue: true}},
	}))
	resolver := &Resolver{AccountsStore: store.Accounts, WealthDB: store.WealthDB, Wealth: testWealthService(store.WealthDB)}
	c := client.New(newExecServer(resolver))

	var netWorthResp struct {
		NetWorth struct {
			CurrentNetWorthUSD    float64
			CurrentAssetsUSD      float64
			CurrentLiabilitiesUSD float64
			Series                []struct {
				Date                string
				TotalAssetsUSD      float64
				TotalLiabilitiesUSD float64
				NetWorthUSD         float64
			}
			ClassifierBreakdown []struct {
				Classifier      string
				Label           string
				ValueUSD        float64
				PercentOfAssets float64
				AssetCount      int
				Holdings        []struct {
					TotalQuantity       *float64
					ValueUSD            float64
					PercentOfClassifier float64
					Asset               struct {
						ID           string
						AssetType    string
						Identifier   string
						Name         string
						Classifier   string
						CurrentPrice *float64
					}
					Holdings []struct {
						AssetID   string
						AccountID string
						Quantity  *float64
						ValueUSD  float64
						Manual    bool
						Account   struct {
							ID             string
							Name           string
							Type           string
							LatestSnapshot *struct {
								BalanceUSD         float64
								NetContributionUSD float64
							}
							LastSyncedAt *string
							Owner        struct {
								ID   string
								Name string
							}
						}
					}
				}
			}
		}
	}
	c.MustPost(`query($input: NetWorthInput!) {
		netWorth(input: $input) {
			currentNetWorthUSD
			currentAssetsUSD
			currentLiabilitiesUSD
			classifierBreakdown {
				classifier
				label
				valueUSD
				percentOfAssets
				assetCount
				holdings {
					totalQuantity
					valueUSD
					percentOfClassifier
					asset { id assetType identifier name classifier currentPrice }
					holdings {
						assetId
						accountId
						quantity
						valueUSD
						manual
						account { id name type latestSnapshot { balanceUSD netContributionUSD } lastSyncedAt owner { id name } }
					}
				}
			}
		}
	}`, &netWorthResp, client.Var("input", map[string]any{}), client.AddHeader("Authorization", "Bearer test"), withCtx(ctx))
	if netWorthResp.NetWorth.CurrentNetWorthUSD != 123 {
		t.Fatalf("netWorth response = %#v", netWorthResp)
	}
	if len(netWorthResp.NetWorth.ClassifierBreakdown) != 1 || len(netWorthResp.NetWorth.ClassifierBreakdown[0].Holdings) != 1 {
		t.Fatalf("netWorth response = %#v", netWorthResp)
	}
	rollupHoldings := netWorthResp.NetWorth.ClassifierBreakdown[0].Holdings[0].Holdings
	if len(rollupHoldings) != 1 || rollupHoldings[0].Account.Name != "Checking" || rollupHoldings[0].ValueUSD != 123 {
		t.Fatalf("holding rows = %#v", rollupHoldings)
	}

}

func TestAccountWealthFieldsRequireWealthScope(t *testing.T) {
	store := openGraphTestStore(t)
	mustSeedGraphAccount(t, store, "wealth-scope-account", "wealth-scope", "Checking", model.AccountTypeDepository)
	resolver := &Resolver{AccountsStore: store.Accounts, WealthDB: store.WealthDB}
	c := client.New(newExecServer(resolver))
	ctx := auth.ContextWithScopes(context.Background(), []string{auth.ScopeReadAccounts})

	var resp map[string]any
	err := c.Post(`query { accounts { items { id latestSnapshot { id } accountWealthProperty { __typename } } } }`, &resp, withCtx(ctx))
	if err == nil || !strings.Contains(err.Error(), auth.ScopeReadWealth) {
		t.Fatalf("accounts wealth field error = %v, want missing wealth scope", err)
	}
}

func TestWealthGraphQLExecutionPreservesUnknownQuantity(t *testing.T) {
	ctx := allScopesCtx()
	store := openGraphTestStore(t)
	account := mustSeedGraphAccount(t, store, "stables-wallet", "alex", "Stables Wallet", model.AccountTypeCryptoWallet)
	asset := mustUpsertAsset(t, store.WealthDB, wealth.AssetUpsert{
		AssetType:  model.AssetTypeCrypto,
		Identifier: "base:moo-aero",
		Classifier: model.AssetClassifierStablecoin,
	})
	must.NoErr(t, store.WealthDB.ReplaceAccountBalanceSnapshot(context.Background(), wealth.AccountBalanceSnapshot{
		AccountID: account.ID.Int64(), Source: "debank", Date: "2026-07-23", SyncedAt: "2026-07-23T21:02:33Z",
		BalanceUSD: money.FromDollars(76_714.93),
		Holdings:   []wealth.AssetDailyHolding{{AssetID: asset.ID.Int64(), ValueUSD: 76_714.93, CountsTowardValue: true}},
	}))
	resolver := &Resolver{AccountsStore: store.Accounts, WealthDB: store.WealthDB, Wealth: testWealthService(store.WealthDB)}
	historical, err := resolver.HistoricalNetWorth(ctx, model.HistoricalNetWorthInput{Range: model.NetWorthRangeOneMonth})
	if err != nil || len(historical.ClassifierSeries) == 0 {
		t.Fatalf("HistoricalNetWorth() = %#v, %v", historical, err)
	}
	c := client.New(newExecServer(resolver))
	resp, err := c.RawPost(`query($id: ID!, $input: NetWorthInput!) {
		account(id: $id) { latestSnapshot { holdings { quantity } } }
		netWorth(input: $input) { classifierBreakdown { holdings { totalQuantity } } }
	}`, client.Var("id", account.ID), client.Var("input", map[string]any{}), client.AddHeader("Authorization", "Bearer test"), withCtx(ctx))
	must.NoErr(t, err)
	data, err := json.Marshal(resp.Data)
	must.NoErr(t, err)
	want := `{"account":{"latestSnapshot":{"holdings":[{"quantity":null}]}},"netWorth":{"classifierBreakdown":[{"holdings":[{"totalQuantity":null}]}]}}`
	if string(data) != want {
		t.Fatalf("response data = %s, want %s", data, want)
	}
}

func TestAccountsLatestSnapshotExecutionUsesPerAccountSnapshots(t *testing.T) {
	ctx := allScopesCtx()
	store := openGraphTestStore(t)
	owner := test.MustCreateOwner(t, store.Accounts, model.CreateOwnerInput{Name: "alex"})
	first := &model.Account{Owner: owner, Name: "Cash One", Type: model.AccountTypeDepository}
	second := &model.Account{Owner: owner, Name: "Cash Two", Type: model.AccountTypeDepository}
	test.MustUpsertAccount(t, store.Accounts, "cash-one", first)
	test.MustUpsertAccount(t, store.Accounts, "cash-two", second)
	assetName := "US Dollar"
	asset := mustUpsertAsset(t, store.WealthDB, wealth.AssetUpsert{
		AssetType:  model.AssetTypeCurrency,
		Identifier: "USD:latest-snapshot-exec",
		Name:       &assetName,
		Classifier: model.AssetClassifierCash,
	})
	firstID := first.ID.Int64()
	secondID := second.ID.Int64()
	seedGraphSnapshot(t, ctx, store, firstID, asset.ID.Int64(), "2026-06-01", 111)
	seedGraphSnapshot(t, ctx, store, secondID, asset.ID.Int64(), "2026-06-02", 222)

	resolver := &Resolver{AccountsStore: store.Accounts, WealthDB: store.WealthDB, Wealth: testWealthService(store.WealthDB)}
	c := client.New(newExecServer(resolver))
	var resp struct {
		Accounts struct {
			Items []struct {
				Name           string
				LatestSnapshot *struct {
					BalanceUSD float64
					Date       string
				}
			}
		}
	}
	c.MustPost(`query {
		accounts { items { name latestSnapshot { balanceUSD date } } }
	}`, &resp, withCtx(ctx))

	balancesByName := map[string]float64{}
	datesByName := map[string]string{}
	for _, item := range resp.Accounts.Items {
		if item.LatestSnapshot != nil {
			balancesByName[item.Name] = item.LatestSnapshot.BalanceUSD
			datesByName[item.Name] = item.LatestSnapshot.Date
		}
	}
	if balancesByName["Cash One"] != 111 || datesByName["Cash One"] != "2026-06-01" {
		t.Fatalf("Cash One latest snapshot = balance %v date %q", balancesByName["Cash One"], datesByName["Cash One"])
	}
	if balancesByName["Cash Two"] != 222 || datesByName["Cash Two"] != "2026-06-02" {
		t.Fatalf(
			"Cash Two latest snapshot = balance %v date %q",
			balancesByName["Cash Two"],
			datesByName["Cash Two"],
		)
	}
}

func TestAccountSnapshotsGraphQLExecutionRejectsInvalidPageArgs(t *testing.T) {
	ctx := allScopesCtx()
	store := openGraphTestStore(t)
	account := mustSeedGraphAccount(t, store, "snapshot-cursor-account", "snapshot-cursor", "Checking", model.AccountTypeDepository)
	assetName := "US Dollar"
	asset := mustUpsertAsset(t, store.WealthDB, wealth.AssetUpsert{
		AssetType:  model.AssetTypeCurrency,
		Identifier: "USD:snapshot-cursor",
		Name:       &assetName,
		Classifier: model.AssetClassifierCash,
	})
	seedGraphSnapshot(t, ctx, store, account.ID.Int64(), asset.ID.Int64(), "2026-06-01", 100)

	resolver := &Resolver{AccountsStore: store.Accounts, WealthDB: store.WealthDB, Wealth: testWealthService(store.WealthDB)}
	c := client.New(newExecServer(resolver))
	accountID := account.ID.EncodedString()
	encodeCursor := func(json string) string { return base64.RawURLEncoding.EncodeToString([]byte(json)) }

	cases := []struct {
		name  string
		input string
	}{
		{name: "non-positive first", input: fmt.Sprintf(`{accountId: %q, first: 0}`, accountID)},
		{name: "first above max", input: fmt.Sprintf(`{accountId: %q, first: 1000}`, accountID)},
		{name: "malformed base64 cursor", input: fmt.Sprintf(`{accountId: %q, after: "not-valid-base64!!"}`, accountID)},
		{name: "invalid date cursor", input: fmt.Sprintf(`{accountId: %q, after: %q}`, accountID, encodeCursor(`{"date":"not-a-date"}`))},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var response map[string]any
			err := c.Post(fmt.Sprintf(`query { accountSnapshots(input: %s) { totalCount } }`, tc.input), &response, withCtx(ctx))
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), "BAD_USER_INPUT") {
				t.Fatalf("error = %v, want BAD_USER_INPUT", err)
			}
		})
	}
}

func TestCreateAssetGraphQLExecution(t *testing.T) {
	ctx := allScopesCtx()
	store := openGraphTestStore(t)
	resolver := &Resolver{AccountsStore: store.Accounts, WealthDB: store.WealthDB, Wealth: testWealthService(store.WealthDB)}
	c := client.New(newExecServer(resolver))

	var resp struct {
		CreateAsset struct {
			Asset struct {
				ID                 string
				AssetType          string
				Identifier         string
				Name               string
				Classifier         string
				ForcedUsdPrice     *float64
				TrackingTicker     *string
				TrackingMultiplier float64
			}
		}
	}
	c.MustPost(`mutation($input: CreateAssetInput!) {
		createAsset(input: $input) {
			asset {
				id
				assetType
				identifier
				name
				classifier
				forcedUsdPrice
				trackingTicker
				trackingMultiplier
			}
		}
	}`, &resp,
		client.Var("input", map[string]any{
			"assetType":          "SECURITY",
			"identifier":         "TrustII_VFFVX",
			"name":               "SPDR S&P 500 ETF",
			"classifier":         "PUBLIC",
			"forcedUsdPrice":     500.25,
			"trackingTicker":     "VFFVX",
			"trackingMultiplier": 1.5155,
			"security":           map[string]any{"cusip": "78462F103", "isin": "US78462F1030"},
		}),
		withCtx(ctx),
	)

	got := resp.CreateAsset.Asset
	if got.ID == "" || got.AssetType != "SECURITY" || got.Identifier != "TrustII_VFFVX" || got.Classifier != "PUBLIC" {
		t.Fatalf("createAsset response = %#v", got)
	}
	if got.Name != "SPDR S&P 500 ETF" || got.ForcedUsdPrice == nil || *got.ForcedUsdPrice != 500.25 {
		t.Fatalf("createAsset pricing/name response = %#v", got)
	}
	if got.TrackingTicker == nil || *got.TrackingTicker != "VFFVX" || got.TrackingMultiplier != 1.5155 {
		t.Fatalf("createAsset tracking response = %#v", got)
	}
}

func seedGraphSnapshot(
	t *testing.T,
	ctx context.Context,
	store *graphTestStore,
	accountID int64,
	assetID int64,
	date string,
	balance float64,
) {
	t.Helper()
	quantity := balance
	price := 1.0
	must.NoErr(t, store.WealthDB.ReplaceAccountBalanceSnapshot(ctx, wealth.AccountBalanceSnapshot{
		AccountID:  accountID,
		Source:     "plaid",
		Date:       date,
		SyncedAt:   date + "T12:00:00Z",
		BalanceUSD: money.FromDollars(balance),
		Holdings: []wealth.AssetDailyHolding{{
			AssetID:           assetID,
			Quantity:          &quantity,
			Price:             &price,
			ValueUSD:          balance,
			CountsTowardValue: true,
		}},
	}))
}
