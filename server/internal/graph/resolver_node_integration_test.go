package graph

import (
	"context"
	"testing"

	"github.com/99designs/gqlgen/client"

	"tallyo/internal/accounts"
	"tallyo/internal/admin"
	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/auth"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func TestSimpleFinNodesAndAccessTokenConnections(t *testing.T) {
	ctx := allScopesCtx()
	store := openGraphTestStore(t)
	owner := test.MustCreateOwner(t, store.Accounts, model.CreateOwnerInput{Name: "simplefin"})
	token, err := store.Accounts.CreateSimpleFinAccessToken(ctx, "https://user:pass@bridge.example/simplefin", owner.ID.Int64(), "Bridge")
	must.NoErr(t, err)
	connRowID, connectionID, err := store.Accounts.LinkSimpleFinConnection(ctx, accounts.UpsertSimpleFinConnectionParams{
		ExternalID:    "conn-1",
		AccessTokenID: token.ID.Int64(),
		Name:          "Bank",
		OwnerID:       owner.ID.Int64(),
	})
	must.NoErr(t, err)
	account := &model.Account{
		Connection: &model.Connection{ID: model.New(model.GlobalIDConnection, connectionID)},
		Owner:      owner,
		Name:       "Checking",
		Type:       model.AccountTypeDepository,
	}
	test.MustUpsertAccount(t, store.Accounts, "simplefin-loader-account", account)
	resolver := &Resolver{AccountsStore: store.Accounts}

	tokenNode, err := resolver.Node(ctx, token.ID)
	must.NoErr(t, err)
	if tokenNode == nil || tokenNode.GetID() != token.ID {
		t.Fatalf("token node = %#v", tokenNode)
	}
	connID := model.New(model.GlobalIDSimpleFinConnection, connRowID)
	connNode, err := resolver.Node(ctx, connID)
	must.NoErr(t, err)
	if connNode == nil || connNode.GetID() != connID {
		t.Fatalf("connection node = %#v", connNode)
	}
	tokenGlobalID := token.ID
	missingID := model.New(model.GlobalIDSimpleFinConnection, connRowID+999)
	nodes, err := resolver.Nodes(ctx, []*model.GlobalID{&tokenGlobalID, &missingID, &connID})
	must.NoErr(t, err)
	if nodes[0].GetID() != token.ID || nodes[1] != nil || nodes[2].GetID() != connID {
		t.Fatalf("nodes = %#v", nodes)
	}

	c := client.New(newExecServer(resolver))
	var response struct {
		SimpleFinAccessTokens struct {
			Items []struct {
				ID          string
				Connections []simpleFinConnectionResponse
			}
		}
		Node struct {
			Typename    string `json:"__typename"`
			ID          string
			Connections []simpleFinConnectionResponse
		}
	}
	c.MustPost(`query($id: ID!) {
		simpleFinAccessTokens { items { id connections { id accounts { id } } } }
		node(id: $id) { __typename ... on SimpleFinAccessToken { id connections { id accounts { id } } } }
	}`, &response, client.Var("id", token.ID.EncodedString()), withCtx(ctx))
	wantConnID := connID.EncodedString()
	if len(response.SimpleFinAccessTokens.Items) != 1 || len(response.SimpleFinAccessTokens.Items[0].Connections) != 1 {
		t.Fatalf("root token response = %#v", response.SimpleFinAccessTokens)
	}
	if response.SimpleFinAccessTokens.Items[0].Connections[0].ID != wantConnID || len(response.SimpleFinAccessTokens.Items[0].Connections[0].Accounts) != 1 {
		t.Fatalf("root token connections = %#v", response.SimpleFinAccessTokens.Items[0].Connections)
	}
	if response.Node.Typename != "SimpleFinAccessToken" || len(response.Node.Connections) != 1 || response.Node.Connections[0].ID != wantConnID {
		t.Fatalf("node response = %#v", response.Node)
	}
}

func TestNodeRefetchesAccountAndReturnsNilForMissing(t *testing.T) {
	ctx := auth.ContextWithScopes(context.Background(), []string{auth.ScopeReadAccounts, auth.ScopeReadUsers})
	store := openGraphTestStore(t)
	account := mustSeedGraphAccount(t, store, "acc", "alex", "Checking", model.AccountTypeDepository)
	user, err := store.AdminDB.InsertUser(context.Background(), admin.InsertUserInput{Email: "node-user@example.com", Role: "ADMIN"})
	must.NoErr(t, err)

	resolver := &Resolver{AccountsStore: store.Accounts, WealthDB: store.WealthDB, Admin: admin.NewService(store.AdminDB, runtimeconfig.New(store.AdminDB))}
	node, err := resolver.Node(ctx, account.ID)
	must.NoErr(t, err)
	fetchedAccount, ok := node.(*model.Account)
	if !ok || fetchedAccount.ID != account.ID {
		t.Fatalf("Node(account) = %#v", node)
	}
	missing, err := resolver.Node(ctx, model.New(model.GlobalIDAccount, 999999))
	must.NoErr(t, err)
	if missing != nil {
		t.Fatalf("Node(missing) = %#v, want nil", missing)
	}

	userNode, err := resolver.Node(ctx, user.ID)
	must.NoErr(t, err)
	fetchedUser, ok := userNode.(*model.User)
	if !ok || fetchedUser.ID != user.ID {
		t.Fatalf("Node(user) = %#v", userNode)
	}
	missingUser, err := resolver.Node(ctx, model.New(model.GlobalIDUser, 999999))
	must.NoErr(t, err)
	if missingUser != nil {
		t.Fatalf("Node(missing user) = %#v, want nil", missingUser)
	}
	nodes, err := resolver.Nodes(ctx, []*model.GlobalID{&user.ID})
	must.NoErr(t, err)
	if len(nodes) != 1 || nodes[0].(*model.User).ID != user.ID {
		t.Fatalf("Nodes(user) = %#v", nodes)
	}
}

type simpleFinConnectionResponse struct {
	ID       string
	Accounts []struct{ ID string }
}
