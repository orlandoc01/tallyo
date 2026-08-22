package transactionsdb

import (
	"context"
	"testing"
	"time"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	admindb "tallyo/internal/admin/db"
	"tallyo/internal/database/dbtest"
	"tallyo/internal/graph/model"
	"tallyo/internal/transactions"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func TestPlaidSyncStateMethods(t *testing.T) {
	ctx := context.Background()
	db := dbtest.Open(t)
	store := New(db)
	adminStore := admindb.New(db)
	accountsStore := accountsdb.New(db)
	cred, err := adminStore.CreatePlaidCredential(ctx, model.CreatePlaidCredentialInput{ClientID: "client", Secret: "secret", Environment: model.PlaidEnvironmentSandbox})
	must.NoErr(t, err)
	owner := test.MustCreateOwner(t, accountsStore, model.CreateOwnerInput{Name: "alex"})
	past := time.Now().UTC().Add(-time.Hour)
	item := accounts.PlaidItemSecret{ExternalID: "item", CredentialID: cred.ID, AccessToken: "token", OwnerID: owner.ID.Int64(), OwnerName: "alex", NextSyncAt: &past, NextRecurringSyncAt: &past}
	itemID, err := accountsStore.UpsertPlaidItem(ctx, item)
	must.NoErr(t, err)
	if _, err := db.SQL().ExecContext(ctx, `INSERT INTO connections (id, source_table, source_id, name, owner_id, is_active) VALUES (1, 'plaid_items', ?, 'Bank', ?, 1)`, itemID, owner.ID.Int64()); err != nil {
		t.Fatalf("insert connection: %v", err)
	}

	secret, err := store.PlaidItemSecret(ctx, itemID)
	if err != nil || secret == nil || secret.AccessToken != "token" {
		t.Fatalf("PlaidItemSecret: %#v, %v", secret, err)
	}
	due, err := store.PlaidItemsDueForSync(ctx, time.Now().UTC())
	if err != nil || len(due) != 1 {
		t.Fatalf("PlaidItemsDueForSync: %#v, %v", due, err)
	}
	recurringDue, err := store.PlaidItemsDueForRecurringSync(ctx, time.Now().UTC())
	if err != nil || len(recurringDue) != 1 {
		t.Fatalf("PlaidItemsDueForRecurringSync: %#v, %v", recurringDue, err)
	}

	next := time.Now().UTC().Add(time.Hour)
	must.NoErr(t, store.SetSyncCursor(ctx, itemID, "cursor", next))
	cursor, err := store.SyncCursor(ctx, itemID)
	if err != nil || cursor != "cursor" {
		t.Fatalf("SyncCursor: %q, %v", cursor, err)
	}
	must.NoErr(t, store.SetItemRecurringSynced(ctx, itemID, next))
	var lastRecurringSyncedAt time.Time
	if err := db.SQL().QueryRowContext(ctx, `SELECT last_recurring_synced_at FROM plaid_items WHERE id = ?`, itemID).Scan(&lastRecurringSyncedAt); err != nil || lastRecurringSyncedAt.IsZero() {
		t.Fatalf("last_recurring_synced_at: %v, %v", lastRecurringSyncedAt, err)
	}
	must.NoErr(t, store.SetPlaidItemHealth(ctx, itemID, model.PlaidItemHealthStateSyncError, new("ERR"), new("boom")))
	must.NoErr(t, store.SetPlaidItemHealthy(ctx, itemID))
	must.NoErr(t, store.LogSyncBatch(ctx, transactions.SyncBatchLog{ItemID: itemID, Added: "[]", Modified: "[]", Removed: "[]"}))
}
