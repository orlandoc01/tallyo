package wealthdb

import (
	"context"
	"testing"
	"time"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	admindb "tallyo/internal/admin/db"
	"tallyo/internal/database/dbtest"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func TestPlaidBalanceScheduling(t *testing.T) {
	ctx := context.Background()
	db := dbtest.Open(t)
	store := New(db)
	accountsStore := accountsdb.New(db)
	adminStore := admindb.New(db)
	cred, err := adminStore.CreatePlaidCredential(ctx, model.CreatePlaidCredentialInput{ClientID: "client", Secret: "secret", Environment: model.PlaidEnvironmentSandbox})
	must.NoErr(t, err)
	owner := test.MustCreateOwner(t, accountsStore, model.CreateOwnerInput{Name: "alex"})
	past := time.Now().UTC().Add(-time.Hour)
	itemID, err := accountsStore.UpsertPlaidItem(ctx, accounts.PlaidItemSecret{ExternalID: "item", CredentialID: cred.ID, AccessToken: "token", OwnerID: owner.ID.Int64(), OwnerName: "alex", NextBalanceSyncAt: &past})
	must.NoErr(t, err)
	if _, err := db.SQL().ExecContext(ctx, `INSERT INTO connections (id, source_table, source_id, name, owner_id, is_active) VALUES (1, 'plaid_items', ?, 'Bank', ?, 1)`, itemID, owner.ID.Int64()); err != nil {
		t.Fatalf("insert connection: %v", err)
	}
	if _, err := db.SQL().ExecContext(ctx, `INSERT INTO accounts (id, external_id, connection_id, owner_id, name, type) VALUES (1, 'acc', 1, ?, 'Checking', 'depository')`, owner.ID.Int64()); err != nil {
		t.Fatalf("insert account: %v", err)
	}

	due, err := store.PlaidItemsDueForBalanceSync(ctx, time.Now().UTC())
	if err != nil || len(due) != 1 {
		t.Fatalf("PlaidItemsDueForBalanceSync: %#v, %v", due, err)
	}
	secret, err := store.PlaidItemSecretByID(ctx, itemID)
	if err != nil || secret == nil || secret.AccessToken != "token" {
		t.Fatalf("PlaidItemSecretByID: %#v, %v", secret, err)
	}
	next := time.Now().UTC().Add(time.Hour)
	must.NoErr(t, store.SetItemBalanceSynced(ctx, itemID, next))
}
