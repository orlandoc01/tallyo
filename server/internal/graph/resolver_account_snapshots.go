package graph

import (
	"context"

	"tallyo/internal/graph/model"
)

func (r *Resolver) AccountSnapshot(ctx context.Context, input model.AccountSnapshotInput) (*model.AccountSnapshot, error) {
	if err := validateAccountSnapshotInput(input); err != nil {
		return nil, err
	}
	return r.Wealth.AccountSnapshot(ctx, input)
}

func (r *Resolver) AccountSnapshots(
	ctx context.Context,
	input model.AccountSnapshotsInput,
) (*model.AccountSnapshotConnection, error) {
	if err := input.AccountID.ValidateType(model.GlobalIDAccount); err != nil {
		return nil, err
	}
	return r.Wealth.AccountSnapshots(ctx, input)
}

func (r *Resolver) ChangeAccountSnapshot(
	ctx context.Context,
	input model.ChangeAccountSnapshotInput,
) (*model.ChangeAccountSnapshotPayload, error) {
	if err := input.SnapshotID.ValidateType(model.GlobalIDSnapshot); err != nil {
		return nil, err
	}
	for _, holding := range input.Holdings {
		if err := holding.AssetID.ValidateType(model.GlobalIDAsset); err != nil {
			return nil, err
		}
	}
	return r.Wealth.ChangeAccountSnapshot(ctx, input)
}

func validateAccountSnapshotInput(input model.AccountSnapshotInput) error {
	if err := validateOptionalGlobalID(input.SnapshotID, model.GlobalIDSnapshot); err != nil {
		return err
	}
	return validateOptionalGlobalID(input.AccountID, model.GlobalIDAccount)
}
