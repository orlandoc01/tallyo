package graph

import (
	"context"
	"fmt"

	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"

	"github.com/samber/lo"
)

// PlaidItems batch-hydrates each item's credential and accounts (two
// queries total) using existing batch methods, so callers that bypass
// GraphQL's per-field dataloaders — MCP tool calls in particular — see
// complete items instead of an empty accounts list and a credential stub.
func (r *Resolver) PlaidItems(ctx context.Context, input *model.PlaidItemsInput) (*model.PlaidItemList, error) {
	include := input != nil && lo.FromPtr(input.IncludeInactive)
	items, err := r.AccountsStore.PlaidItems(ctx, include)
	if err != nil {
		return nil, err
	}
	if err := r.hydratePlaidItems(ctx, items); err != nil {
		return nil, err
	}
	return &model.PlaidItemList{Items: items}, nil
}

func (r *Resolver) hydratePlaidItems(ctx context.Context, items []*model.PlaidItem) error {
	if len(items) == 0 {
		return nil
	}
	toItemID := func(item *model.PlaidItem) int64 { return item.ID.Int64() }
	accountsByItem, err := r.AccountsStore.AccountsByItems(ctx, u.Map(items, toItemID))
	if err != nil {
		return fmt.Errorf("load plaid item accounts: %w", err)
	}

	hasCredential := func(item *model.PlaidItem, _ int) bool { return item.Credential != nil }
	toCredentialID := func(item *model.PlaidItem) int32 { return item.Credential.ID }
	credentialIDs := lo.Uniq(u.Map(lo.Filter(items, hasCredential), toCredentialID))
	credentialsByID, err := r.Admin.PlaidCredentialsByIDs(ctx, credentialIDs)
	if err != nil {
		return fmt.Errorf("load plaid item credentials: %w", err)
	}

	for _, item := range items {
		item.Accounts = accountsByItem[item.ID.Int64()]
		if item.Accounts == nil {
			item.Accounts = []*model.Account{}
		}
		if item.Credential != nil {
			if credential, ok := credentialsByID[item.Credential.ID]; ok {
				item.Credential = credential
			}
		}
	}
	return nil
}

func (r *Resolver) PlaidCredentials(ctx context.Context) (*model.PlaidCredentialList, error) {
	return listResult(ctx, r.Admin.PlaidCredentials, func(items []*model.PlaidCredential) *model.PlaidCredentialList {
		return &model.PlaidCredentialList{Items: items}
	})
}

func (r *Resolver) CreatePlaidCredential(ctx context.Context, input model.CreatePlaidCredentialInput) (*model.CreatePlaidCredentialPayload, error) {
	credential, err := r.Admin.CreatePlaidCredential(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.CreatePlaidCredentialPayload{Credential: credential}, nil
}

func (r *Resolver) UpdatePlaidCredential(ctx context.Context, input model.UpdatePlaidCredentialInput) (*model.UpdatePlaidCredentialPayload, error) {
	credential, err := r.Admin.UpdatePlaidCredential(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.UpdatePlaidCredentialPayload{Credential: credential}, nil
}

func (r *Resolver) DeletePlaidCredential(ctx context.Context, input model.DeletePlaidCredentialInput) (*model.DeletePlaidCredentialPayload, error) {
	success, err := r.Admin.DeletePlaidCredential(ctx, int32(input.ID))
	if err != nil {
		return nil, err
	}
	return &model.DeletePlaidCredentialPayload{Success: success}, nil
}

func (r *Resolver) CreateLinkToken(ctx context.Context, input model.CreateLinkTokenInput) (*model.CreateLinkTokenPayload, error) {
	ownerID, err := input.OwnerID.Int64OfType(model.GlobalIDOwner)
	if err != nil {
		return nil, err
	}
	return r.Linker.CreateLinkToken(ctx, input.CredentialID, ownerID)
}

func (r *Resolver) ExchangePublicToken(ctx context.Context, input model.ExchangePublicTokenInput) (*model.ExchangePublicTokenPayload, error) {
	ownerID, err := input.OwnerID.Int64OfType(model.GlobalIDOwner)
	if err != nil {
		return nil, err
	}
	return r.Linker.ExchangePublicToken(
		ctx,
		input.PublicToken,
		input.CredentialID,
		ownerID,
		input.InstitutionID,
		input.InstitutionName,
	)
}

func (r *Resolver) CreateUpdateLinkToken(ctx context.Context, itemID model.GlobalID) (*model.CreateLinkTokenPayload, error) {
	localItemID, err := itemID.Int64OfType(model.GlobalIDPlaidItem)
	if err != nil {
		return nil, err
	}
	return r.Linker.CreateUpdateLinkToken(ctx, localItemID)
}

func (r *Resolver) CompleteLinkUpdate(ctx context.Context, itemID model.GlobalID) (*model.CompleteLinkUpdatePayload, error) {
	localItemID, err := itemID.Int64OfType(model.GlobalIDPlaidItem)
	if err != nil {
		return nil, err
	}
	return r.Linker.CompleteLinkUpdate(ctx, localItemID)
}
