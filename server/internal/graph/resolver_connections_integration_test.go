package graph

import (
	"testing"

	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func TestConnectionAndAttachedFieldResolvers(t *testing.T) {
	ctx := allScopesCtx()
	resolver, store := testResolver(t)
	account := test.SeedPlaidAccount(t, store.Accounts, store.AdminDB, "acc", "alex")
	ctx = NewLoadersContext(ctx, resolver.NewLoaders())
	connection, err := resolver.Account().(*accountResolver).Connection(ctx, &model.Account{Connection: account.Connection})
	if err != nil || connection == nil {
		t.Fatalf("Account.Connection() = %#v, %v", connection, err)
	}
	credential, err := resolver.PlaidItem().(*plaidItemResolver).Credential(ctx, &model.PlaidItem{Credential: &model.PlaidCredential{ID: 999}})
	if err != nil || credential.ID != 999 {
		t.Fatalf("PlaidItem.Credential() = %#v, %v", credential, err)
	}
	accounts, err := resolver.PlaidItem().(*plaidItemResolver).Accounts(ctx, &model.PlaidItem{ID: model.New(model.GlobalIDPlaidItem, account.Connection.SourceID)})
	if err != nil || len(accounts) != 1 {
		t.Fatalf("PlaidItem.Accounts() = %#v, %v", accounts, err)
	}
	provider, err := resolver.Connection().(*connectionResolver).Provider(ctx, account.Connection)
	if err != nil || provider == nil {
		t.Fatalf("Connection.Provider() = %#v, %v", provider, err)
	}

	mutation := resolver.Mutation().(*mutationResolver)
	syncCron := "0 */2 * * *"
	recurringCron := "0 12 * * 0"
	if _, err := mutation.UpdateConnection(ctx, model.UpdateConnectionInput{ConnectionID: account.Connection.ID, SyncCron: &syncCron, RecurringSyncCron: &recurringCron}); err != nil {
		t.Fatal(err)
	}
	tooFrequent := "*/30 * * * *"
	if _, err := mutation.UpdateConnection(ctx, model.UpdateConnectionInput{ConnectionID: account.Connection.ID, SyncCron: &tooFrequent, RecurringSyncCron: &recurringCron}); err == nil {
		t.Fatal("expected minimum interval error")
	}

	owner := test.MustCreateOwner(t, store.Accounts, model.CreateOwnerInput{Name: "wallet"})
	walletConnection, _, err := store.Accounts.CreateEVMWallet(ctx, "0x1111111111111111111111111111111111111111", owner.ID.Int64(), "wallet", []string{"eth"})
	must.NoErr(t, err)
	if _, err := mutation.UpdateConnection(ctx, model.UpdateConnectionInput{ConnectionID: walletConnection.ID, ChainIds: []string{"op", "arb", "op"}}); err != nil {
		t.Fatal(err)
	}
	wallet, err := store.Accounts.EVMWalletByConnectionID(ctx, walletConnection.ID.Int64())
	if err != nil || len(wallet.ChainIDs) != 2 || wallet.ChainIDs[0] != "arb" || wallet.ChainIDs[1] != "op" {
		t.Fatalf("EVM wallet = %#v, %v", wallet, err)
	}
}
