package graph

import (
	"context"
	"testing"

	"tallyo/internal/admin"
	admindb "tallyo/internal/admin/db"
	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/database/dbtest"
	"tallyo/internal/graph/model"
)

func TestPlaidCredentialMutationResolvers(t *testing.T) {
	ctx := context.Background()
	db := dbtest.Open(t)
	store := admindb.New(db)
	resolver := &Resolver{Admin: admin.NewService(store, runtimeconfig.New(store))}
	mutation := resolver.Mutation().(*mutationResolver)

	created, err := mutation.CreatePlaidCredential(ctx, model.CreatePlaidCredentialInput{ClientID: "client", Secret: "secret", Environment: model.PlaidEnvironmentSandbox})
	if err != nil || created == nil {
		t.Fatalf("CreatePlaidCredential: %v, %v", created, err)
	}
	updated, err := mutation.UpdatePlaidCredential(ctx, model.UpdatePlaidCredentialInput{ID: created.Credential.ID, Secret: "secret-2", Environment: model.PlaidEnvironmentDevelopment})
	if err != nil || updated.Credential.Environment != model.PlaidEnvironmentDevelopment {
		t.Fatalf("UpdatePlaidCredential: %v, %v", updated, err)
	}
	deleted, err := mutation.DeletePlaidCredential(ctx, model.DeletePlaidCredentialInput{ID: created.Credential.ID})
	if err != nil || !deleted.Success {
		t.Fatalf("DeletePlaidCredential: %v, %v", deleted, err)
	}
}
