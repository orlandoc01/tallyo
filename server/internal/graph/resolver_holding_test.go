package graph

import (
	"context"
	"testing"

	"tallyo/internal/graph/model"
)

// TestHoldingAccountEagerObjectSkipsLoader proves the eager path never touches
// the request-scoped loader: obj.Account is returned directly from a bare
// context.Background(), which has no loaders injected and would panic if
// loadersFrom(ctx) were called.
func TestHoldingAccountEagerObjectSkipsLoader(t *testing.T) {
	resolver := &Resolver{}
	account := &model.Account{ID: model.New(model.GlobalIDAccount, 1), Name: "Checking"}
	holding := &model.Holding{Account: account, AccountID: account.ID}

	got, err := resolver.HoldingAccount(context.Background(), holding)
	if err != nil || got != account {
		t.Fatalf("HoldingAccount() = %#v, %v, want the eager Account object", got, err)
	}
}

// TestHoldingAccountLoaderFallback proves the construction path with only an
// AccountID (historical snapshot holdings) resolves through the request-scoped
// DataLoader, and that a missing Account fails loudly rather than returning nil.
func TestHoldingAccountLoaderFallback(t *testing.T) {
	store := openGraphTestStore(t)
	account := mustSeedGraphAccount(t, store, "holding-loader-account", "holding-loader-owner", "Checking", model.AccountTypeDepository)

	resolver := &Resolver{AccountsStore: store.Accounts}
	ctx := NewLoadersContext(context.Background(), resolver.NewLoaders())

	found, err := resolver.HoldingAccount(ctx, &model.Holding{AccountID: account.ID})
	if err != nil || found == nil || found.ID != account.ID {
		t.Fatalf("HoldingAccount() = %#v, %v, want loaded account %s", found, err, account.ID)
	}

	missingID := model.New(model.GlobalIDAccount, 999999)
	missing, err := resolver.HoldingAccount(ctx, &model.Holding{AccountID: missingID})
	if err == nil || missing != nil {
		t.Fatalf("HoldingAccount(missing) = %#v, %v, want a loud error for a missing account", missing, err)
	}
}
