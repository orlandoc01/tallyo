package database

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

func TestWarnQueryDiagnosticsLogsAutomaticIndex(t *testing.T) {
	var logs bytes.Buffer
	warnQueryDiagnostics(slog.New(slog.NewJSONHandler(&logs, nil)), "SELECT * FROM left_table JOIN right_table", queryDiagnostics{
		AutomaticIndexRows: 7,
	})

	if !strings.Contains(logs.String(), `"automatic_index_rows":7`) {
		t.Fatalf("automatic index warning missing: %s", logs.String())
	}
}

func TestWarnQueryDiagnosticsLogsOnceWhenBothCountersArePositive(t *testing.T) {
	var logs bytes.Buffer
	warnQueryDiagnostics(slog.New(slog.NewJSONHandler(&logs, nil)), "SELECT * FROM test", queryDiagnostics{
		FullScanSteps:      3,
		AutomaticIndexRows: 7,
	})

	if strings.Count(logs.String(), "sqlite query used non-indexed work") != 1 {
		t.Fatalf("want one warning, got: %s", logs.String())
	}
}
