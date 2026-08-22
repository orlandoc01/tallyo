package database

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	"tallyo/internal/utils/must"
	"tallyo/internal/utils/nooplog"
)

const (
	queryDiagnosticsLookup        = "SELECT id FROM query_diagnostics_test WHERE value = ?"
	queryDiagnosticsZeroArgUpdate = "UPDATE query_diagnostics_test SET value = value WHERE value = 'missing'"
)

func TestQueryDiagnostics(t *testing.T) {
	ctx := context.Background()
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))

	db := mustOpenQueryDiagnosticsDB(t, ctx, logger, true)
	defer func() { must.NoErr(t, db.Close()) }()
	logs.Reset()
	createQueryDiagnosticsFixture(t, ctx, db)
	logs.Reset()

	const marker = "query-diagnostics-secret-marker"
	consumeQueryRows(t, ctx, db, queryDiagnosticsLookup, marker)
	event := queryDiagnosticsLogEvent(t, logs.String())
	if event["msg"] != "sqlite query used non-indexed work" {
		t.Fatalf("message = %q", event["msg"])
	}
	if event["query"] != queryDiagnosticsLookup {
		t.Fatalf("query = %q", event["query"])
	}
	if fullScanSteps, ok := event["full_scan_steps"].(float64); !ok || fullScanSteps <= 0 {
		t.Fatalf("full_scan_steps = %#v", event["full_scan_steps"])
	}
	if strings.Contains(logs.String(), marker) {
		t.Fatalf("log contains bound value: %s", logs.String())
	}

	logs.Reset()
	_, err := db.SQL().ExecContext(ctx, queryDiagnosticsZeroArgUpdate)
	must.NoErr(t, err)
	event = queryDiagnosticsLogEvent(t, logs.String())
	if event["query"] != queryDiagnosticsZeroArgUpdate {
		t.Fatalf("zero-argument query = %q", event["query"])
	}
	if fullScanSteps, ok := event["full_scan_steps"].(float64); !ok || fullScanSteps <= 0 {
		t.Fatalf("zero-argument full_scan_steps = %#v", event["full_scan_steps"])
	}

	logs.Reset()
	consumeQueryRows(t, ctx, db, "SELECT id FROM query_diagnostics_test WHERE id = ?", 1)
	if logs.Len() != 0 {
		t.Fatalf("indexed lookup logged diagnostics: %s", logs.String())
	}

	disabled := mustOpenQueryDiagnosticsDB(t, ctx, logger, false)
	defer func() { must.NoErr(t, disabled.Close()) }()
	createQueryDiagnosticsFixture(t, ctx, disabled)
	logs.Reset()
	consumeQueryRows(t, ctx, disabled, queryDiagnosticsLookup, marker)
	if logs.Len() != 0 {
		t.Fatalf("disabled diagnostics logged: %s", logs.String())
	}
}

func TestQueryDiagnosticsPreservesMultiStatementExec(t *testing.T) {
	ctx := context.Background()
	db := mustOpenQueryDiagnosticsDB(t, ctx, nooplog.Logger, true)
	defer func() { must.NoErr(t, db.Close()) }()

	result, err := db.SQL().ExecContext(ctx, `
		CREATE TABLE query_diagnostics_multi (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
		INSERT INTO query_diagnostics_multi (value) VALUES ('before');
		UPDATE query_diagnostics_multi SET value = 'after' WHERE id = 1;
	`)
	must.NoErr(t, err)
	rowsAffected, err := result.RowsAffected()
	must.NoErr(t, err)
	if rowsAffected != 1 {
		t.Fatalf("rows affected = %d, want 1", rowsAffected)
	}
	lastInsertID, err := result.LastInsertId()
	must.NoErr(t, err)
	if lastInsertID != 1 {
		t.Fatalf("last insert ID = %d, want 1", lastInsertID)
	}

	var value string
	must.NoErr(t, db.SQL().QueryRowContext(ctx, "SELECT value FROM query_diagnostics_multi WHERE id = 1").Scan(&value))
	if value != "after" {
		t.Fatalf("value = %q, want after", value)
	}
}

func TestQueryDiagnosticsPreservesExecErrors(t *testing.T) {
	execError := func(warnFullScans bool) string {
		ctx := context.Background()
		db := mustOpenQueryDiagnosticsDB(t, ctx, nooplog.Logger, warnFullScans)
		defer func() { must.NoErr(t, db.Close()) }()

		_, err := db.SQL().ExecContext(ctx, `
			CREATE TABLE query_diagnostics_error (value TEXT UNIQUE);
			INSERT INTO query_diagnostics_error VALUES ('duplicate');
			INSERT INTO query_diagnostics_error VALUES ('duplicate');
		`)
		if err == nil {
			t.Fatal("expected unique constraint error")
		}
		return err.Error()
	}

	disabledError := execError(false)
	if enabledError := execError(true); enabledError != disabledError {
		t.Fatalf("enabled error = %q, disabled error = %q", enabledError, disabledError)
	}
}

func mustOpenQueryDiagnosticsDB(t *testing.T, ctx context.Context, logger *slog.Logger, warnFullScans bool) *DB {
	t.Helper()
	db, err := OpenDB(ctx, OpenOptions{Path: ":memory:", WarnFullScans: warnFullScans, Logger: logger})
	must.NoErr(t, err)
	return db
}

func createQueryDiagnosticsFixture(t *testing.T, ctx context.Context, db *DB) {
	t.Helper()
	_, err := db.SQL().ExecContext(ctx, `CREATE TABLE query_diagnostics_test (id INTEGER PRIMARY KEY, value TEXT NOT NULL)`)
	must.NoErr(t, err)
	_, err = db.SQL().ExecContext(ctx, `INSERT INTO query_diagnostics_test (value) VALUES (?), (?), (?)`, "one", "two", "three")
	must.NoErr(t, err)
}

func consumeQueryRows(t *testing.T, ctx context.Context, db *DB, query string, args ...any) {
	t.Helper()
	rows, err := db.SQL().QueryContext(ctx, query, args...)
	must.NoErr(t, err)
	defer func() { must.NoErr(t, rows.Close()) }()
	for rows.Next() {
		var id int
		must.NoErr(t, rows.Scan(&id))
	}
	must.NoErr(t, rows.Err())
}

func queryDiagnosticsLogEvent(t *testing.T, logs string) map[string]any {
	t.Helper()
	var event map[string]any
	if err := json.Unmarshal([]byte(logs), &event); err != nil {
		t.Fatalf("unmarshal diagnostic log: %v\n%s", err, logs)
	}
	return event
}
