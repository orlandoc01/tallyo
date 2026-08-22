package database

import (
	"context"
	"log/slog"
	"time"

	"tallyo/internal/database/dbgen"
)

const retentionSweepInterval = time.Hour

func RunRetentionSweep(ctx context.Context, db *DB, log *slog.Logger) {
	runPeriodic(ctx, retentionSweepInterval, func(ctx context.Context) {
		if err := TriggerRetentionSweep(ctx, db); err != nil {
			log.Error("retention sweep failed", "error", err)
		}
	})
}

func runPeriodic(ctx context.Context, interval time.Duration, fn func(context.Context)) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	fn(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			fn(ctx)
		}
	}
}

func TriggerRetentionSweep(ctx context.Context, db *DB) error {
	return dbgen.New(db.SQL()).TriggerRetentionSweep(ctx)
}
