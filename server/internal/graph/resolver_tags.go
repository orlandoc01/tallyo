package graph

import (
	"context"

	"tallyo/internal/graph/model"
)

func (r *Resolver) Tags(ctx context.Context) (*model.TagList, error) {
	return listResult(ctx, r.TransactionsStore.Tags, func(items []*model.Tag) *model.TagList { return &model.TagList{Items: items} })
}

func (r *Resolver) CreateTag(ctx context.Context, input model.CreateTagInput) (*model.CreateTagPayload, error) {
	tag, err := r.TransactionsStore.CreateTag(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.CreateTagPayload{Tag: tag}, nil
}

func (r *Resolver) UpdateTag(ctx context.Context, input model.UpdateTagInput) (*model.UpdateTagPayload, error) {
	if err := input.ID.ValidateType(model.GlobalIDTag); err != nil {
		return nil, err
	}
	tag, err := r.TransactionsStore.UpdateTag(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.UpdateTagPayload{Tag: tag}, nil
}

func (r *Resolver) DeleteTag(ctx context.Context, id model.GlobalID) (*model.DeleteTagPayload, error) {
	tagID, err := id.Int64OfType(model.GlobalIDTag)
	if err != nil {
		return nil, err
	}
	success, err := r.TransactionsStore.DeleteTag(ctx, tagID)
	if err != nil {
		return nil, err
	}
	return &model.DeleteTagPayload{Success: success}, nil
}

func (r *Resolver) TransactionTags(ctx context.Context, obj *model.Transaction) ([]*model.Tag, error) {
	if obj.Tags != nil {
		return obj.Tags, nil
	}
	tags, err := loadersFrom(ctx).TransactionTags.Load(ctx, obj.ID.Int64())()
	if tags == nil || err != nil {
		return []*model.Tag{}, err
	}
	return tags, nil
}

func (r *Resolver) RuleTags(ctx context.Context, obj *model.Rule) ([]*model.Tag, error) {
	if obj.Tags != nil {
		return obj.Tags, nil
	}
	return loadersFrom(ctx).RuleTags.Load(ctx, obj.ID.Int64())()
}
