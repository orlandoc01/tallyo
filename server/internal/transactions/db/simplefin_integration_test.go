package transactionsdb_test

import (
	"context"
	"testing"

	"tallyo/internal/accounts"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbtest"
	"tallyo/internal/graph/model"
	"tallyo/internal/transactions"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func TestSimpleFinTransactionSyncStoreMethods(t *testing.T) {
	ctx := context.Background()
	accountsStore, txStore := openTestStore(t)

	owner := test.MustCreateOwner(t, accountsStore, model.CreateOwnerInput{Name: "alex"})
	token, err := accountsStore.CreateSimpleFinAccessToken(ctx, "https://user:pass@bridge.example/simplefin", owner.ID.Int64(), "Bridge")
	must.NoErr(t, err)
	tokenID := token.ID.Int64()

	orgURL := "https://bank.example"
	_, connectionID, err := accountsStore.LinkSimpleFinConnection(ctx, accounts.UpsertSimpleFinConnectionParams{
		ExternalID:    "conn-1",
		AccessTokenID: tokenID,
		OrgURL:        &orgURL,
		Name:          "Bank",
		OwnerID:       owner.ID.Int64(),
	})
	must.NoErr(t, err)

	conn := &model.Connection{ID: model.New(model.GlobalIDConnection, connectionID)}
	account := &model.Account{
		Connection: conn,
		Owner:      owner,
		Name:       "Checking",
		Type:       model.AccountTypeDepository,
	}
	test.MustUpsertAccount(t, accountsStore, "acc-1", account)
	pendingTxn := syncedTxn("tx-pending", 12, "2026-06-23T12:00:00Z", "")
	pendingTxn.AccountID = "acc-1"
	pendingTxn.Source = transactions.TransactionSourceSimpleFin
	pendingTxn.Pending = true
	mustUpsertSynced(t, txStore, pendingTxn)
	pending, err := txStore.PendingSimpleFinTransactionIDs(ctx, tokenID)
	if err != nil || len(pending) != 1 || pending[0] != "tx-pending" {
		t.Fatalf("PendingSimpleFinTransactionIDs() = %#v, %v", pending, err)
	}

	must.NoErr(t, txStore.LogSimpleFinSyncBatch(ctx, dbgen.LogSimpleFinSyncBatchParams{
		AccessTokenID:  tokenID,
		Added:          "[]",
		Modified:       "[]",
		PendingRemoved: "[]",
	}))
}

func TestPendingSimpleFinTransactionIDsUsesProviderFirstIndexes(t *testing.T) {
	_, txStore := openTestStore(t)

	dbtest.AssertQueryPlanUses(t, txStore.SQL(), `EXPLAIN QUERY PLAN
SELECT t.external_id
FROM simplefin_connections sc
CROSS JOIN connections c ON c.source_id = sc.id AND c.source_table = 'simplefin_connections'
CROSS JOIN accounts a ON a.connection_id = c.id
CROSS JOIN transactions t ON t.account_id = a.id
	WHERE sc.access_token_id = 1
	  AND t.source = 'simplefin'
	  AND t.pending = 1`,
		"idx_simplefin_connections_access_token",
		"idx_connections_source",
		"idx_accounts_connection",
		"idx_transactions_account",
	)
}
