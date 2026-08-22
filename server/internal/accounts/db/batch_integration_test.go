package accountsdb_test

import (
	"context"
	"testing"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	admindb "tallyo/internal/admin/db"
	"tallyo/internal/database"
	"tallyo/internal/database/dbtest"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func TestBatchLookupMethods(t *testing.T) {
	ctx := context.Background()
	db := dbtest.Open(t)
	store := accountsdb.New(db)
	adminStore := admindb.New(db)

	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "alex"})
	credential := test.MustCreatePlaidCredential(t, adminStore, model.CreatePlaidCredentialInput{
		ClientID:    "client",
		Secret:      "secret",
		Environment: model.PlaidEnvironmentSandbox,
	})

	checking := seedPlaidBatchAccount(t, ctx, store, owner, credential.ID, "item-checking", "checking", "Checking")
	savings := seedPlaidBatchAccount(t, ctx, store, owner, credential.ID, "item-savings", "savings", "Savings")

	checkingItemID := checking.Connection.SourceID
	savingsItemID := savings.Connection.SourceID
	accountsByItem, err := store.AccountsByItems(ctx, []int64{checkingItemID, savingsItemID, 999})
	must.NoErr(t, err)
	if len(accountsByItem[checkingItemID]) != 1 || accountsByItem[checkingItemID][0].ID != checking.ID {
		t.Fatalf("AccountsByItems checking = %#v", accountsByItem)
	}
	if len(accountsByItem[savingsItemID]) != 1 || accountsByItem[savingsItemID][0].ID != savings.ID {
		t.Fatalf("AccountsByItems savings = %#v", accountsByItem)
	}

	accountIDs := []int64{checking.ID.Int64(), savings.ID.Int64(), 999}
	accountsByID, err := store.AccountsByIDs(ctx, accountIDs)
	must.NoErr(t, err)
	if len(accountsByID) != 2 ||
		accountsByID[checking.ID.Int64()].Name != checking.Name ||
		accountsByID[savings.ID.Int64()].Name != savings.Name {
		t.Fatalf("AccountsByIDs = %#v", accountsByID)
	}
	for _, ids := range [][]int64{nil, {}} {
		emptyAccounts, err := store.AccountsByIDs(ctx, ids)
		if err != nil || emptyAccounts == nil || len(emptyAccounts) != 0 {
			t.Fatalf("AccountsByIDs(%#v) = %#v, %v; want initialized empty map", ids, emptyAccounts, err)
		}
	}

	connByPlaidItem, err := store.ConnectionByPlaidItemID(ctx, checkingItemID)
	must.NoErr(t, err)
	if connByPlaidItem == nil || connByPlaidItem.ID != checking.Connection.ID {
		t.Fatalf("ConnectionByPlaidItemID = %#v, %v", connByPlaidItem, err)
	}

	itemsByID, err := store.PlaidItemsByIDs(ctx, []int64{checkingItemID, savingsItemID, 999})
	must.NoErr(t, err)
	if len(itemsByID) != 2 ||
		itemsByID[checkingItemID].ID.Int64() != checkingItemID ||
		itemsByID[savingsItemID].ID.Int64() != savingsItemID {
		t.Fatalf("PlaidItemsByIDs = %#v", itemsByID)
	}

	connectionIDs := []int64{checking.Connection.ID.Int64(), savings.Connection.ID.Int64(), 999}
	connectionsByID, err := store.ConnectionsByIDs(ctx, connectionIDs)
	must.NoErr(t, err)
	if len(connectionsByID) != 2 ||
		connectionsByID[checking.Connection.ID.Int64()].SourceID != checkingItemID ||
		connectionsByID[savings.Connection.ID.Int64()].SourceID != savingsItemID {
		t.Fatalf("ConnectionsByIDs = %#v", connectionsByID)
	}
	emptyConnections, err := store.ConnectionsByIDs(ctx, nil)
	if err != nil || len(emptyConnections) != 0 {
		t.Fatalf("ConnectionsByIDs(nil) = %#v, %v", emptyConnections, err)
	}

	ruleOne := insertBatchRule(t, ctx, db, "coffee")
	ruleTwo := insertBatchRule(t, ctx, db, "groceries")
	insertBatchRuleAccount(t, ctx, db, ruleOne, checking.ID.Int64())
	insertBatchRuleAccount(t, ctx, db, ruleTwo, savings.ID.Int64())
	ruleAccounts, err := store.AccountsByRuleIDs(ctx, []int64{ruleTwo, ruleOne, 999})
	must.NoErr(t, err)
	if len(ruleAccounts[ruleOne]) != 1 || ruleAccounts[ruleOne][0].ID != checking.ID {
		t.Fatalf("AccountsByRuleIDs ruleOne = %#v", ruleAccounts)
	}
	if len(ruleAccounts[ruleTwo]) != 1 || ruleAccounts[ruleTwo][0].ID != savings.ID {
		t.Fatalf("AccountsByRuleIDs ruleTwo = %#v", ruleAccounts)
	}

	evmConn, _, err := store.CreateEVMWallet(ctx, "0x1111111111111111111111111111111111111111", owner.ID.Int64(), "Wallet", []string{"eth"})
	must.NoErr(t, err)
	walletsByConnID, err := store.EVMWalletsByConnectionIDs(ctx, []int64{evmConn.ID.Int64(), 999})
	must.NoErr(t, err)
	if len(walletsByConnID) != 1 ||
		walletsByConnID[evmConn.ID.Int64()].Address != "0x1111111111111111111111111111111111111111" {
		t.Fatalf("EVMWalletsByConnectionIDs = %#v", walletsByConnID)
	}
	for _, ids := range [][]int64{nil, {}} {
		emptyWallets, err := store.EVMWalletsByConnectionIDs(ctx, ids)
		if err != nil || emptyWallets == nil || len(emptyWallets) != 0 {
			t.Fatalf("EVMWalletsByConnectionIDs(%#v) = %#v, %v; want initialized empty map", ids, emptyWallets, err)
		}
	}

	simpleFinConnID, simpleFinAccountID := seedSimpleFinBatchConnection(t, ctx, store, owner)
	simpleFinConnections, err := store.SimpleFinConnectionsByConnIDs(ctx, []int64{simpleFinConnID, 999})
	must.NoErr(t, err)
	simpleFinConnection := simpleFinConnections[simpleFinConnID]
	if len(simpleFinConnections) != 1 || simpleFinConnection == nil ||
		len(simpleFinConnection.Accounts) != 1 ||
		simpleFinConnection.Accounts[0].ID != simpleFinAccountID {
		t.Fatalf("SimpleFinConnectionsByConnIDs = %#v", simpleFinConnections)
	}
}

func seedPlaidBatchAccount(
	t *testing.T,
	ctx context.Context,
	store *accountsdb.Store,
	owner *model.Owner,
	credentialID int32,
	itemID string,
	accountID string,
	accountName string,
) *model.Account {
	t.Helper()
	rowID, err := store.UpsertPlaidItem(ctx, accounts.PlaidItemSecret{
		ExternalID:   itemID,
		CredentialID: credentialID,
		AccessToken:  "token-" + itemID,
		OwnerID:      owner.ID.Int64(),
		OwnerName:    owner.Name,
	})
	must.NoErr(t, err)
	conn := test.MustCreateConnection(t, store, rowID, &accountName, owner.ID.Int64())
	account := &model.Account{
		Connection: conn,
		Owner:      owner,
		Name:       accountName,
		Type:       model.AccountTypeDepository,
	}
	test.MustUpsertAccount(t, store, accountID, account)
	return account
}

func seedSimpleFinBatchConnection(t *testing.T, ctx context.Context, store *accountsdb.Store, owner *model.Owner) (int64, model.GlobalID) {
	t.Helper()
	token, err := store.CreateSimpleFinAccessToken(ctx, "https://user:pass@bridge.example/simplefin", owner.ID.Int64(), "Bridge")
	must.NoErr(t, err)
	tokenID := token.ID.Int64()
	connID := "simplefin-conn"
	rowID, connectionID, err := store.LinkSimpleFinConnection(ctx, accounts.UpsertSimpleFinConnectionParams{
		ExternalID:    connID,
		AccessTokenID: int64(tokenID),
		Name:          "SimpleFIN Bank",
		OwnerID:       owner.ID.Int64(),
	})
	must.NoErr(t, err)
	conn, err := store.ConnectionByID(ctx, connectionID)
	must.NoErr(t, err)
	account := &model.Account{
		Connection: conn,
		Owner:      owner,
		Name:       "SimpleFIN Checking",
		Type:       model.AccountTypeDepository,
	}
	test.MustUpsertAccount(t, store, "simplefin-account", account)
	return rowID, account.ID
}

func insertBatchRule(t *testing.T, ctx context.Context, db *database.DB, pattern string) int64 {
	t.Helper()
	result, err := db.SQL().ExecContext(ctx, `INSERT INTO rules (merchant_pattern) VALUES (?)`, pattern)
	must.NoErr(t, err)
	id, err := result.LastInsertId()
	must.NoErr(t, err)
	return id
}

func insertBatchRuleAccount(t *testing.T, ctx context.Context, db *database.DB, ruleID int64, accountID int64) {
	t.Helper()
	if _, err := db.SQL().ExecContext(
		ctx,
		`INSERT INTO rule_accounts (rule_id, account_id) VALUES (?, ?)`,
		ruleID,
		accountID,
	); err != nil {
		t.Fatalf("insert rule account: %v", err)
	}
}
