package graph

import (
	"context"

	"tallyo/internal/graph/model"
)

func (r *Resolver) CreateCategoryGroup(ctx context.Context, input model.CreateCategoryGroupInput) (*model.CreateCategoryGroupPayload, error) {
	group, err := r.TransactionsStore.CreateCategoryGroup(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.CreateCategoryGroupPayload{Group: group}, nil
}

func (r *Resolver) UpdateCategoryGroup(ctx context.Context, input model.UpdateCategoryGroupInput) (*model.UpdateCategoryGroupPayload, error) {
	if err := input.ID.ValidateType(model.GlobalIDCategoryGroup); err != nil {
		return nil, err
	}
	group, err := r.TransactionsStore.UpdateCategoryGroup(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.UpdateCategoryGroupPayload{Group: group}, nil
}

func (r *Resolver) DeleteCategoryGroup(ctx context.Context, id model.GlobalID) (*model.DeleteCategoryGroupPayload, error) {
	groupID, err := id.Int64OfType(model.GlobalIDCategoryGroup)
	if err != nil {
		return nil, err
	}
	success, err := r.TransactionsStore.DeleteCategoryGroup(ctx, groupID)
	if err != nil {
		return nil, err
	}
	return &model.DeleteCategoryGroupPayload{Success: success}, nil
}

func (r *Resolver) CreateCategory(ctx context.Context, input model.CreateCategoryInput) (*model.CreateCategoryPayload, error) {
	if err := input.GroupID.ValidateType(model.GlobalIDCategoryGroup); err != nil {
		return nil, err
	}
	category, err := r.TransactionsStore.CreateCategory(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.CreateCategoryPayload{Category: category}, nil
}

func (r *Resolver) UpdateCategory(ctx context.Context, input model.UpdateCategoryInput) (*model.UpdateCategoryPayload, error) {
	if err := validateCategoryInput(input.ID, input.GroupID); err != nil {
		return nil, err
	}
	category, err := r.TransactionsStore.UpdateCategory(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.UpdateCategoryPayload{Category: category}, nil
}

func (r *Resolver) DeleteCategory(ctx context.Context, id model.GlobalID) (*model.DeleteCategoryPayload, error) {
	categoryID, err := id.Int64OfType(model.GlobalIDCategory)
	if err != nil {
		return nil, err
	}
	success, err := r.TransactionsStore.DeleteCategory(ctx, categoryID)
	if err != nil {
		return nil, err
	}
	return &model.DeleteCategoryPayload{Success: success}, nil
}

func (r *Resolver) ReorderCategories(ctx context.Context, input model.ReorderCategoriesInput) (*model.ReorderCategoriesPayload, error) {
	if err := input.GroupID.ValidateType(model.GlobalIDCategoryGroup); err != nil {
		return nil, err
	}
	if _, err := model.LocalInt64IDsOfTypePtr(input.CategoryIds, model.GlobalIDCategory); err != nil {
		return nil, err
	}
	group, err := r.TransactionsStore.ReorderCategories(ctx, input)
	if err != nil {
		return nil, err
	}
	return &model.ReorderCategoriesPayload{Group: group}, nil
}

func validateCategoryInput(categoryID, groupID model.GlobalID) error {
	if err := categoryID.ValidateType(model.GlobalIDCategory); err != nil {
		return err
	}
	return groupID.ValidateType(model.GlobalIDCategoryGroup)
}
