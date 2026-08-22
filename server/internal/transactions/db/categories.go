package transactionsdb

import (
	"context"
	"database/sql"
	"errors"

	"github.com/samber/lo"

	"tallyo/internal/apierror"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"
)

func categoryFromRow(row dbgen.CategoryRow) *model.Category {
	return &model.Category{ID: model.New(model.GlobalIDCategory, row.CatID), Name: row.CatName, Emoji: row.CatEmoji, GroupName: row.GroupName, GroupEmoji: row.GroupEmoji, Kind: model.CategoryKind(row.GroupKind), SortOrder: int32(row.SortOrder), PlaidPFC2Codes: dbutil.SplitCSV(row.PlaidPfc2Codes)}
}

func categoryFromListRow(row dbgen.ListCategoriesRow) *model.Category {
	return categoryFromRow(dbgen.CategoryRow{CatID: row.CatID, CatName: row.CatName, CatEmoji: row.CatEmoji, GroupName: row.GroupName, GroupEmoji: row.GroupEmoji, GroupKind: row.GroupKind, SortOrder: row.SortOrder, GroupID: row.GroupID, PlaidPfc2Codes: row.PlaidPfc2Codes})
}

func (s *Store) Categories(ctx context.Context) ([]*model.Category, error) {
	rows, err := s.q.ListCategories(ctx, dbgen.ListCategoriesParams{})
	return dbutil.MapRows(rows, err, categoryFromListRow)
}

func (s *Store) CategoryGroups(ctx context.Context) ([]*model.CategoryGroup, error) {
	rows, err := s.q.ListCategories(ctx, dbgen.ListCategoriesParams{GroupOrder: true})
	if err != nil {
		return nil, err
	}
	groups := make([]*model.CategoryGroup, 0)
	index := make(map[int64]*model.CategoryGroup)
	for _, row := range rows {
		cat := categoryFromListRow(row)
		groupID := row.GroupID
		group := index[groupID]
		if group == nil {
			group = &model.CategoryGroup{ID: model.New(model.GlobalIDCategoryGroup, groupID), Name: cat.GroupName, Emoji: cat.GroupEmoji, Kind: cat.Kind}
			index[groupID] = group
			groups = append(groups, group)
		}
		group.Categories = append(group.Categories, cat)
	}
	return groups, nil
}

func (s *Store) Category(ctx context.Context, id int64) (*model.Category, error) {
	rows, err := s.q.ListCategories(ctx, dbgen.ListCategoriesParams{CategoryIds: []int64{id}})
	return dbutil.MapFirstRow(rows, err, categoryFromListRow)
}

func (s *Store) CategoryGroupByID(ctx context.Context, id int64) (*model.CategoryGroup, error) {
	row, err := s.q.CategoryGroupByID(ctx, dbgen.CategoryGroupByIDParams{ID: id})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	catRows, err := s.q.ListCategories(ctx, dbgen.ListCategoriesParams{GroupID: &id})
	if err != nil {
		return nil, err
	}
	group := model.CategoryGroup{ID: model.New(model.GlobalIDCategoryGroup, row.ID), Name: row.Name, Emoji: row.Emoji, Kind: model.CategoryKind(row.Kind)}
	group.Categories = u.Map(catRows, categoryFromListRow)
	return &group, nil
}

func (s *Store) CreateCategoryGroup(ctx context.Context, input model.CreateCategoryGroupInput) (*model.CategoryGroup, error) {
	id, err := s.q.CreateCategoryGroup(ctx, dbgen.CreateCategoryGroupParams{Name: input.Name, Emoji: input.Emoji, Kind: string(input.Kind), SortOrder: 0})
	if err != nil {
		return nil, err
	}
	return s.CategoryGroupByID(ctx, id)
}

func (s *Store) UpdateCategoryGroup(ctx context.Context, input model.UpdateCategoryGroupInput) (*model.CategoryGroup, error) {
	groupID := input.ID.Int64()
	rows, err := s.q.UpdateCategoryGroup(ctx, dbgen.UpdateCategoryGroupParams{Name: input.Name, Emoji: input.Emoji, ID: groupID})
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		return nil, apierror.Publicf("category group %d not found", groupID)
	}
	return s.CategoryGroupByID(ctx, groupID)
}

func (s *Store) DeleteCategoryGroup(ctx context.Context, id int64) (bool, error) {
	if id == UncategorizedCategoryID {
		return false, apierror.Publicf("cannot delete the uncategorized category group")
	}
	var deleted bool
	err := s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		count, err := q.CountCategoriesByGroup(ctx, dbgen.CountCategoriesByGroupParams{GroupID: id})
		if err != nil {
			return err
		}
		if count > 0 {
			return apierror.Publicf(
				"cannot delete group with %d categor%s; delete all categories first",
				count,
				lo.Ternary(count == 1, "y", "ies"),
			)
		}
		rows, err := q.DeleteCategoryGroup(ctx, dbgen.DeleteCategoryGroupParams{ID: id})
		if err != nil {
			return err
		}
		deleted = rows > 0
		return nil
	})
	if err != nil {
		return false, err
	}
	return deleted, nil
}

func (s *Store) DeleteCategory(ctx context.Context, id int64) (bool, error) {
	if id == UncategorizedCategoryID {
		return false, apierror.Publicf("cannot delete the uncategorized category")
	}
	err := s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		category, err := q.CategoryInfo(ctx, dbgen.CategoryInfoParams{ID: id})
		if errors.Is(err, sql.ErrNoRows) {
			return apierror.Publicf("category %d not found", id)
		}
		if err != nil {
			return err
		}

		if category.TransactionCount > 0 {
			return apierror.Publicf(
				"cannot delete category with %d transaction%s; reassign them first",
				category.TransactionCount,
				lo.Ternary(category.TransactionCount == 1, "", "s"),
			)
		}
		return q.DeleteCategory(ctx, dbgen.DeleteCategoryParams{ID: id})
	})
	if err != nil {
		return false, err
	}
	return true, nil
}

func (s *Store) ReorderCategories(ctx context.Context, input model.ReorderCategoriesInput) (*model.CategoryGroup, error) {
	groupID := input.GroupID.Int64()
	categoryIDs := model.LocalInt64IDsPtr(input.CategoryIds)
	err := s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		if err := ensureCategoryGroupExists(ctx, q, groupID); err != nil {
			return err
		}
		for i, catID := range categoryIDs {
			if err := q.UpdateCategorySortOrder(ctx, dbgen.UpdateCategorySortOrderParams{SortOrder: int64(i + 1), ID: catID, GroupID: groupID}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.CategoryGroupByID(ctx, groupID)
}
