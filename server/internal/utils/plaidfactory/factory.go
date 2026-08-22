package plaidfactory

import (
	"context"
	"fmt"

	"tallyo/internal/clients"
)

type CredentialStore interface {
	CredentialByID(ctx context.Context, credentialID int32) (*clients.PlaidCredential, error)
}

type StoreClientFactory struct {
	Store CredentialStore
}

func (f *StoreClientFactory) ClientForCredential(ctx context.Context, credentialID int32) (clients.PlaidClient, error) {
	credential, err := f.Store.CredentialByID(ctx, credentialID)
	if err != nil {
		return nil, err
	}
	if credential == nil {
		return nil, fmt.Errorf("plaid credential %d not found", credentialID)
	}
	return clients.NewPlaidSDKClient(*credential), nil
}
