package transactionsdb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"tallyo/internal/apierror"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/graph/model"
	"tallyo/internal/transactions/pfc2"
)

func (s *Store) CreateCategory(ctx context.Context, input model.CreateCategoryInput) (*model.Category, error) {
	groupID := input.GroupID.Int64()
	var id int64
	err := s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		if err := ensureCategoryGroupExists(ctx, q, groupID); err != nil {
			return err
		}
		newID, err := q.CreateCategory(ctx, dbgen.CreateCategoryParams{Name: input.Name, Emoji: input.Emoji, GroupID: groupID})
		if err != nil {
			return err
		}
		id = newID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.Category(ctx, id)
}

func (s *Store) UpdateCategory(ctx context.Context, input model.UpdateCategoryInput) (*model.Category, error) {
	categoryID := input.ID.Int64()
	groupID := input.GroupID.Int64()
	err := s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		if err := ensureCategoryGroupExists(ctx, q, groupID); err != nil {
			return err
		}
		if err := updateCategoryFields(ctx, q, input, categoryID, groupID); err != nil {
			return err
		}
		if input.PlaidPFC2Codes != nil {
			return replaceCategoryPlaidMappings(ctx, q, categoryID, input.PlaidPFC2Codes)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.Category(ctx, categoryID)
}

func replaceCategoryPlaidMappings(ctx context.Context, q *dbgen.Queries, categoryID int64, codes []string) error {
	normalized := pfc2.Normalize(codes)
	for _, code := range normalized {
		if !pfc2.Valid(code) {
			return fmt.Errorf("invalid Plaid PFC2 code %q", code)
		}
		ownerName, err := q.PFC2MappedCategoryName(ctx, dbgen.PFC2MappedCategoryNameParams{PlaidDetailed: code, CategoryID: categoryID})
		if err == nil {
			return fmt.Errorf("PFC2 code %s is already assigned to %s", code, ownerName)
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
	}
	if err := q.DeleteCategoryPlaidMappings(ctx, dbgen.DeleteCategoryPlaidMappingsParams{CategoryID: categoryID}); err != nil {
		return err
	}
	for _, code := range normalized {
		if err := q.UpsertCategoryPlaidMapping(ctx, dbgen.UpsertCategoryPlaidMappingParams{PlaidDetailed: code, CategoryID: categoryID}); err != nil {
			return err
		}
	}
	return nil
}

func ensureCategoryGroupExists(ctx context.Context, q *dbgen.Queries, groupID int64) error {
	_, err := q.CategoryGroupByID(ctx, dbgen.CategoryGroupByIDParams{ID: groupID})
	if errors.Is(err, sql.ErrNoRows) {
		return apierror.Publicf("category group %d not found", groupID)
	}
	return err
}

func updateCategoryFields(ctx context.Context, q *dbgen.Queries, input model.UpdateCategoryInput, categoryID int64, groupID int64) error {
	rows, err := q.UpdateCategoryFields(ctx, dbgen.UpdateCategoryFieldsParams{Name: input.Name, Emoji: input.Emoji, GroupID: groupID, ID: categoryID})
	if err != nil {
		return err
	}
	if rows == 0 {
		return apierror.Publicf("category %d not found", categoryID)
	}
	return nil
}
