// Package dbtest opens throwaway databases for tests. It depends only on
// internal/database so any package can use it without an import cycle.
package dbtest

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	"tallyo/internal/database"
	"tallyo/internal/utils/nooplog"
)

// Open returns a migrated in-memory database, closed at test end.
func Open(tb testing.TB) *database.DB {
	tb.Helper()
	return OpenAt(tb, ":memory:")
}

func AssertQueryPlanUses(tb testing.TB, db *sql.DB, query string, indexes ...string) {
	tb.Helper()
	plan := queryPlan(tb, db, query)
	for _, index := range indexes {
		if !strings.Contains(plan, index) {
			tb.Fatalf("query plan = %q, want it to use %s", plan, index)
		}
	}
}

func AssertQueryPlanOmits(tb testing.TB, db *sql.DB, query string, fragments ...string) {
	tb.Helper()
	plan := queryPlan(tb, db, query)
	for _, fragment := range fragments {
		if strings.Contains(plan, fragment) {
			tb.Fatalf("query plan = %q, want it to omit %s", plan, fragment)
		}
	}
}

func queryPlan(tb testing.TB, db *sql.DB, query string) string {
	tb.Helper()
	rows, err := db.QueryContext(context.Background(), query)
	if err != nil {
		tb.Fatalf("EXPLAIN QUERY PLAN: %v", err)
	}
	defer func() { _ = rows.Close() }()
	var plan strings.Builder
	for rows.Next() {
		var id, parent, notUsed int
		var detail string
		if err := rows.Scan(&id, &parent, &notUsed, &detail); err != nil {
			tb.Fatalf("scan query plan row: %v", err)
		}
		plan.WriteString(detail)
		plan.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		tb.Fatalf("query plan rows: %v", err)
	}
	return plan.String()
}

// OpenAt is Open for a file-backed path (t.TempDir callers).
func OpenAt(tb testing.TB, path string) *database.DB {
	tb.Helper()
	db, err := database.OpenDB(context.Background(), database.OpenOptions{Path: path, Logger: nooplog.Logger})
	if err != nil {
		tb.Fatalf("OpenDB: %v", err)
	}
	tb.Cleanup(func() { _ = db.Close() })
	return db
}
