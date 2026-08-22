package wealthdb

import (
	"context"
	"time"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/database/dbgen"
)

func (s *Store) SimpleFinTokensDueForBalanceSync(ctx context.Context, now time.Time) ([]accounts.SimpleFinAccessTokenSecret, error) {
	return accountsdb.SimpleFinTokenSecretsDue(ctx, s.q, accounts.SimpleFinTokenSecretKindBalance, now)
}

func (s *Store) SimpleFinTokenSecretByConnID(ctx context.Context, connID int64) (*accounts.SimpleFinAccessTokenSecret, error) {
	return accountsdb.SimpleFinTokenSecretByConnID(ctx, s.q, connID)
}

func (s *Store) SetSimpleFinTokenBalanceSynced(ctx context.Context, id int64, nextBalanceSyncAt time.Time) error {
	nextBalanceSyncAtUTC := nextBalanceSyncAt.UTC()
	return s.q.SetSimpleFinTokenBalanceSynced(ctx, dbgen.SetSimpleFinTokenBalanceSyncedParams{
		ID:                id,
		NextBalanceSyncAt: &nextBalanceSyncAtUTC,
	})
}
