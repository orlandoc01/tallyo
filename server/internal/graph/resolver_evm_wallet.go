package graph

import (
	"context"

	"tallyo/internal/graph/model"

	"github.com/samber/lo"
)

func (r *Resolver) LinkEVMWallet(ctx context.Context, input model.LinkEVMWalletInput) (*model.LinkEVMWalletPayload, error) {
	ownerID, err := input.OwnerID.Int64OfType(model.GlobalIDOwner)
	if err != nil {
		return nil, err
	}
	label := lo.FromPtr(input.Label)
	return r.Linker.LinkEVMWallet(ctx, input.Address, ownerID, label, input.ChainIds)
}

func (r *Resolver) UnlinkEVMWallet(ctx context.Context, id model.GlobalID) (bool, error) {
	return unlinkConnection(ctx, id, func(ctx context.Context, connectionID int64) error {
		return r.AccountsStore.DeleteEVMWallet(ctx, connectionID)
	}, "unlink evm wallet")
}
