package transactionsdb

import (
	"testing"
	"time"

	"tallyo/internal/graph/model"
)

func TestSpendingReportPeriods(t *testing.T) {
	utc := time.UTC
	granularity := model.GranularityMonthly
	tests := map[string]struct {
		from       time.Time
		to         time.Time
		periodName string
		wantStart  string
		wantEnd    string
	}{
		// Regression: when the server timezone (e.g. UTC) differs from the client's
		// browser timezone (e.g. UTC-4), the exclusive upper bound "to" carries a
		// non-zero hour component that previously landed in the next calendar
		// month, creating a spurious extra period. US client (UTC-4) picks June:
		// the frontend sends to = midnight July 1 ET = 2026-07-01T04:00:00Z.
		"TimezoneOffset": {
			from:       time.Date(2026, 6, 1, 4, 0, 0, 0, time.UTC),
			to:         time.Date(2026, 7, 1, 4, 0, 0, 0, time.UTC),
			periodName: "June",
			wantStart:  "2026-06-01",
			wantEnd:    "2026-06-30",
		},
		// Client and server both on UTC: exact-midnight boundaries must still
		// produce exactly one period.
		"MidnightUTC": {
			from:       time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC),
			to:         time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC),
			periodName: "May",
			wantStart:  "2026-05-01",
			wantEnd:    "2026-05-31",
		},
	}

	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			fromDateTime := tc.from
			toDateTime := tc.to
			filter := model.SpendingFilter{
				Granularity: &granularity,
				DatetimeRange: &model.DateTimeRange{
					From: &fromDateTime,
					To:   &toDateTime,
				},
			}
			periods := spendingReportPeriods(filter, utc)
			if len(periods) != 1 {
				t.Fatalf("expected 1 period (%s), got %d: %v", tc.periodName, len(periods), periods)
			}
			if string(periods[0].PeriodStart) != tc.wantStart {
				t.Errorf("PeriodStart = %q, want %s", periods[0].PeriodStart, tc.wantStart)
			}
			if string(periods[0].PeriodEnd) != tc.wantEnd {
				t.Errorf("PeriodEnd = %q, want %s", periods[0].PeriodEnd, tc.wantEnd)
			}
		})
	}
}
