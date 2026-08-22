package utils

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"tallyo/internal/utils/must"
)

func TestNextAfterUsesCronExpression(t *testing.T) {
	after := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	next, err := NextAfter("0 */2 * * *", after)
	must.NoErr(t, err)
	want := time.Date(2026, 5, 26, 14, 0, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("NextAfter() = %v, want %v", next, want)
	}
}

func TestNextAfterDoesNotSkipTheFollowingSecond(t *testing.T) {
	after := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	next, err := NextAfter("* * * * * * *", after)
	must.NoErr(t, err)
	want := after.Add(time.Second)
	if !next.Equal(want) {
		t.Fatalf("NextAfter() = %v, want %v (cronexpr.Next is already strictly later)", next, want)
	}
}

func TestNextHourlyRun(t *testing.T) {
	loc := time.FixedZone("test", -5*60*60)
	after := time.Date(2026, 5, 26, 12, 0, 0, 0, loc)
	want := time.Date(2026, 5, 26, 12, 1, 0, 0, loc)
	if got := nextHourlyRun(after); !got.Equal(want) {
		t.Fatalf("nextHourlyRun() = %v, want %v", got, want)
	}
}

func TestNextHourlyRunConcurrent(t *testing.T) {
	after := time.Date(2026, 12, 31, 23, 59, 0, 0, time.UTC)
	want := time.Date(2027, 1, 1, 0, 1, 0, 0, time.UTC)
	var wg sync.WaitGroup
	for range 100 {
		wg.Go(func() {
			if got := nextHourlyRun(after); !got.Equal(want) {
				t.Errorf("nextHourlyRun() = %v, want %v", got, want)
			}
		})
	}
	wg.Wait()
}

func TestRunHourlyCronReturnsWhenCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	runs := 0
	RunHourlyCron(ctx, func(context.Context) { runs++ })
	if runs != 1 {
		t.Fatalf("RunHourlyCron immediate runs = %d, want 1", runs)
	}
}

func TestNextAfterInZone(t *testing.T) {
	after := time.Date(2026, 5, 26, 6, 59, 0, 0, time.UTC)
	next, err := NextAfterInZone("0 0 * * *", "America/Los_Angeles", after)
	must.NoErr(t, err)
	want := time.Date(2026, 5, 26, 7, 0, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("NextAfterInZone() = %v, want %v", next, want)
	}
	if _, err := NextAfterInZone("0 0 * * *", "bad-zone", after); err == nil {
		t.Fatal("expected bad timezone error")
	}
	if _, err := NextAfterInZone("not-a-cron", "UTC", after); err == nil {
		t.Fatal("expected invalid cron error")
	}
}

func TestValidateMinInterval(t *testing.T) {
	must.NoErr(t, ValidateMinInterval("0 */2 * * *", time.Hour))
	err := ValidateMinInterval("*/30 * * * *", time.Hour)
	if err == nil || !strings.Contains(err.Error(), "1h0m0s or more apart") {
		t.Fatalf("ValidateMinInterval() error = %v", err)
	}
	err = ValidateMinInterval("* * * * * * *", time.Minute)
	if err == nil || !strings.Contains(err.Error(), "1m0s or more apart") {
		t.Fatalf("ValidateMinInterval() second-level error = %v", err)
	}
}

func TestValidateMinIntervalRejectsInvalidCron(t *testing.T) {
	if err := ValidateMinInterval("not-a-cron", time.Hour); err == nil {
		t.Fatal("expected invalid cron error")
	}
}
