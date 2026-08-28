package accountsdb

import (
	"context"
	"fmt"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
)

func (s *Store) Owners(ctx context.Context) ([]*model.Owner, error) {
	rows, err := s.q.Owners(ctx, dbgen.OwnersParams{})
	return dbutil.MapRows(rows, err, OwnerFromRow)
}

func (s *Store) OwnerByID(ctx context.Context, id int64) (*model.Owner, error) {
	rows, err := s.q.Owners(ctx, dbgen.OwnersParams{ID: &id})
	return dbutil.MapFirstRow(rows, err, OwnerFromRow)
}

func (s *Store) CreateOwner(ctx context.Context, input model.CreateOwnerInput) (*model.Owner, error) {
	row, err := s.q.CreateOwner(ctx, dbgen.CreateOwnerParams{Name: input.Name})
	if err != nil {
		return nil, fmt.Errorf("insert owner: %w", err)
	}
	return OwnerFromRow(row), nil
}

func (s *Store) DeleteOwner(ctx context.Context, id int64) (bool, error) {
	n, err := s.q.DeleteOwner(ctx, dbgen.DeleteOwnerParams{ID: id})
	if err != nil {
		return false, fmt.Errorf("delete owner: %w", err)
	}
	return n > 0, nil
}

func OwnerFromRow(row dbgen.Owner) *model.Owner {
	return &model.Owner{ID: model.New(model.GlobalIDOwner, row.ID), Name: row.Name}
}
