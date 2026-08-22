package database

import (
	"context"
	"testing"

	"tallyo/internal/utils/must"
	"tallyo/internal/utils/nooplog"
)

func TestOptimize(t *testing.T) {
	db := testDB(t)
	must.NoErr(t, db.Optimize(context.Background()))
	triggerSQLiteOptimize(context.Background(), db, nooplog.Logger)
}

func TestTriggerSQLiteOptimizeLogsClosedDB(t *testing.T) {
	db := testDB(t)
	must.NoErr(t, db.SQL().Close())
	triggerSQLiteOptimize(context.Background(), db, nooplog.Logger)
}
