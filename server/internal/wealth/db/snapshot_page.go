package wealthdb

import (
	"context"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/wealth"
)

func (s *Store) AccountBalanceSnapshotsPage(
	ctx context.Context,
	accountID int64,
	afterDate *string,
	limit int64,
) ([]*wealth.SnapshotRow, error) {
	rows, err := s.q.AccountBalanceSnapshotsPage(ctx, dbgen.AccountBalanceSnapshotsPageParams{
		AccountID: accountID,
		AfterDate: afterDate,
		RowLimit:  limit,
	})
	return dbutil.MapRows(rows, err, snapshotRowFromSQLRow[dbgen.AccountBalanceSnapshotsPageRow])
}

func (s *Store) AccountBalanceSnapshotDayCount(ctx context.Context, accountID int64) (int, error) {
	count, err := s.q.AccountBalanceSnapshotDayCount(
		ctx,
		dbgen.AccountBalanceSnapshotDayCountParams{AccountID: accountID},
	)
	return int(count), err
}
