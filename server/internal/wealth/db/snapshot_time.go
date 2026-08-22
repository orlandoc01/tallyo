package wealthdb

import (
	"fmt"
	"time"
)

// SQLite's date('garbage', '+1 day') is NULL, silently turning a bounded
// UPDATE/DELETE into a no-op — reject bad bounds before they reach it.
func validateSnapshotDate(fieldName, value string) error {
	if _, err := time.Parse(time.DateOnly, value); err != nil {
		return fmt.Errorf("parse %s %q: %w", fieldName, value, err)
	}
	return nil
}

func parseSnapshotTimestamp(fieldName, value string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse %s %q: %w", fieldName, value, err)
	}
	return parsed.UTC(), nil
}

func parseOptionalSnapshotTimestamp(fieldName, value string) (*time.Time, error) {
	if value == "" {
		return nil, nil
	}
	parsed, err := parseSnapshotTimestamp(fieldName, value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func formatSnapshotTimestamp(value time.Time) string {
	return value.UTC().Format(time.RFC3339)
}
