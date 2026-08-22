package plaidfactory

import (
	"context"
	"testing"

	"tallyo/internal/clients"
)

type fakeCredentialStore map[int32]*clients.PlaidCredential

func (s fakeCredentialStore) CredentialByID(ctx context.Context, credentialID int32) (*clients.PlaidCredential, error) {
	return s[credentialID], nil
}

func TestStoreClientFactoryBuildsClients(t *testing.T) {
	ctx := context.Background()
	factory := &StoreClientFactory{Store: fakeCredentialStore{
		1: {ClientID: "client", Secret: "secret", Environment: "sandbox"},
	}}
	first, err := factory.ClientForCredential(ctx, 1)
	if err != nil || first == nil {
		t.Fatalf("ClientForCredential() = %#v, %v", first, err)
	}
	second, err := factory.ClientForCredential(ctx, 1)
	if err != nil || second == nil {
		t.Fatalf("second ClientForCredential() = %#v, %v", second, err)
	}
	if first == second {
		t.Fatalf("ClientForCredential() reused cached client")
	}
	if _, err := factory.ClientForCredential(ctx, -1); err == nil {
		t.Fatalf("expected missing credential error")
	}
}
