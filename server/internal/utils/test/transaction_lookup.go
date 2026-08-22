package test

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/graph/model"
)

type SQLStore interface {
	SQL() *sql.DB
}

type TransactionLookupStore interface {
	SQLStore
	Transaction(ctx context.Context, id int64) (*model.Transaction, error)
}

func TransactionBySourceExternalID(
	ctx context.Context,
	store TransactionLookupStore,
	source string,
	externalID string,
) (*model.Transaction, error) {
	id, err := TransactionIDBySourceExternalID(ctx, store, source, externalID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return store.Transaction(ctx, id)
}

func MustTransactionBySourceExternalID(
	tb testing.TB,
	store TransactionLookupStore,
	source, externalID, failureFormat string,
) *model.Transaction {
	tb.Helper()
	transaction, err := TransactionBySourceExternalID(context.Background(), store, source, externalID)
	if err != nil {
		tb.Fatalf(failureFormat, err)
	}
	return transaction
}

func TransactionIDBySourceExternalID(ctx context.Context, store SQLStore, source, externalID string) (int64, error) {
	var id int64
	err := store.SQL().QueryRowContext(ctx, `
SELECT id
FROM transactions
WHERE source = ?
  AND external_id = ?`, source, externalID).Scan(&id)
	return id, err
}

func AccountIDByExternalID(ctx context.Context, db *sql.DB, externalID string) (int64, error) {
	rows, err := dbgen.New(db).AccountRecords(ctx, dbgen.AccountRecordsParams{ExternalIds: []string{externalID}})
	if err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, sql.ErrNoRows
	}
	return rows[0].Account.ID, nil
}
