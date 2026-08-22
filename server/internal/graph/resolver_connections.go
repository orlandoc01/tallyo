package graph

import (
	"context"
	"fmt"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/apierror"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"

	"github.com/samber/lo"
)

func (r *Resolver) Connections(ctx context.Context, input *model.ConnectionsInput) (*model.ConnectionList, error) {
	include := input != nil && lo.FromPtr(input.IncludeInactive)
	conns, err := r.AccountsStore.Connections(ctx, include)
	if err != nil {
		return nil, err
	}
	return &model.ConnectionList{Items: conns}, nil
}

func (r *Resolver) ConnectionProvider(ctx context.Context, obj *model.Connection) (model.ConnectionProvider, error) {
	switch accounts.SourceTable(obj.SourceTable) {
	case accounts.SourceTablePlaidItem:
		item, err := loadersFrom(ctx).PlaidItem.Load(ctx, obj.SourceID)()
		if err != nil {
			return nil, err
		}
		if item == nil {
			return nil, fmt.Errorf("plaid item %d not found", obj.SourceID)
		}
		return item, nil
	case accounts.SourceTableEVMWallet:
		connectionID := obj.ID.Int64()
		wallet, err := loadersFrom(ctx).EVMWallet.Load(ctx, connectionID)()
		if err != nil {
			return nil, err
		}
		if wallet == nil {
			return nil, fmt.Errorf("evm wallet for connection %d not found", connectionID)
		}
		return &model.EVMWallet{Address: wallet.Address, ChainIds: wallet.ChainIDs}, nil
	case accounts.SourceTableSimpleFinConnection:
		conn, err := loadersFrom(ctx).SimpleFinConnection.Load(ctx, obj.SourceID)()
		if err != nil {
			return nil, err
		}
		if conn == nil {
			return nil, fmt.Errorf("simplefin connection %d not found", obj.SourceID)
		}
		return conn, nil
	case accounts.SourceTableAsset:
		return nil, nil
	default:
		return nil, fmt.Errorf("unknown source table %q", obj.SourceTable)
	}
}

func (r *Resolver) UpdateConnection(ctx context.Context, input model.UpdateConnectionInput) (*model.UpdateConnectionPayload, error) {
	connectionID, err := input.ConnectionID.Int64OfType(model.GlobalIDConnection)
	if err != nil {
		return nil, err
	}
	var nextSyncAt *time.Time
	var nextRecurringSyncAt *time.Time
	if input.SyncCron != nil || input.RecurringSyncCron != nil {
		if input.SyncCron == nil || input.RecurringSyncCron == nil {
			return nil, apierror.Publicf("syncCron and recurringSyncCron are required together")
		}
		for _, cron := range []struct {
			name string
			expr string
		}{
			{"syncCron", *input.SyncCron},
			{"recurringSyncCron", *input.RecurringSyncCron},
		} {
			if err := u.ValidateMinInterval(cron.expr, time.Hour); err != nil {
				return nil, apierror.Public(fmt.Errorf("%s: %w", cron.name, err))
			}
		}
		now := time.Now().UTC()
		next, err := u.NextAfter(*input.SyncCron, now)
		if err != nil {
			return nil, apierror.Public(fmt.Errorf("syncCron: %w", err))
		}
		nextRecurring, err := u.NextAfter(*input.RecurringSyncCron, now)
		if err != nil {
			return nil, apierror.Public(fmt.Errorf("recurringSyncCron: %w", err))
		}
		nextSyncAt = &next
		nextRecurringSyncAt = &nextRecurring
	}
	conn, err := r.AccountsStore.UpdateConnection(ctx, accounts.UpdateConnectionInput{
		ConnectionID:        connectionID,
		IsActive:            input.IsActive,
		SyncCron:            input.SyncCron,
		RecurringSyncCron:   input.RecurringSyncCron,
		NextSyncAt:          nextSyncAt,
		NextRecurringSyncAt: nextRecurringSyncAt,
		EVMChainIDs:         input.ChainIds,
	})
	if err != nil {
		return nil, err
	}
	if conn == nil {
		return nil, apierror.Publicf("connection %d not found", connectionID)
	}
	return &model.UpdateConnectionPayload{Connection: conn}, nil
}

func (r *Resolver) DeleteConnection(ctx context.Context, input model.DeleteConnectionInput) (*model.DeleteConnectionPayload, error) {
	connectionID, err := input.ConnectionID.Int64OfType(model.GlobalIDConnection)
	if err != nil {
		return nil, err
	}
	success, err := r.AccountsStore.DeleteConnection(ctx, connectionID)
	if err != nil {
		return nil, err
	}
	return &model.DeleteConnectionPayload{Success: success}, nil
}

func unlinkConnection(ctx context.Context, id model.GlobalID, del func(context.Context, int64) error, action string) (bool, error) {
	connectionID, err := id.Int64OfType(model.GlobalIDConnection)
	if err != nil {
		return false, err
	}
	if err := del(ctx, connectionID); err != nil {
		return false, fmt.Errorf("%s: %w", action, err)
	}
	return true, nil
}
