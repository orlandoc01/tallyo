package txnsimplefin

import (
	"testing"
	"time"
)

func TestSimpleFinStartDate(t *testing.T) {
	now := time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)

	t.Run("initial sync looks back 89 days from now", func(t *testing.T) {
		start := simpleFinStartDate(nil, now)
		want := now.AddDate(0, 0, -89)
		if start == nil || !start.Equal(want) {
			t.Fatalf("simpleFinStartDate(nil, now) = %v, want %v", start, want)
		}
	})

	t.Run("subsequent sync looks back 14 days from last sync", func(t *testing.T) {
		last := now.Add(-24 * time.Hour)
		start := simpleFinStartDate(&last, now)
		want := last.AddDate(0, 0, -14)
		if start == nil || !start.Equal(want) {
			t.Fatalf("simpleFinStartDate(&last, now) = %v, want %v", start, want)
		}
	})
}
