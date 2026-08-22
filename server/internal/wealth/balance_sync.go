package wealth

import (
	"context"
	"fmt"
)

type PortfolioSyncer interface {
	SyncAll(ctx context.Context) error
}

type BalanceWealthStore interface {
	PersistSnapshot(ctx context.Context, snapshot SnapshotPersist) error
	PersistAssetUpdate(ctx context.Context, update AssetUpdate) error
}

func SyncConnectionVia[T any](
	ctx context.Context,
	sink PersistSink,
	what string,
	sourceID int64,
	lookup func(context.Context, int64) (*T, error),
	cron func(context.Context) (string, error),
	run func(context.Context, T, string, PersistSink) error,
) error {
	source, err := lookup(ctx, sourceID)
	if err != nil {
		return fmt.Errorf("lookup %s %d: %w", what, sourceID, err)
	}
	if source == nil {
		return fmt.Errorf("%s %d not found", what, sourceID)
	}
	cronValue, err := cron(ctx)
	if err != nil {
		return err
	}
	return run(ctx, *source, cronValue, sink)
}
