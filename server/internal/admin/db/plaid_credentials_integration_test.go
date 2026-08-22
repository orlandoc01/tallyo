package db

import (
	"context"
	"testing"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/database/dbtest"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
)

func TestPlaidCredentialCRUD(t *testing.T) {
	ctx := context.Background()
	db := dbtest.Open(t)
	store := New(db)
	accountsStore := accountsdb.New(db)

	created, err := store.CreatePlaidCredential(ctx, model.CreatePlaidCredentialInput{ClientID: "client-1", Secret: "secret-1", Environment: model.PlaidEnvironmentDevelopment, Label: new("Primary")})
	must.NoErr(t, err)
	if created.ClientID != "client-1" || created.Environment != model.PlaidEnvironmentDevelopment || created.Label == nil {
		t.Fatalf("unexpected credential: %+v", created)
	}

	secret, err := store.CredentialByID(ctx, created.ID)
	if err != nil || secret == nil || secret.Secret != "secret-1" {
		t.Fatalf("CredentialByID: %v, %v", secret, err)
	}
	credentials, err := store.PlaidCredentials(ctx)
	if err != nil || len(credentials) != 1 || credentials[0].ID != created.ID {
		t.Fatalf("PlaidCredentials: %v, %v", credentials, err)
	}

	updated, err := store.UpdatePlaidCredential(ctx, model.UpdatePlaidCredentialInput{ID: created.ID, Secret: "secret-2", Environment: model.PlaidEnvironmentProduction})
	if err != nil || updated.Environment != model.PlaidEnvironmentProduction {
		t.Fatalf("UpdatePlaidCredential: %v, %v", updated, err)
	}

	owner, err := accountsStore.CreateOwner(ctx, model.CreateOwnerInput{Name: "alex"})
	must.NoErr(t, err)
	itemID, err := accountsStore.UpsertPlaidItem(ctx, accounts.PlaidItemSecret{ExternalID: "item-1", CredentialID: created.ID, AccessToken: "token", OwnerID: owner.ID.Int64(), OwnerName: owner.Name})
	must.NoErr(t, err)
	institutionName := "Bank"
	conn, err := accountsStore.CreateConnection(ctx, itemID, &institutionName, owner.ID.Int64())
	must.NoErr(t, err)
	credentialsByID, err := store.PlaidCredentialsByIDs(ctx, []int32{created.ID, 999})
	if err != nil || len(credentialsByID) != 1 || credentialsByID[created.ID].ClientID != "client-1" || credentialsByID[created.ID].ItemCount != 1 {
		t.Fatalf("PlaidCredentialsByIDs: %#v, %v", credentialsByID, err)
	}
	if _, err := accountsStore.DeleteConnection(ctx, conn.ID.Int64()); err != nil {
		t.Fatalf("DeleteConnection: %v", err)
	}
	ok, err := store.DeletePlaidCredential(ctx, created.ID)
	if err != nil || !ok {
		t.Fatalf("DeletePlaidCredential: %v, %v", ok, err)
	}
	missing, err := store.PlaidCredential(ctx, created.ID)
	if err != nil || missing != nil {
		t.Fatalf("PlaidCredential after delete: %v, %v", missing, err)
	}
}
