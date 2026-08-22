package wealthdb

import (
	"context"
	"database/sql"
	"fmt"

	"tallyo/internal/apierror"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
	"tallyo/internal/wealth"
)

func (s *Store) GetAccountBalanceSnapshotByID(ctx context.Context, id int64) (*wealth.SnapshotRow, error) {
	row, err := s.q.GetAccountBalanceSnapshotByID(ctx, dbgen.GetAccountBalanceSnapshotByIDParams{ID: id})
	return dbutil.MapRow(row, err, snapshotRowFromSQLRow[dbgen.GetAccountBalanceSnapshotByIDRow])
}

func (s *Store) LatestAccountBalanceSnapshotInWindow(
	ctx context.Context,
	accountID int64,
	startTime string,
	endTime string,
) (*wealth.SnapshotRow, error) {
	start, err := parseSnapshotTimestamp("snapshot window start", startTime)
	if err != nil {
		return nil, err
	}
	end, err := parseSnapshotTimestamp("snapshot window end", endTime)
	if err != nil {
		return nil, err
	}
	row, err := s.q.LatestAccountBalanceSnapshotInWindow(ctx, dbgen.LatestAccountBalanceSnapshotInWindowParams{
		AccountID: accountID,
		StartTime: &start,
		EndTime:   &end,
	})
	return dbutil.MapRow(row, err, snapshotRowFromSQLRow[dbgen.LatestAccountBalanceSnapshotInWindowRow])
}

func (s *Store) LatestAccountBalanceSnapshotForAccount(ctx context.Context, accountID int64) (*wealth.SnapshotRow, error) {
	row, err := s.q.LatestAccountBalanceSnapshotInWindow(
		ctx,
		dbgen.LatestAccountBalanceSnapshotInWindowParams{
			AccountID: accountID,
		},
	)
	return dbutil.MapRow(row, err, snapshotRowFromSQLRow[dbgen.LatestAccountBalanceSnapshotInWindowRow])
}

func (s *Store) NewerAccountBalanceSnapshotsForAccount(ctx context.Context, accountID int64, date string) ([]*wealth.SnapshotRow, error) {
	rows, err := s.q.NewerAccountBalanceSnapshotsForAccount(
		ctx,
		dbgen.NewerAccountBalanceSnapshotsForAccountParams{AccountID: accountID, Date: date},
	)
	return dbutil.MapRows(rows, err, snapshotRowFromSQLRow[dbgen.NewerAccountBalanceSnapshotsForAccountRow])
}

func (s *Store) LatestAccountBalanceSnapshotsForAccounts(ctx context.Context, accountIDs []int64) (map[int64]*wealth.SnapshotRow, error) {
	rows, err := s.q.LatestAccountBalanceSnapshotsForAccounts(
		ctx,
		dbgen.LatestAccountBalanceSnapshotsForAccountsParams{AccountIds: accountIDs},
	)
	toSnapshotByAccountID := func(row dbgen.LatestAccountBalanceSnapshotsForAccountsRow) (int64, *wealth.SnapshotRow) {
		return row.AccountID, snapshotRowFromSQLRow(row)
	}
	return dbutil.AssociateRows(rows, err, toSnapshotByAccountID)
}

func (s *Store) SnapshotHoldingsBySnapshotID(ctx context.Context, snapshotID int64) ([]wealth.SnapshotHolding, error) {
	holdingsBySnapshotID, err := s.SnapshotHoldingsBySnapshotIDs(ctx, []int64{snapshotID})
	if err != nil {
		return nil, err
	}
	holdings := holdingsBySnapshotID[snapshotID]
	if holdings == nil {
		return []wealth.SnapshotHolding{}, nil
	}
	return holdings, nil
}

func (s *Store) SnapshotHoldingsBySnapshotIDs(ctx context.Context, snapshotIDs []int64) (map[int64][]wealth.SnapshotHolding, error) {
	rows, err := s.q.SnapshotHoldingsBySnapshotIDs(
		ctx,
		dbgen.SnapshotHoldingsBySnapshotIDsParams{SnapshotIds: snapshotIDs},
	)
	toSnapshotHolding := func(row dbgen.SnapshotHoldingsBySnapshotIDsRow) (int64, wealth.SnapshotHolding) {
		return row.SnapshotID, snapshotHoldingFromSQLRow(row)
	}
	return dbutil.GroupRows(rows, err, toSnapshotHolding)
}

func (s *Store) UpdateAccountSnapshots(ctx context.Context, edits []wealth.SnapshotEdit) error {
	return s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		for _, edit := range edits {
			pending, err := q.InReviewBalanceReviewExists(ctx, dbgen.InReviewBalanceReviewExistsParams{AccountID: edit.AccountID})
			if err != nil {
				return fmt.Errorf("check pending balance review: %w", err)
			}
			if pending {
				return apierror.Publicf("resolve the pending balance review before editing snapshots")
			}
			if err := updateAccountSnapshot(ctx, q, edit); err != nil {
				return err
			}
			decision := "APPROVED_CHANGES"
			if err := q.DeleteBalanceReviewsByAccountID(ctx, dbgen.DeleteBalanceReviewsByAccountIDParams{AccountID: edit.AccountID, Decision: &decision}); err != nil {
				return fmt.Errorf("delete approved balance review: %w", err)
			}
			if err := q.DeleteSnapshotProviderStatesBetweenDates(ctx, dbgen.DeleteSnapshotProviderStatesBetweenDatesParams{AccountID: edit.AccountID}); err != nil {
				return fmt.Errorf("delete stale provider states: %w", err)
			}
		}
		return nil
	})
}

func updateAccountSnapshot(ctx context.Context, q *dbgen.Queries, edit wealth.SnapshotEdit) error {
	if err := q.UpdateSnapshotBalanceAndUnflag(ctx, dbgen.UpdateSnapshotBalanceAndUnflagParams{
		ID:              edit.ID,
		BalanceUsdCents: edit.BalanceUSD,
	}); err != nil {
		return fmt.Errorf("update snapshot balance: %w", err)
	}
	if err := q.DeleteAssetDailyHoldingsBySnapshotID(
		ctx,
		dbgen.DeleteAssetDailyHoldingsBySnapshotIDParams{SnapshotID: edit.ID},
	); err != nil {
		return fmt.Errorf("delete snapshot holdings: %w", err)
	}
	for _, holding := range edit.Holdings {
		if err := q.InsertAssetDailyHolding(ctx, dbgen.InsertAssetDailyHoldingParams{
			SnapshotID:        edit.ID,
			AccountID:         edit.AccountID,
			Date:              edit.Date,
			AssetID:           holding.AssetID,
			Quantity:          holding.Quantity,
			Price:             holding.Price,
			ValueUsdCents:     holding.ValueUSD,
			CountsTowardValue: holding.CountsTowardValue,
			Manual:            holding.Manual,
		}); err != nil {
			return fmt.Errorf("insert snapshot holding %d: %w", holding.AssetID, err)
		}
	}
	return nil
}

type snapshotSQLRow interface {
	dbgen.GetAccountBalanceSnapshotByIDRow |
		dbgen.LatestAccountBalanceSnapshotInWindowRow |
		dbgen.LatestAccountBalanceSnapshotsForAccountsRow |
		dbgen.NewerAccountBalanceSnapshotsForAccountRow |
		dbgen.AccountBalanceSnapshotsPageRow
}

func snapshotRowFromSQLRow[Row snapshotSQLRow](sqlRow Row) *wealth.SnapshotRow {
	row := dbgen.GetAccountBalanceSnapshotByIDRow(sqlRow)
	return &wealth.SnapshotRow{
		ID:          row.ID,
		AccountID:   row.AccountID,
		Source:      row.Source,
		Date:        row.Date,
		SyncedAt:    formatSnapshotTimestamp(row.SyncedAt),
		BalanceUSD:  row.BalanceUsdCents,
		Flagged:     row.Flagged,
		AccountType: model.AccountType(row.AccountType),
	}
}

func snapshotHoldingFromSQLRow(row dbgen.SnapshotHoldingsBySnapshotIDsRow) wealth.SnapshotHolding {
	asset := assetFromModel(row.Asset)
	return wealth.SnapshotHolding{
		Asset:             &asset,
		Quantity:          row.Quantity,
		Price:             row.Price,
		ValueUSD:          row.ValueUsdCents,
		CountsTowardValue: row.CountsTowardValue,
		Manual:            row.Manual,
	}
}
