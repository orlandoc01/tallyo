package transactionsdb

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
	"tallyo/internal/transactions"
)

func (s *Store) PlaidItemSecret(ctx context.Context, id int64) (*accounts.PlaidItemSecret, error) {
	return accountsdb.PlaidItemSecretByID(ctx, s.q, id, accounts.PlaidSyncKindTransactions)
}

func (s *Store) PlaidItemsDueForSync(ctx context.Context, now time.Time) ([]accounts.PlaidItemSecret, error) {
	nowUTC := now.UTC()
	rows, err := s.q.PlaidItemsDue(ctx, dbgen.PlaidItemsDueParams{Kind: string(accounts.PlaidSyncKindTransactions), Now: &nowUTC, DueOnly: true})
	return dbutil.MapRows(rows, err, accountsdb.PlaidItemSecretFromSQLRow)
}

func (s *Store) PlaidItemsDueForRecurringSync(ctx context.Context, now time.Time) ([]accounts.PlaidItemSecret, error) {
	nowUTC := now.UTC()
	rows, err := s.q.PlaidItemsDue(ctx, dbgen.PlaidItemsDueParams{Kind: string(accounts.PlaidSyncKindRecurring), Now: &nowUTC, DueOnly: true})
	return dbutil.MapRows(rows, err, accountsdb.PlaidItemSecretFromSQLRow)
}

func (s *Store) SyncCursor(ctx context.Context, plaidItemID int64) (string, error) {
	cursor, err := s.q.SyncCursor(ctx, dbgen.SyncCursorParams{ID: plaidItemID})
	if errors.Is(err, sql.ErrNoRows) || cursor == nil {
		return "", nil
	}
	return *cursor, err
}

func (s *Store) SetSyncCursor(ctx context.Context, plaidItemID int64, cursor string, nextSyncAt time.Time) error {
	nextSyncAtUTC := nextSyncAt.UTC()
	return s.q.SetSyncCursor(ctx, dbgen.SetSyncCursorParams{SetCursor: true, Cursor: &cursor, NextSyncAt: &nextSyncAtUTC, ID: plaidItemID})
}

func (s *Store) LogSyncBatch(ctx context.Context, log transactions.SyncBatchLog) error {
	api := log.API
	if api == "" {
		api = transactions.SyncBatchAPITransactions
	}
	return s.q.LogSyncBatch(ctx, dbgen.LogSyncBatchParams{
		ItemID:   log.ItemID,
		Api:      api,
		Added:    log.Added,
		Modified: log.Modified,
		Removed:  log.Removed,
	})
}

func (s *Store) SetPlaidItemHealth(ctx context.Context, itemID int64, state model.PlaidItemHealthState, code, message *string) error {
	return s.q.SetPlaidItemHealth(ctx, dbgen.SetPlaidItemHealthParams{HealthState: string(state), HealthErrorCode: code, HealthErrorMessage: message, ID: itemID})
}

func (s *Store) SetPlaidItemHealthy(ctx context.Context, itemID int64) error {
	return s.SetPlaidItemHealth(ctx, itemID, model.PlaidItemHealthStateHealthy, nil, nil)
}

func (s *Store) SetItemRecurringSynced(ctx context.Context, itemID int64, nextRecurringSyncAt time.Time) error {
	nextRecurringSyncAtUTC := nextRecurringSyncAt.UTC()
	return s.q.SetItemRecurringSynced(ctx, dbgen.SetItemRecurringSyncedParams{NextRecurringSyncAt: &nextRecurringSyncAtUTC, ID: itemID})
}

func (s *Store) SetItemTransactionsSynced(ctx context.Context, itemID int64, nextSyncAt time.Time) error {
	nextSyncAtUTC := nextSyncAt.UTC()
	return s.q.SetSyncCursor(ctx, dbgen.SetSyncCursorParams{SetCursor: false, NextSyncAt: &nextSyncAtUTC, ID: itemID})
}
