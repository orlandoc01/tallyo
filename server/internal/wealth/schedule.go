package wealth

import (
	"context"
	"fmt"
	"time"

	u "tallyo/internal/utils"
	"tallyo/internal/wealth/syncerids"
)

const balanceSyncTimezone = "America/New_York"

type BalanceSyncScheduler interface {
	BalanceSyncScheduleDue(ctx context.Context, id syncerids.ID, now time.Time) (string, bool, error)
	SetBalanceSyncScheduleSynced(ctx context.Context, id syncerids.ID, nextBalanceSyncAt time.Time) error
}

func RunScheduledBalanceSync(
	ctx context.Context,
	store BalanceSyncScheduler,
	id syncerids.ID,
	now time.Time,
	sync func() error,
) error {
	cron, due, err := store.BalanceSyncScheduleDue(ctx, id, now)
	if err != nil {
		return err
	}
	if !due {
		return nil
	}
	if err := sync(); err != nil {
		return err
	}
	next, err := NextBalanceSyncAfter(cron, now)
	if err != nil {
		return fmt.Errorf("compute next balance sync: %w", err)
	}
	return store.SetBalanceSyncScheduleSynced(ctx, id, next)
}

func NextBalanceSyncAfter(cron string, now time.Time) (time.Time, error) {
	return u.NextAfterInZone(cron, balanceSyncTimezone, now)
}
