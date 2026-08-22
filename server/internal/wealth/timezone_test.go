package wealth

import (
	"reflect"
	"testing"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
)

func TestLocalDate(t *testing.T) {
	// 05:00 UTC on the 19th is still the evening of the 18th on the US west coast.
	instant := time.Date(2026, 6, 19, 5, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		tz   string
		want string
	}{
		{name: "los angeles is still the prior day", tz: "America/Los_Angeles", want: "2026-06-18"},
		{name: "utc rolls to the next day", tz: "UTC", want: "2026-06-19"},
		{name: "empty falls back to utc", tz: "", want: "2026-06-19"},
		{name: "invalid falls back to utc", tz: "Not/AZone", want: "2026-06-19"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := LocalDate(instant, tc.tz); got != tc.want {
				t.Fatalf("LocalDate(%q) = %q, want %q", tc.tz, got, tc.want)
			}
		})
	}
}

func TestUTCDate(t *testing.T) {
	instant := time.Date(2026, 6, 1, 23, 30, 0, 0, time.UTC)
	if got := UTCDate(instant); got != "2026-06-01" {
		t.Fatalf("UTCDate() = %q, want 2026-06-01", got)
	}
}

func TestSyncedAtToLocalDate(t *testing.T) {
	cases := []struct {
		name     string
		syncedAt string
		tz       string
		want     string
	}{
		{name: "utc timestamp in LA timezone", syncedAt: "2026-06-19T05:00:00Z", tz: "America/Los_Angeles", want: "2026-06-18"},
		{name: "utc timestamp stays utc", syncedAt: "2026-06-19T05:00:00Z", tz: "", want: "2026-06-19"},
		{name: "sqlite format without +00:00", syncedAt: "2026-06-19T05:00:00Z", tz: "America/Los_Angeles", want: "2026-06-18"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := syncedAtToLocalDate(tc.syncedAt, tc.tz); got != tc.want {
				t.Fatalf("syncedAtToLocalDate(%q, %q) = %q, want %q", tc.syncedAt, tc.tz, got, tc.want)
			}
		})
	}
}

func TestSampleDatesUsesProvidedNowForLastPoint(t *testing.T) {
	la, err := time.LoadLocation("America/Los_Angeles")
	must.NoErr(t, err)
	// 05:00 UTC on the 19th -> 22:00 on the 18th in Los Angeles.
	now := time.Date(2026, 6, 19, 5, 0, 0, 0, time.UTC).In(la)
	dates := sampleDates(model.HistoricalNetWorthInput{Range: model.NetWorthRangeOneMonth}, nil, now)
	if len(dates) == 0 {
		t.Fatal("sampleDates returned no dates")
	}
	last := dates[len(dates)-1].Format("2006-01-02")
	if last != "2026-06-18" {
		t.Fatalf("last sampled date = %q, want 2026-06-18", last)
	}
}

func TestSampleDatesWithEarliestTimestamp(t *testing.T) {
	la, err := time.LoadLocation("America/Los_Angeles")
	must.NoErr(t, err)
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, la)
	earliest := time.Date(2026, 6, 10, 3, 0, 0, 0, time.UTC)
	dates := sampleDates(model.HistoricalNetWorthInput{Range: model.NetWorthRangeAll}, &earliest, now)
	if len(dates) == 0 {
		t.Fatal("sampleDates returned no dates")
	}
	first := dates[0].Format("2006-01-02")
	if first != "2026-06-09" {
		t.Fatalf("first sampled date = %q, want 2026-06-09 (earliest in LA)", first)
	}
}

func TestSampleDatesGranularitySteps(t *testing.T) {
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name        string
		granularity model.Granularity
		earliest    time.Time
		want        []string
	}{
		{name: "daily", granularity: model.GranularityDaily, earliest: time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC), want: []string{"2026-07-26", "2026-07-27", "2026-07-28"}},
		{name: "weekly", granularity: model.GranularityWeekly, earliest: time.Date(2026, 7, 14, 12, 0, 0, 0, time.UTC), want: []string{"2026-07-14", "2026-07-21", "2026-07-28"}},
		{name: "monthly", granularity: model.GranularityMonthly, earliest: time.Date(2026, 4, 28, 12, 0, 0, 0, time.UTC), want: []string{"2026-04-28", "2026-05-28", "2026-06-28", "2026-07-28"}},
		{name: "quarterly", granularity: model.GranularityQuarterly, earliest: time.Date(2026, 1, 28, 12, 0, 0, 0, time.UTC), want: []string{"2026-01-28", "2026-04-28", "2026-07-28"}},
		{name: "yearly", granularity: model.GranularityYearly, earliest: time.Date(2024, 7, 28, 12, 0, 0, 0, time.UTC), want: []string{"2024-07-28", "2025-07-28", "2026-07-28"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			granularity := tc.granularity
			dates := sampleDates(model.HistoricalNetWorthInput{Range: model.NetWorthRangeAll, Granularity: &granularity}, &tc.earliest, now)
			if got := dateStrings(dates); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("sampleDates() = %#v, want %#v", got, tc.want)
			}
		})
	}
}

func TestSampleDatesMonthEndAndDST(t *testing.T) {
	monthly := model.GranularityMonthly
	earliest := time.Date(2026, 1, 31, 12, 0, 0, 0, time.UTC)
	now := time.Date(2026, 3, 31, 12, 0, 0, 0, time.UTC)
	dates := sampleDates(model.HistoricalNetWorthInput{Range: model.NetWorthRangeAll, Granularity: &monthly}, &earliest, now)
	if got, want := dateStrings(dates), []string{"2026-01-31", "2026-02-28", "2026-03-31"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("month-end sampleDates() = %#v, want %#v", got, want)
	}

	ny, err := time.LoadLocation("America/New_York")
	must.NoErr(t, err)
	weekly := model.GranularityWeekly
	earliest = time.Date(2026, 3, 7, 12, 0, 0, 0, ny)
	now = time.Date(2026, 3, 21, 12, 0, 0, 0, ny)
	dates = sampleDates(model.HistoricalNetWorthInput{Range: model.NetWorthRangeAll, Granularity: &weekly}, &earliest, now)
	if got, want := dateStrings(dates), []string{"2026-03-07", "2026-03-14", "2026-03-21"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("dst sampleDates() = %#v, want %#v", got, want)
	}
	for _, date := range dates {
		if date.Hour() != 12 {
			t.Fatalf("dst sample hour = %d, want 12", date.Hour())
		}
	}
}

func TestSampleDatesClampsRangeStarts(t *testing.T) {
	cases := []struct {
		name       string
		rangeValue model.NetWorthRange
		now        time.Time
		want       string
	}{
		{
			name:       "one month from march 31",
			rangeValue: model.NetWorthRangeOneMonth,
			now:        time.Date(2026, 3, 31, 12, 0, 0, 0, time.UTC),
			want:       "2026-02-28",
		},
		{
			name:       "three months from march 31",
			rangeValue: model.NetWorthRangeThreeMonth,
			now:        time.Date(2026, 3, 31, 12, 0, 0, 0, time.UTC),
			want:       "2025-12-31",
		},
		{
			name:       "one year from leap day",
			rangeValue: model.NetWorthRangeOneYear,
			now:        time.Date(2024, 2, 29, 12, 0, 0, 0, time.UTC),
			want:       "2023-02-28",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dates := sampleDates(model.HistoricalNetWorthInput{Range: tc.rangeValue}, nil, tc.now)
			if len(dates) == 0 {
				t.Fatal("sampleDates returned no dates")
			}
			if got := dates[0].Format(time.DateOnly); got != tc.want {
				t.Fatalf("first sample = %q, want %q", got, tc.want)
			}
		})
	}
}

func dateStrings(dates []time.Time) []string {
	strings := make([]string, len(dates))
	for i, date := range dates {
		strings[i] = date.Format(time.DateOnly)
	}
	return strings
}
