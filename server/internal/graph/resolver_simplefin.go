package graph

import (
	"context"

	"tallyo/internal/apierror"
	"tallyo/internal/graph/model"

	"github.com/samber/lo"
)

func (r *Resolver) SimpleFinAccessTokens(ctx context.Context) (*model.SimpleFinAccessTokenList, error) {
	return listResult(ctx, r.AccountsStore.SimpleFinAccessTokens, func(items []*model.SimpleFinAccessToken) *model.SimpleFinAccessTokenList {
		return &model.SimpleFinAccessTokenList{Items: items}
	})
}

func (r *Resolver) SimpleFinAccessTokenConnections(ctx context.Context, obj *model.SimpleFinAccessToken) ([]*model.SimpleFinConnection, error) {
	connections, err := loadersFrom(ctx).SimpleFinConnectionsByToken.Load(ctx, obj.ID.Int64())()
	if connections == nil || err != nil {
		return []*model.SimpleFinConnection{}, err
	}
	return connections, nil
}

func (r *Resolver) CreateSimpleFinAccessToken(
	ctx context.Context,
	input model.CreateSimpleFinAccessTokenInput,
) (*model.CreateSimpleFinAccessTokenPayload, error) {
	ownerID, err := input.OwnerID.Int64OfType(model.GlobalIDOwner)
	if err != nil {
		return nil, err
	}
	label := lo.FromPtr(input.Label)
	return r.SimpleFin.CreateAccessToken(ctx, input.SetupToken, ownerID, label)
}

func (r *Resolver) DeleteSimpleFinAccessToken(ctx context.Context, id model.GlobalID) (bool, error) {
	localID, err := id.Int64OfType(model.GlobalIDSimpleFinAccessToken)
	if err != nil {
		return false, err
	}
	if err := r.SimpleFin.DeleteAccessToken(ctx, localID); err != nil {
		return false, err
	}
	return true, nil
}

func (r *Resolver) ResetSimpleFinSync(ctx context.Context, id model.GlobalID) (*model.SimpleFinAccessToken, error) {
	localID, err := id.Int64OfType(model.GlobalIDSimpleFinAccessToken)
	if err != nil {
		return nil, err
	}
	token, err := r.SimpleFin.ResetSync(ctx, localID)
	if err != nil || token != nil {
		return token, err
	}
	return nil, apierror.Publicf("simplefin access token %d not found", localID)
}
