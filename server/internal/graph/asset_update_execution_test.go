package graph

import (
	"testing"

	"github.com/99designs/gqlgen/client"

	"tallyo/internal/graph/model"
	"tallyo/internal/wealth"
)

// TestUpdateAssetGraphQLExecution drives the updateAsset mutation through the
// full executable schema. It guards against a regression where the generated
// mutationResolver stub panicked instead of delegating to the real resolver.
func TestUpdateAssetGraphQLExecution(t *testing.T) {
	ctx := allScopesCtx()
	store := openGraphTestStore(t)

	name := "Apple Inc"
	created := mustUpsertAsset(t, store.WealthDB, wealth.AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "AAPL",
		Name:       &name,
		Classifier: model.AssetClassifierPublic,
		CUSIP:      new("037833100"),
	})

	resolver := &Resolver{AccountsStore: store.Accounts, WealthDB: store.WealthDB, Wealth: testWealthService(store.WealthDB)}
	c := client.New(newExecServer(resolver))

	var resp struct {
		UpdateAsset struct {
			Asset struct {
				ID             string
				Identifier     string
				Name           string
				ForcedUsdPrice *float64
			}
		}
	}
	c.MustPost(`mutation($input: UpdateAssetInput!) {
      updateAsset(input: $input) {
        asset {
			id
			identifier
			name
			forcedUsdPrice
		  }
		}
    }`, &resp,
		client.Var("input", map[string]any{
			"id":             created.ID,
			"identifier":     "APPL",
			"name":           "Apple Incorporated",
			"forcePrice":     true,
			"forcedUsdPrice": 123.45,
			"security":       map[string]any{"isin": "US0378331005"},
		}),
		withCtx(ctx),
	)

	got := resp.UpdateAsset.Asset
	if got.Identifier != "APPL" {
		t.Errorf("identifier = %q, want APPL", got.Identifier)
	}
	if got.Name != "Apple Incorporated" {
		t.Errorf("name = %q, want Apple Incorporated", got.Name)
	}
	if got.ForcedUsdPrice == nil || *got.ForcedUsdPrice != 123.45 {
		t.Errorf("forcedUsdPrice = %v, want 123.45", got.ForcedUsdPrice)
	}
	c.MustPost(`mutation($input: UpdateAssetInput!) {
      updateAsset(input: $input) { asset { forcedUsdPrice } }
    }`, &resp,
		client.Var("input", map[string]any{
			"id":         got.ID,
			"forcePrice": false,
		}),
		withCtx(ctx),
	)
	if resp.UpdateAsset.Asset.ForcedUsdPrice != nil {
		t.Errorf("forcedUsdPrice after clear = %v, want nil", resp.UpdateAsset.Asset.ForcedUsdPrice)
	}
}
