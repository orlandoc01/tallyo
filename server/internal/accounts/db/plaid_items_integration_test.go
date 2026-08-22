package accountsdb

import (
	"context"
	"testing"
	"time"

	"tallyo/internal/accounts"
	admindb "tallyo/internal/admin/db"
	"tallyo/internal/database/dbtest"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func TestPlaidItemCRUDAndProductFlags(t *testing.T) {
	ctx := context.Background()
	db := dbtest.Open(t)
	store := New(db)
	adminStore := admindb.New(db)
	cred := test.MustCreatePlaidCredential(t, adminStore, model.CreatePlaidCredentialInput{ClientID: "client", Secret: "secret", Environment: model.PlaidEnvironmentSandbox})
	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "alex"})
	now := time.Now().UTC()
	item := accounts.PlaidItemSecret{ExternalID: "item", CredentialID: cred.ID, AccessToken: "token", OwnerID: owner.ID.Int64(), OwnerName: "alex", InstitutionID: new("ins"), InstitutionName: new("Bank"), NextSyncAt: &now, NextRecurringSyncAt: &now, NextBalanceSyncAt: &now}
	itemID, err := store.UpsertPlaidItem(ctx, item)
	must.NoErr(t, err)
	if _, err := db.SQL().ExecContext(ctx, `INSERT INTO connections (id, source_table, source_id, name, owner_id, is_active) VALUES (1, 'plaid_items', ?, 'Bank', ?, 1)`, itemID, owner.ID.Int64()); err != nil {
		t.Fatalf("insert connection: %v", err)
	}

	secret, err := store.PlaidItemSecret(ctx, itemID)
	if err != nil || secret == nil || secret.AccessToken != "token" {
		t.Fatalf("PlaidItemSecret: %v, %v", secret, err)
	}
	listed, err := store.PlaidItems(ctx, false)
	if err != nil || len(listed) != 1 || listed[0].ID.Int64() != itemID {
		t.Fatalf("PlaidItems: %#v, %v", listed, err)
	}
	all, err := store.PlaidItems(ctx, true)
	if err != nil || len(all) != 1 || all[0].ID.Int64() != itemID {
		t.Fatalf("PlaidItems(includeInactive): %#v, %v", all, err)
	}
	if missing, err := store.PlaidItem(ctx, 999); err != nil || missing != nil {
		t.Fatalf("PlaidItem(missing): %#v, %v", missing, err)
	}
	if missing, err := store.PlaidItemSecret(ctx, 999); err != nil || missing != nil {
		t.Fatalf("PlaidItemSecret(missing): %#v, %v", missing, err)
	}
	must.NoErr(t, store.SetPlaidProductFlags(ctx, itemID, true, true))
	must.NoErr(t, store.ResetItemSync(ctx, itemID))
}
