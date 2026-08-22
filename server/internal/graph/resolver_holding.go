package graph

import (
	"context"

	"tallyo/internal/apierror"
	"tallyo/internal/graph/model"
)

// HoldingAccount resolves Holding.account: eager first (both construction paths
// that already join Account populate obj.Account directly), falling back to a
// request-scoped DataLoader for construction paths that have just the ID
// (historical snapshot holdings). Named HoldingAccount, not Account, because
// Resolver.Account() already exists as the gqlgen Account resolver factory.
func (r *Resolver) HoldingAccount(ctx context.Context, obj *model.Holding) (*model.Account, error) {
	if obj.Account != nil {
		return obj.Account, nil
	}
	account, err := loadersFrom(ctx).Account.Load(ctx, obj.AccountID.Int64())()
	if err != nil {
		return nil, err
	}
	if account == nil {
		return nil, apierror.Publicf("account %q not found", obj.AccountID)
	}
	return account, nil
}
