package graph

import (
	"context"
	"fmt"
	"time"

	"tallyo/internal/apierror"
	"tallyo/internal/graph/model"
)

func (r *Resolver) NetWorth(ctx context.Context, input model.NetWorthInput) (*model.NetWorthReport, error) {
	if err := validateNetWorthInput(&input); err != nil {
		return nil, err
	}
	return r.Wealth.NetWorth(ctx, input)
}

func (r *Resolver) HistoricalNetWorth(ctx context.Context, input model.HistoricalNetWorthInput) (*model.HistoricalNetWorthReport, error) {
	if err := validateNetWorthInput(input.Filters); err != nil {
		return nil, err
	}
	return r.Wealth.HistoricalNetWorth(ctx, input)
}

func (r *Resolver) QueryAccount(ctx context.Context, id model.GlobalID) (*model.Account, error) {
	accountID, err := id.Int64OfType(model.GlobalIDAccount)
	if err != nil {
		return nil, err
	}
	account, err := r.AccountsStore.AccountByID(ctx, accountID)
	if isNodeMissing(err) || account == nil {
		return nil, apierror.Publicf("account %q not found", id)
	}
	if err != nil {
		return nil, fmt.Errorf("account %q: %w", id, err)
	}
	return account, nil
}

func validateNetWorthInput(input *model.NetWorthInput) error {
	if input == nil {
		return nil
	}
	if _, err := model.LocalInt64IDsOfTypePtr(input.OwnerIds, model.GlobalIDOwner); err != nil {
		return err
	}
	if _, err := model.LocalInt64IDsOfTypePtr(input.AccountIds, model.GlobalIDAccount); err != nil {
		return err
	}
	return nil
}

func (r *Resolver) AccountLatestSnapshot(ctx context.Context, account *model.Account) (*model.AccountSnapshot, error) {
	return loadersFrom(ctx).AccountLatestSnapshot.Load(ctx, account.ID.Int64())()
}

func (r *Resolver) AccountLastBalanceSyncedAt(ctx context.Context, account *model.Account) (*time.Time, error) {
	return loadersFrom(ctx).AccountLastSyncedAt.Load(ctx, account.ID.Int64())()
}
