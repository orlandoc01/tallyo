package wealthdb

import (
	"context"
	"time"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
)

func (s *Store) PlaidItemsDueForBalanceSync(ctx context.Context, now time.Time) ([]accounts.PlaidItemSecret, error) {
	nowUTC := now.UTC()
	rows, err := s.q.PlaidItemsDue(ctx, dbgen.PlaidItemsDueParams{Kind: string(accounts.PlaidSyncKindBalance), Now: &nowUTC, DueOnly: true})
	return dbutil.MapRows(rows, err, accountsdb.PlaidItemSecretFromSQLRow)
}

func (s *Store) PlaidItemSecretByID(ctx context.Context, itemID int64) (*accounts.PlaidItemSecret, error) {
	return accountsdb.PlaidItemSecretByID(ctx, s.q, itemID, accounts.PlaidSyncKindBalance)
}

func (s *Store) SetItemBalanceSynced(ctx context.Context, itemID int64, nextBalanceSyncAt time.Time) error {
	nextBalanceSyncAtUTC := nextBalanceSyncAt.UTC()
	return s.q.SetItemBalanceSynced(ctx, dbgen.SetItemBalanceSyncedParams{NextBalanceSyncAt: &nextBalanceSyncAtUTC, ID: itemID})
}
