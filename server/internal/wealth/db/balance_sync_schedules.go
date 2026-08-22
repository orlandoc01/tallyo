package wealthdb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/wealth/syncerids"
)

func (s *Store) BalanceSyncScheduleDue(ctx context.Context, id syncerids.ID, now time.Time) (string, bool, error) {
	nowUTC := now.UTC()
	cron, err := s.q.BalanceSyncScheduleDue(ctx, dbgen.BalanceSyncScheduleDueParams{
		ID:      id.Str(),
		DueOnly: true,
		Now:     &nowUTC,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("read balance sync schedule due %q: %w", id, err)
	}
	return cron, true, nil
}

func (s *Store) BalanceSyncScheduleCron(ctx context.Context, id syncerids.ID) (string, error) {
	cron, err := s.q.BalanceSyncScheduleDue(ctx, dbgen.BalanceSyncScheduleDueParams{ID: id.Str(), DueOnly: false})
	if err != nil {
		return "", fmt.Errorf("read balance sync schedule cron %q: %w", id, err)
	}
	return cron, nil
}

func (s *Store) SetBalanceSyncScheduleSynced(ctx context.Context, id syncerids.ID, nextBalanceSyncAt time.Time) error {
	nextBalanceSyncAtUTC := nextBalanceSyncAt.UTC()
	if err := s.q.SetBalanceSyncScheduleSynced(ctx, dbgen.SetBalanceSyncScheduleSyncedParams{
		ID:                id.Str(),
		NextBalanceSyncAt: &nextBalanceSyncAtUTC,
	}); err != nil {
		return fmt.Errorf("set balance sync schedule synced %q: %w", id, err)
	}
	return nil
}
