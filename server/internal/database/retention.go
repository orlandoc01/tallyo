package database

import (
	"context"
	"log/slog"
	"time"

	"tallyo/internal/database/dbgen"
	u "tallyo/internal/utils"
)

const retentionSweepInterval = time.Hour

func RunRetentionSweep(ctx context.Context, db *DB, log *slog.Logger) {
	u.RunPeriodic(ctx, retentionSweepInterval, func(ctx context.Context) {
		if err := TriggerRetentionSweep(ctx, db); err != nil {
			log.Error("retention sweep failed", "error", err)
		}
	})
}

func TriggerRetentionSweep(ctx context.Context, db *DB) error {
	return dbgen.New(db.SQL()).TriggerRetentionSweep(ctx)
}
