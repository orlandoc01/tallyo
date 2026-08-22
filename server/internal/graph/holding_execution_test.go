package graph

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"

	"github.com/99designs/gqlgen/client"

	"tallyo/internal/auth"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	"tallyo/internal/wealth"
)

// decodeInto round-trips a partial GraphQL response (client.Response.Data,
// already json.Unmarshal'd into `any`) into a typed struct. Used instead of
// client.MustPost/Post, which panic/error on any GraphQL error — these tests
// need the partial data alongside expected forbidden-field errors.
func decodeInto(data any, target any) error {
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, target)
}

func seedHoldingFixture(t *testing.T) (*graphTestStore, *model.Account, *client.Client) {
	t.Helper()
	store := openGraphTestStore(t)
	account := mustSeedGraphAccount(t, store, "holding-scope-account", "holding-scope-owner", "Checking", model.AccountTypeDepository)
	asset := mustUpsertAsset(t, store.WealthDB, wealth.AssetUpsert{
		AssetType:  model.AssetTypeCurrency,
		Identifier: "USD:holding-scope",
		Classifier: model.AssetClassifierCash,
	})
	balance := 100.0
	must.NoErr(t, store.WealthDB.ReplaceAccountBalanceSnapshot(context.Background(), wealth.AccountBalanceSnapshot{
		AccountID: account.ID.Int64(), Source: "plaid", Date: "2026-06-01", SyncedAt: "2026-06-01T21:00:00Z",
		BalanceUSD: money.FromDollars(balance),
		Holdings:   []wealth.AssetDailyHolding{{AssetID: asset.ID.Int64(), Quantity: &balance, ValueUSD: balance, CountsTowardValue: true}},
	}))
	resolver := &Resolver{AccountsStore: store.Accounts, WealthDB: store.WealthDB, Wealth: testWealthService(store.WealthDB)}
	return store, account, client.New(newExecServer(resolver))
}

func TestNetWorthWithoutHoldingsScopeOmitsUnselectedProtectedFields(t *testing.T) {
	_, _, c := seedHoldingFixture(t)
	ctx := auth.ContextWithScopes(context.Background(), []string{auth.ScopeReadWealth})

	var resp map[string]any
	err := c.Post(`query($input: NetWorthInput!) {
		netWorth(input: $input) {
			currentNetWorthUSD
			classifierBreakdown { classifier valueUSD holdings { totalQuantity valueUSD } }
		}
	}`, &resp, client.Var("input", map[string]any{}), withCtx(ctx))
	must.NoErr(t, err)
}

type rollupHoldingsData struct {
	NetWorth struct {
		CurrentNetWorthUsd  float64
		ClassifierBreakdown []struct {
			Classifier string
			ValueUsd   float64
			Holdings   []struct {
				TotalQuantity *float64
				ValueUsd      float64
				Holdings      []struct {
					ValueUsd float64
					Account  struct{ ID string }
				}
			}
		}
	}
}

func TestHoldingRollupHoldingsRequiresScope(t *testing.T) {
	_, account, c := seedHoldingFixture(t)
	query := `query($input: NetWorthInput!) {
		netWorth(input: $input) {
			currentNetWorthUSD
			classifierBreakdown { classifier valueUSD holdings { totalQuantity valueUSD holdings { valueUSD account { id } } } }
		}
	}`

	withoutScope := auth.ContextWithScopes(context.Background(), []string{auth.ScopeReadWealth})
	resp, err := c.RawPost(query, client.Var("input", map[string]any{}), withCtx(withoutScope))
	must.NoErr(t, err)
	if resp.Errors == nil || !strings.Contains(string(resp.Errors), auth.ScopeReadHoldings) {
		t.Fatalf("errors = %s, want a read:holdings forbidden-field error", resp.Errors)
	}
	var data rollupHoldingsData
	must.NoErr(t, decodeInto(resp.Data, &data))
	if data.NetWorth.CurrentNetWorthUsd != 100 || len(data.NetWorth.ClassifierBreakdown) != 1 {
		t.Fatalf("rest of report should survive the forbidden field: %#v", data)
	}
	rollup := data.NetWorth.ClassifierBreakdown[0].Holdings[0]
	if rollup.ValueUsd != 100 || rollup.Holdings != nil {
		t.Fatalf("rollup = %#v, want totals preserved and holdings null", rollup)
	}

	withScope := auth.ContextWithScopes(context.Background(), []string{auth.ScopeReadWealth, auth.ScopeReadHoldings})
	resp, err = c.RawPost(query, client.Var("input", map[string]any{}), withCtx(withScope))
	must.NoErr(t, err)
	if resp.Errors != nil {
		t.Fatalf("errors = %s, want none with read:holdings", resp.Errors)
	}
	data = rollupHoldingsData{}
	must.NoErr(t, decodeInto(resp.Data, &data))
	holdings := data.NetWorth.ClassifierBreakdown[0].Holdings[0].Holdings
	if len(holdings) != 1 || holdings[0].ValueUsd != 100 || holdings[0].Account.ID != account.ID.EncodedString() {
		t.Fatalf("holdings = %#v, want one row for %s", holdings, account.ID)
	}
}

func TestAccountSnapshotHoldingsRequiresScope(t *testing.T) {
	_, account, c := seedHoldingFixture(t)
	query := `query($id: ID!) {
		account(id: $id) { latestSnapshot { balanceUSD holdings { valueUSD } } }
	}`

	withoutScope := auth.ContextWithScopes(context.Background(), []string{auth.ScopeReadAccounts, auth.ScopeReadWealth})
	resp, err := c.RawPost(query, client.Var("id", account.ID), withCtx(withoutScope))
	must.NoErr(t, err)
	if resp.Errors == nil || !strings.Contains(string(resp.Errors), auth.ScopeReadHoldings) {
		t.Fatalf("errors = %s, want a read:holdings forbidden-field error", resp.Errors)
	}
	var withoutData struct {
		Account struct {
			LatestSnapshot struct {
				BalanceUsd float64
				Holdings   []struct{ ValueUsd float64 }
			}
		}
	}
	must.NoErr(t, decodeInto(resp.Data, &withoutData))
	if withoutData.Account.LatestSnapshot.BalanceUsd != 100 || withoutData.Account.LatestSnapshot.Holdings != nil {
		t.Fatalf("snapshot = %#v, want balance preserved and holdings null", withoutData.Account.LatestSnapshot)
	}

	withScope := auth.ContextWithScopes(context.Background(), []string{auth.ScopeReadAccounts, auth.ScopeReadWealth, auth.ScopeReadHoldings})
	resp, err = c.RawPost(query, client.Var("id", account.ID), withCtx(withScope))
	must.NoErr(t, err)
	if resp.Errors != nil {
		t.Fatalf("errors = %s, want none with read:holdings", resp.Errors)
	}
	var withData struct {
		Account struct {
			LatestSnapshot struct {
				BalanceUsd float64
				Holdings   []struct{ ValueUsd float64 }
			}
		}
	}
	must.NoErr(t, decodeInto(resp.Data, &withData))
	if len(withData.Account.LatestSnapshot.Holdings) != 1 || withData.Account.LatestSnapshot.Holdings[0].ValueUsd != 100 {
		t.Fatalf("holdings = %#v, want one row", withData.Account.LatestSnapshot.Holdings)
	}
}

type assetSnapshotAuthData struct {
	NetWorth struct {
		ClassifierBreakdown []struct {
			ValueUsd float64
			Holdings []struct {
				Asset struct {
					LatestSnapshot *struct {
						AsOfDate          string
						TotalHeldValueUsd float64
						Holdings          []struct{ ValueUsd float64 }
					}
				}
			}
		}
	}
}

func TestAssetLatestSnapshotAuthorization(t *testing.T) {
	_, _, c := seedHoldingFixture(t)
	// Reached through netWorth (read:wealth), not the assets root query, to prove
	// the read:assets directive on Asset.latestSnapshot applies no matter which
	// parent field produced the Asset.
	query := `query($input: NetWorthInput!) {
		netWorth(input: $input) {
			classifierBreakdown { valueUSD holdings { asset { latestSnapshot { asOfDate totalHeldValueUSD holdings { valueUSD } } } } }
		}
	}`

	withoutAssets := auth.ContextWithScopes(context.Background(), []string{auth.ScopeReadWealth})
	resp, err := c.RawPost(query, client.Var("input", map[string]any{}), withCtx(withoutAssets))
	must.NoErr(t, err)
	if resp.Errors == nil || !strings.Contains(string(resp.Errors), auth.ScopeReadAssets) {
		t.Fatalf("errors = %s, want a read:assets forbidden-field error", resp.Errors)
	}
	var data assetSnapshotAuthData
	must.NoErr(t, decodeInto(resp.Data, &data))
	rollup := data.NetWorth.ClassifierBreakdown[0].Holdings[0]
	if rollup.Asset.LatestSnapshot != nil {
		t.Fatalf("rollup = %#v, want latestSnapshot null", rollup)
	}
	if data.NetWorth.ClassifierBreakdown[0].ValueUsd != 100 {
		t.Fatalf("rest of report should survive the forbidden field: %#v", data)
	}

	withAssetsOnly := auth.ContextWithScopes(context.Background(), []string{auth.ScopeReadWealth, auth.ScopeReadAssets})
	resp, err = c.RawPost(query, client.Var("input", map[string]any{}), withCtx(withAssetsOnly))
	must.NoErr(t, err)
	if resp.Errors == nil || !strings.Contains(string(resp.Errors), auth.ScopeReadHoldings) {
		t.Fatalf("errors = %s, want a read:holdings forbidden-field error", resp.Errors)
	}
	data = assetSnapshotAuthData{}
	must.NoErr(t, decodeInto(resp.Data, &data))
	snapshot := data.NetWorth.ClassifierBreakdown[0].Holdings[0].Asset.LatestSnapshot
	if snapshot == nil || snapshot.TotalHeldValueUsd != 100 || snapshot.Holdings != nil {
		t.Fatalf("snapshot = %#v, want totals preserved and holdings null", snapshot)
	}

	withBoth := auth.ContextWithScopes(context.Background(), []string{auth.ScopeReadWealth, auth.ScopeReadAssets, auth.ScopeReadHoldings})
	resp, err = c.RawPost(query, client.Var("input", map[string]any{}), withCtx(withBoth))
	must.NoErr(t, err)
	if resp.Errors != nil {
		t.Fatalf("errors = %s, want none with both scopes", resp.Errors)
	}
	data = assetSnapshotAuthData{}
	must.NoErr(t, decodeInto(resp.Data, &data))
	snapshot = data.NetWorth.ClassifierBreakdown[0].Holdings[0].Asset.LatestSnapshot
	if snapshot == nil || len(snapshot.Holdings) != 1 || snapshot.Holdings[0].ValueUsd != 100 {
		t.Fatalf("snapshot = %#v, want one holding", snapshot)
	}
}

func TestAssetLatestSnapshotNullForUnheldAssetAndBatchesParents(t *testing.T) {
	store, _, _ := seedHoldingFixture(t)
	_ = mustUpsertAsset(t, store.WealthDB, wealth.AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "NEVER-HELD-EXEC",
		Classifier: model.AssetClassifierPublic,
	})
	wealthSvc := &countingWealthService{WealthService: testWealthService(store.WealthDB)}
	resolver := &Resolver{AccountsStore: store.Accounts, WealthDB: store.WealthDB, Wealth: wealthSvc}
	c := client.New(newExecServer(resolver))
	ctx := auth.ContextWithScopes(context.Background(), []string{auth.ScopeReadAssets, auth.ScopeReadHoldings})

	var resp struct {
		Assets struct {
			Items []struct {
				Identifier     string
				LatestSnapshot *struct{ AsOfDate string }
			}
		}
	}
	c.MustPost(`query { assets(input: {includeHistorical: true}) { items { identifier latestSnapshot { asOfDate } } } }`, &resp, withCtx(ctx))

	byIdentifier := map[string]bool{}
	for _, item := range resp.Assets.Items {
		byIdentifier[item.Identifier] = item.LatestSnapshot != nil
	}
	if !byIdentifier["USD:holding-scope"] {
		t.Fatalf("items = %#v, want held asset to have a non-null latestSnapshot", resp.Assets.Items)
	}
	if byIdentifier["NEVER-HELD-EXEC"] {
		t.Fatalf("items = %#v, want unheld asset to have a null latestSnapshot", resp.Assets.Items)
	}
	if wealthSvc.assetSnapshotBatchCalls != 1 || len(wealthSvc.lastAssetIDs) < 2 {
		t.Fatalf("AssetSnapshotsByIDs calls = %d with %v, want one batch for multiple assets", wealthSvc.assetSnapshotBatchCalls, wealthSvc.lastAssetIDs)
	}
}

type countingWealthService struct {
	WealthService
	mu                      sync.Mutex
	assetSnapshotBatchCalls int
	lastAssetIDs            []int64
}

func (s *countingWealthService) AssetSnapshotsByIDs(ctx context.Context, assetIDs []int64) (map[int64]*model.AssetSnapshot, error) {
	s.mu.Lock()
	s.assetSnapshotBatchCalls++
	s.lastAssetIDs = append([]int64(nil), assetIDs...)
	s.mu.Unlock()
	return s.WealthService.AssetSnapshotsByIDs(ctx, assetIDs)
}
