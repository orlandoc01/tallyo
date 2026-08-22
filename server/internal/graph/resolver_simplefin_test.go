package graph

import (
	"context"
	"strings"
	"testing"

	"github.com/99designs/gqlgen/client"

	"tallyo/internal/accounts"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func TestSimpleFinAccessTokenGraphQLExecution(t *testing.T) {
	ctx := allScopesCtx()
	store := openGraphTestStore(t)
	owner := test.MustCreateOwner(t, store.Accounts, model.CreateOwnerInput{Name: "simplefin-owner"})
	_, err := store.Accounts.CreateSimpleFinAccessToken(context.Background(), "https://simplefin.example/access", owner.ID.Int64(), "primary")
	must.NoErr(t, err)

	resolver := &Resolver{
		AccountsStore:     store.Accounts,
		WealthDB:          store.WealthDB,
		TransactionsStore: store.Transactions,
		SimpleFin:         &accounts.SimpleFinService{Store: store.Accounts},
	}
	c := client.New(newExecServer(resolver))

	var listResp struct {
		SimpleFinAccessTokens struct{ Items []struct{ ID string } }
	}
	c.MustPost(`query { simpleFinAccessTokens { items { id } } }`, &listResp, withCtx(ctx))
	if len(listResp.SimpleFinAccessTokens.Items) != 1 {
		t.Fatalf("simpleFinAccessTokens = %#v", listResp.SimpleFinAccessTokens)
	}
	tokenID := listResp.SimpleFinAccessTokens.Items[0].ID

	// The returned opaque ID passes directly into reset/delete (no client-side
	// Number() conversion needed, unlike the old Int! contract).
	var resetResp struct {
		ResetSimpleFinSync struct{ ID string }
	}
	c.MustPost(`mutation($id: ID!) { resetSimpleFinSync(id: $id) { id } }`, &resetResp, client.Var("id", tokenID), withCtx(ctx))
	if resetResp.ResetSimpleFinSync.ID != tokenID {
		t.Fatalf("resetSimpleFinSync id = %q, want %q", resetResp.ResetSimpleFinSync.ID, tokenID)
	}

	missingID := model.New(model.GlobalIDSimpleFinAccessToken, 999999).EncodedString()
	var missingResp map[string]any
	if err := c.Post(`mutation($id: ID!) { resetSimpleFinSync(id: $id) { id } }`, &missingResp, client.Var("id", missingID), withCtx(ctx)); err == nil || !strings.Contains(err.Error(), "simplefin access token 999999 not found") {
		t.Fatalf("resetSimpleFinSync(missing) error = %v, want not-found message", err)
	}

	var wrongTypeResp map[string]any
	if err := c.Post(`mutation($id: ID!) { deleteSimpleFinAccessToken(id: $id) }`, &wrongTypeResp, client.Var("id", owner.ID.EncodedString()), withCtx(ctx)); err == nil || !strings.Contains(err.Error(), "BAD_USER_INPUT") {
		t.Fatalf("deleteSimpleFinAccessToken(wrong global ID type) error = %v, want BAD_USER_INPUT", err)
	}

	var deleteResp struct{ DeleteSimpleFinAccessToken bool }
	c.MustPost(`mutation($id: ID!) { deleteSimpleFinAccessToken(id: $id) }`, &deleteResp, client.Var("id", tokenID), withCtx(ctx))
	if !deleteResp.DeleteSimpleFinAccessToken {
		t.Fatalf("deleteSimpleFinAccessToken = %v, want true", deleteResp.DeleteSimpleFinAccessToken)
	}
}
