package graph

import (
	"context"

	"tallyo/internal/graph/model"

	"github.com/samber/lo"
)

func (r *Resolver) CreateAsset(ctx context.Context, input model.CreateAssetInput) (*model.CreateAssetPayload, error) {
	asset, err := r.Wealth.CreateAsset(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.CreateAssetPayload{Asset: asset}, nil
}

func (r *Resolver) UpdateAsset(ctx context.Context, input model.UpdateAssetInput) (*model.UpdateAssetPayload, error) {
	if err := input.ID.ValidateType(model.GlobalIDAsset); err != nil {
		return nil, err
	}
	asset, err := r.Wealth.UpdateAsset(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.UpdateAssetPayload{Asset: asset}, nil
}

func (r *Resolver) MergeAsset(ctx context.Context, input model.MergeAssetInput) (*model.MergeAssetPayload, error) {
	if err := input.AssetID.ValidateType(model.GlobalIDAsset); err != nil {
		return nil, err
	}
	asset, err := r.Wealth.MergeAsset(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.MergeAssetPayload{Asset: asset}, nil
}

func (r *Resolver) AssetAdapterSources(ctx context.Context, obj *model.Asset) ([]*model.AssetAdapterSource, error) {
	return loadersFrom(ctx).AssetAdapterSources.Load(ctx, obj.ID.Int64())()
}

// AssetLatestSnapshot resolves Asset.latestSnapshot. A nil snapshot means "not
// currently held" — not an error.
func (r *Resolver) AssetLatestSnapshot(ctx context.Context, obj *model.Asset) (*model.AssetSnapshot, error) {
	return loadersFrom(ctx).AssetLatestSnapshot.Load(ctx, obj.ID.Int64())()
}

func (r *Resolver) Assets(ctx context.Context, input *model.AssetsInput) (*model.AssetList, error) {
	assets, err := r.Wealth.Assets(ctx, lo.FromPtr(input))
	if err != nil {
		return nil, err
	}
	return &model.AssetList{Items: assets}, nil
}

func (r *Resolver) QueryAssetQuote(ctx context.Context, ticker string) (*model.AssetQuote, error) {
	return r.Wealth.Quote(ctx, ticker)
}
