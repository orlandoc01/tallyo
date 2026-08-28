package test

import (
	"context"
	"time"
)

type PlaidSyncLogEntry struct {
	Added    string
	Modified string
	Removed  string
}

func (s *Store) PlaidSyncLogEntry(ctx context.Context, itemID int64) (PlaidSyncLogEntry, error) {
	entry := PlaidSyncLogEntry{}
	err := s.SQL().QueryRowContext(ctx, `SELECT added, modified, removed FROM plaid_sync_log WHERE item_id = ?`, itemID).
		Scan(&entry.Added, &entry.Modified, &entry.Removed)
	return entry, err
}

func (s *Store) TransactionRawProviderJSON(ctx context.Context, id string) (string, error) {
	return queryOne[string](ctx, s, `SELECT raw_provider_json FROM transactions WHERE external_id = ?`, id)
}

func (s *Store) PlaidItemNextSyncAtStr(ctx context.Context, itemID int64) (string, error) {
	return queryOne[string](ctx, s, `SELECT next_sync_at FROM plaid_items WHERE id = ?`, itemID)
}

func (s *Store) PlaidItemLastRecurringSyncedAt(ctx context.Context, itemID int64) (*time.Time, error) {
	return queryOne[*time.Time](ctx, s, `SELECT last_recurring_synced_at FROM plaid_items WHERE id = ?`, itemID)
}

func (s *Store) SetPlaidItemLastRecurringSyncedAt(ctx context.Context, itemID int64, t time.Time) error {
	_, err := s.SQL().ExecContext(ctx, `UPDATE plaid_items SET last_recurring_synced_at = ? WHERE id = ?`, t.Format(time.RFC3339), itemID)
	return err
}

func (s *Store) SetPlaidItemScheduleColumn(ctx context.Context, itemID int64, column string, value time.Time) error {
	query := "UPDATE plaid_items SET " + column + " = ? WHERE id = ?"
	_, err := s.SQL().ExecContext(ctx, query, value.Format(time.RFC3339), itemID)
	return err
}

func queryOne[T any](ctx context.Context, s *Store, query string, args ...any) (T, error) {
	var value T
	err := s.SQL().QueryRowContext(ctx, query, args...).Scan(&value)
	return value, err
}
