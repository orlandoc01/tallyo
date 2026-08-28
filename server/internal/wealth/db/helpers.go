package wealthdb

import (
	"context"

	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
)

func (s *Store) OwnerByID(ctx context.Context, id int64) (*model.Owner, error) {
	rows, err := s.q.Owners(ctx, dbgen.OwnersParams{ID: &id})
	return dbutil.MapFirstRow(rows, err, accountsdb.OwnerFromRow)
}

func (s *Store) AccountByID(ctx context.Context, id int64) (*model.Account, error) {
	rows, err := s.q.AccountRecords(ctx, dbgen.AccountRecordsParams{ID: &id})
	toAccount := func(row dbgen.AccountRecordsRow) *model.Account {
		return accountsdb.AccountFromRow(row.Account, row.OwnerName)
	}
	return dbutil.MapFirstRow(rows, err, toAccount)
}

func (s *Store) AccountByExternalID(ctx context.Context, externalID string) (int64, model.AccountType, error) {
	row, err := accountsdb.AccountByExternalID(ctx, s.q, externalID)
	if err != nil {
		return 0, "", err
	}
	return row.Account.ID, model.AccountType(row.Account.Type), nil
}
