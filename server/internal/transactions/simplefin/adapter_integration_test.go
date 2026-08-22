package txnsimplefin

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"testing"
	"time"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/graph/model"
	"tallyo/internal/transactions"
	transactionsdb "tallyo/internal/transactions/db"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func TestSyncTokenPartialResponseUpdatesFailedConnectionHealthInDB(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)
	base := test.OpenStore(t)
	accountsStore := accountsdb.New(base.Database())
	txStore := transactionsdb.New(base.Database())
	owner := test.MustCreateOwner(t, accountsStore, model.CreateOwnerInput{Name: "alex"})
	token, err := accountsStore.CreateSimpleFinAccessToken(
		ctx,
		"https://user:pass@bridge.example/simplefin",
		owner.ID.Int64(),
		"Bridge",
	)
	must.NoErr(t, err)
	tokenID := token.ID.Int64()
	_, _, err = accountsStore.LinkSimpleFinConnection(ctx, simpleFinConnParams(tokenID, owner.ID.Int64(), "healthy-conn", "Healthy Bank"))
	must.NoErr(t, err)
	failedConnID, failedConnectionID, err := accountsStore.LinkSimpleFinConnection(ctx, simpleFinConnParams(tokenID, owner.ID.Int64(), "failed-conn", "Failed Bank"))
	must.NoErr(t, err)
	must.NoErr(t, txStore.UpsertSyncedAccount(ctx, transactions.AccountDraft{
		ID:           "failed-account",
		ConnectionID: failedConnectionID,
		OwnerID:      owner.ID.Int64(),
		Name:         "Failed Checking",
		Type:         model.AccountTypeDepository,
	}))
	_, err = txStore.UpsertSyncedTransaction(ctx, transactions.SyncedTransaction{
		ExternalID:     "failed-pending",
		AccountID:      "failed-account",
		Amount:         12,
		Datetime:       now,
		PostedDatetime: now,
		Source:         transactions.TransactionSourceSimpleFin,
		Pending:        true,
	})
	must.NoErr(t, err)
	lastBefore, nextBefore := simpleFinTokenSyncState(t, base.SQL(), tokenID)
	client := test.SimpleFinClientStub{ClaimErr: errors.New("not used"), Accounts: partialSimpleFinAccountSet(now)}
	last := now.Add(-24 * time.Hour)
	adapter := &Adapter{store: txStore, accounts: accountsStore, client: client, now: func() time.Time { return now }, log: test.Logger}
	report := adapter.syncToken(ctx, accounts.SimpleFinAccessTokenSecret{
		ID:           tokenID,
		AccessURL:    "https://user:pass@bridge.example/simplefin",
		OwnerID:      owner.ID.Int64(),
		SyncCron:     accountsdb.DefaultSimpleFinSyncCron,
		LastSyncedAt: &last,
	}, &transactions.Persister{Store: txStore})
	if report.Err != nil {
		t.Fatalf("syncToken() error = %v", report.Err)
	}
	state, message := simpleFinConnectionHealth(t, base.SQL(), failedConnID)
	if state != string(model.PlaidItemHealthStateSyncError) || message == nil || *message != "temporarily unavailable" {
		t.Fatalf("failed connection health = %q, %#v", state, message)
	}
	pending, err := txStore.PendingSimpleFinTransactionIDs(ctx, tokenID)
	must.NoErr(t, err)
	if !slices.Contains(pending, "failed-pending") {
		t.Fatalf("pending SimpleFIN transactions = %#v", pending)
	}
	if tx := test.MustTransactionBySourceExternalID(
		t,
		txStore,
		transactions.TransactionSourceSimpleFin,
		"healthy-tx",
		"TransactionByExternalID() error = %v",
	); tx == nil {
		t.Fatal("healthy transaction was not persisted")
	}
	lastAfter, nextAfter := simpleFinTokenSyncState(t, base.SQL(), tokenID)
	if lastAfter != lastBefore || nextAfter != nextBefore {
		t.Fatalf("token sync state changed: before=(%q,%q) after=(%q,%q)", lastBefore, nextBefore, lastAfter, nextAfter)
	}
}

func simpleFinConnParams(tokenID, ownerID int64, externalID, name string) accounts.UpsertSimpleFinConnectionParams {
	return accounts.UpsertSimpleFinConnectionParams{ExternalID: externalID, AccessTokenID: tokenID, Name: name, OwnerID: ownerID}
}

func simpleFinTokenSyncState(tb testing.TB, db *sql.DB, tokenID int64) (lastSyncedAt string, nextSyncAt string) {
	tb.Helper()
	must.NoErr(tb, db.QueryRowContext(
		tb.Context(),
		`SELECT COALESCE(last_synced_at, ''), next_sync_at FROM simplefin_access_tokens WHERE id = ?`,
		tokenID,
	).Scan(&lastSyncedAt, &nextSyncAt))
	return lastSyncedAt, nextSyncAt
}

func simpleFinConnectionHealth(tb testing.TB, db *sql.DB, connID int64) (string, *string) {
	tb.Helper()
	var state string
	var message sql.NullString
	must.NoErr(tb, db.QueryRowContext(
		tb.Context(),
		`SELECT health_state, health_error_message FROM simplefin_connections WHERE id = ?`,
		connID,
	).Scan(&state, &message))
	if !message.Valid {
		return state, nil
	}
	return state, &message.String
}
