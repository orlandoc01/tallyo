package graph

import (
	"context"
	"testing"

	"github.com/99designs/gqlgen/client"

	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	testutil "tallyo/internal/utils/test"
	"tallyo/internal/wealth/manual"
	"tallyo/internal/wealth/realestate"
)

func TestManualRealEstateGraphQLExecution(t *testing.T) {
	ctx := allScopesCtx()
	store := openGraphTestStore(t)
	owner := testutil.MustCreateOwner(t, store.Accounts, model.CreateOwnerInput{Name: "alex"})
	gqlOwnerID := owner.ID.EncodedString()
	manualSnapshots := &manual.Service{Store: store.WealthDB, Prices: testutil.LastKnownPriceProvider{}}
	resolver := &Resolver{
		AccountsStore:  store.Accounts,
		WealthDB:       store.WealthDB,
		Wealth:         testWealthService(store.WealthDB),
		RealEstate:     &realestate.Service{Store: store.WealthDB},
		ManualSnapshot: manualSnapshots,
	}
	c := client.New(newExecServer(resolver))

	var linkResp struct {
		LinkRealEstate struct {
			ValuationUSD float64
			Connection   struct {
				ID       string
				Provider *struct {
					Typename string `json:"__typename"`
				}
			}
			Account struct {
				ID   string
				Type string
			}
		}
	}
	c.MustPost(`mutation($input: LinkRealEstateInput!) {
      linkRealEstate(input: $input) {
        valuationUSD
	        connection { id provider { __typename } }
        account { id type }
      }
    }`, &linkResp, client.Var("input", map[string]any{
		"ownerId":            gqlOwnerID,
		"manualValuationUSD": 1450000.0,
		"street":             "123 Main St",
		"city":               "Springfield",
	}), withCtx(ctx))
	if linkResp.LinkRealEstate.ValuationUSD != 1450000 || linkResp.LinkRealEstate.Connection.ID == "" || linkResp.LinkRealEstate.Connection.Provider != nil {
		t.Fatalf("link response = %#v", linkResp)
	}
	if linkResp.LinkRealEstate.Account.Type != "PROPERTY" {
		t.Fatalf("account type = %q, want PROPERTY", linkResp.LinkRealEstate.Account.Type)
	}

	var updateResp struct {
		UpdateRealEstate struct {
			Account struct {
				ID string
			}
		}
	}
	c.MustPost(`mutation($input: UpdateRealEstateInput!) { updateRealEstate(input: $input) { account { id } } }`,
		&updateResp,
		client.Var("input", map[string]any{
			"connectionId": linkResp.LinkRealEstate.Connection.ID,
			"valuationUSD": 1500000.0,
			"street":       "456 Oak Ave",
		}),
		withCtx(ctx))
	if updateResp.UpdateRealEstate.Account.ID == "" {
		t.Fatalf("update response = %#v", updateResp)
	}

	var netWorthResp struct {
		NetWorth struct {
			CurrentNetWorthUSD  float64
			ClassifierBreakdown []struct {
				Classifier string
				Holdings   []struct {
					Asset struct {
						AssetType string
					}
				}
			}
		}
	}
	c.MustPost(`query($input: NetWorthInput!) {
      netWorth(input: $input) {
        currentNetWorthUSD
        classifierBreakdown { classifier holdings { asset { assetType } } }
      }
	    }`, &netWorthResp, client.Var("input", map[string]any{}), withCtx(ctx))
	if netWorthResp.NetWorth.CurrentNetWorthUSD != 1500000 {
		t.Fatalf("net worth response = %#v", netWorthResp)
	}

	var invalidUpdateResp map[string]any
	err := c.Post(`mutation($input: UpdateRealEstateInput!) { updateRealEstate(input: $input) { account { id } } }`,
		&invalidUpdateResp,
		client.Var("input", map[string]any{
			"connectionId": linkResp.LinkRealEstate.Connection.ID,
			"valuationUSD": -1.0,
			"street":       "789 Bad Write Way",
		}),
		withCtx(ctx))
	if err == nil {
		t.Fatal("updateRealEstate with invalid valuation should return error")
	}
	decodedConnectionID, decodeErr := model.DecodeGlobalID(linkResp.LinkRealEstate.Connection.ID)
	if decodeErr != nil {
		t.Fatalf("DecodeGlobalID(connection) error = %v", decodeErr)
	}
	if decodedConnectionID.Type != model.GlobalIDConnection {
		t.Fatalf("connection ID type = %q, want %q", decodedConnectionID.Type, model.GlobalIDConnection)
	}
	localConnectionID := decodedConnectionID.Int64()
	re, err := store.WealthDB.RealEstateByConnectionID(context.Background(), localConnectionID)
	if err != nil || re == nil {
		t.Fatalf("RealEstateByConnectionID after invalid update: %v", err)
	}
	if re.Details.Street == nil || *re.Details.Street != "456 Oak Ave" {
		t.Fatalf("street after invalid update = %v, want 456 Oak Ave", re.Details.Street)
	}
	newName := "Updated Home"
	var updateAccountResp struct {
		UpdateAccount struct {
			Account struct{ Name string }
		}
	}
	c.MustPost(`mutation($input: UpdateAccountInput!) { updateAccount(input: $input) { account { name } } }`,
		&updateAccountResp,
		client.Var("input", map[string]any{
			"id":   linkResp.LinkRealEstate.Account.ID,
			"name": newName,
		}),
		withCtx(ctx))
	if updateAccountResp.UpdateAccount.Account.Name != newName {
		t.Fatalf("updateAccount response = %#v", updateAccountResp)
	}
	var syncedAssetName, syncedConnectionName string
	must.NoErr(t, store.SQL().QueryRowContext(context.Background(), `SELECT name FROM assets WHERE id = ?`, re.AssetID).Scan(&syncedAssetName))
	must.NoErr(t, store.SQL().QueryRowContext(context.Background(), `SELECT name FROM connections WHERE id = ?`, localConnectionID).Scan(&syncedConnectionName))
	if syncedAssetName != newName || syncedConnectionName != newName {
		t.Fatalf("synced names = asset %q connection %q, want %q", syncedAssetName, syncedConnectionName, newName)
	}

	var accountsResp struct {
		Accounts struct {
			Items []struct {
				ID             string
				Name           string
				Type           string
				LastSyncedAt   *string
				LatestSnapshot *struct {
					BalanceUSD         float64
					NetContributionUSD float64
				}
				Connection struct {
					ID string
				}
				AccountWealthProperty *struct {
					Typename string `json:"__typename"`
					Address  struct {
						Street string
					}
				}
				Owner struct{ Name string }
			}
		}
	}
	c.MustPost(`query {
	      accounts { items { id name type latestSnapshot { balanceUSD netContributionUSD } lastSyncedAt owner { name } connection { id } accountWealthProperty { __typename ... on RealEstateAssetDetails { address { street } } } } }
	    }`, &accountsResp, withCtx(ctx))
	if len(accountsResp.Accounts.Items) != 1 || accountsResp.Accounts.Items[0].LatestSnapshot == nil || accountsResp.Accounts.Items[0].LatestSnapshot.BalanceUSD != 1500000 {
		t.Fatalf("accounts response = %#v", accountsResp)
	}
	if accountsResp.Accounts.Items[0].Type != "PROPERTY" {
		t.Fatalf("account type in list = %q, want PROPERTY", accountsResp.Accounts.Items[0].Type)
	}
	if accountsResp.Accounts.Items[0].AccountWealthProperty == nil || accountsResp.Accounts.Items[0].AccountWealthProperty.Address.Street != "456 Oak Ave" {
		t.Fatalf("accountWealthProperty = %#v", accountsResp.Accounts.Items[0].AccountWealthProperty)
	}

	var connectionsResp struct {
		Connections struct {
			Items []struct {
				ID string
			}
		}
	}
	c.MustPost(`query { connections(input: { includeInactive: true }) { items { id } } }`,
		&connectionsResp, withCtx(ctx))
	if len(connectionsResp.Connections.Items) != 0 {
		t.Fatalf("connections response = %#v", connectionsResp)
	}

	var unlinkResp struct{ UnlinkRealEstate bool }
	c.MustPost(`mutation($id: ID!) { unlinkRealEstate(id: $id) }`, &unlinkResp,
		client.Var("id", linkResp.LinkRealEstate.Connection.ID), withCtx(ctx))
	if !unlinkResp.UnlinkRealEstate {
		t.Fatalf("unlink response = %#v", unlinkResp)
	}
}

func TestRealEstateGuards(t *testing.T) {
	ctx := allScopesCtx()
	store := openGraphTestStore(t)
	owner := testutil.MustCreateOwner(t, store.Accounts, model.CreateOwnerInput{Name: "alex"})
	gqlOwnerID := owner.ID.EncodedString()
	manualSnapshots := &manual.Service{Store: store.WealthDB, Prices: testutil.LastKnownPriceProvider{}}
	resolver := &Resolver{
		AccountsStore:  store.Accounts,
		WealthDB:       store.WealthDB,
		Wealth:         testWealthService(store.WealthDB),
		RealEstate:     &realestate.Service{Store: store.WealthDB},
		ManualSnapshot: manualSnapshots,
	}
	c := client.New(newExecServer(resolver))

	// Guard: createManualAccount with type PROPERTY must be rejected.
	var createAcctResp map[string]any
	err := c.Post(`mutation($input: CreateManualAccountInput!) { createManualAccount(input: $input) { account { id } } }`,
		&createAcctResp,
		client.Var("input", map[string]any{"name": "My Home", "type": "PROPERTY", "ownerId": gqlOwnerID}),
		withCtx(ctx),
	)
	if err == nil {
		t.Fatal("createManualAccount(type:PROPERTY) should return error")
	}

	// Create a valid manual account for updateAccount guard checks.
	var manualAcctResp struct {
		CreateManualAccount struct {
			Account struct{ ID string }
		}
	}
	c.MustPost(`mutation($input: CreateManualAccountInput!) { createManualAccount(input: $input) { account { id } } }`,
		&manualAcctResp,
		client.Var("input", map[string]any{"name": "Manual", "type": "OTHER", "ownerId": gqlOwnerID}),
		withCtx(ctx),
	)

	// Guard: updateAccount type → PROPERTY must be rejected.
	var updateAcctResp map[string]any
	err = c.Post(`mutation($input: UpdateAccountInput!) { updateAccount(input: $input) { account { id } } }`,
		&updateAcctResp,
		client.Var("input", map[string]any{
			"id":   manualAcctResp.CreateManualAccount.Account.ID,
			"type": "PROPERTY",
		}),
		withCtx(ctx),
	)
	if err == nil {
		t.Fatal("updateAccount(type:PROPERTY) should return error")
	}

	// Guard: updateAccount type away from PROPERTY must be rejected.
	// Link a real estate account first.
	var linkResp struct {
		LinkRealEstate struct {
			Account struct{ ID string }
		}
	}
	c.MustPost(`mutation($input: LinkRealEstateInput!) { linkRealEstate(input: $input) { account { id } } }`,
		&linkResp,
		client.Var("input", map[string]any{"ownerId": gqlOwnerID, "manualValuationUSD": 500000.0}),
		withCtx(ctx),
	)
	var updateRealAcctResp map[string]any
	err = c.Post(`mutation($input: UpdateAccountInput!) { updateAccount(input: $input) { account { id } } }`,
		&updateRealAcctResp,
		client.Var("input", map[string]any{
			"id":   linkResp.LinkRealEstate.Account.ID,
			"type": "OTHER",
		}),
		withCtx(ctx),
	)
	if err == nil {
		t.Fatal("updateAccount(type:OTHER) on a PROPERTY account should return error")
	}

	// Manual accounts can be reclassified as crypto wallets.
	var updateCryptoResp map[string]any
	c.MustPost(`mutation($input: UpdateAccountInput!) { updateAccount(input: $input) { account { type } } }`,
		&updateCryptoResp,
		client.Var("input", map[string]any{
			"id":   manualAcctResp.CreateManualAccount.Account.ID,
			"type": "CRYPTO_WALLET",
		}),
		withCtx(ctx),
	)
	updateAccount := updateCryptoResp["updateAccount"].(map[string]any)
	updatedAccount := updateAccount["account"].(map[string]any)
	if updatedAccount["type"] != "CRYPTO_WALLET" {
		t.Fatalf("updated manual account type = %q, want CRYPTO_WALLET", updatedAccount["type"])
	}

	// Manual crypto wallet accounts are allowed; only linked wallet account type changes are guarded.
	var createCryptoResp struct {
		CreateManualAccount struct {
			Account struct{ Type model.AccountType }
		}
	}
	c.MustPost(`mutation($input: CreateManualAccountInput!) { createManualAccount(input: $input) { account { type } } }`,
		&createCryptoResp,
		client.Var("input", map[string]any{"name": "My Wallet", "type": "CRYPTO_WALLET", "ownerId": gqlOwnerID}),
		withCtx(ctx),
	)
	if createCryptoResp.CreateManualAccount.Account.Type != model.AccountTypeCryptoWallet {
		t.Fatalf("manual crypto account type = %q, want CRYPTO_WALLET", createCryptoResp.CreateManualAccount.Account.Type)
	}
}
