package database

import (
	"context"
	"fmt"
	"log/slog"
	"time"
)

const sqliteOptimizeInterval = 4 * time.Hour

func RunSQLiteOptimize(ctx context.Context, db *DB, log *slog.Logger) {
	runPeriodic(ctx, sqliteOptimizeInterval, func(ctx context.Context) {
		triggerSQLiteOptimize(ctx, db, log)
	})
}

func (s *DB) Optimize(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `PRAGMA optimize`)
	if err != nil {
		return fmt.Errorf("optimize sqlite: %w", err)
	}
	return nil
}

func triggerSQLiteOptimize(ctx context.Context, db *DB, log *slog.Logger) {
	if err := db.Optimize(ctx); err != nil {
		log.Error("sqlite optimize failed", "error", err)
	}
}
