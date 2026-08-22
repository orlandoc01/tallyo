package utils

import (
	"context"
	"fmt"
	"time"

	"github.com/hashicorp/cronexpr"
)

const hourlyCronExpr = "1 * * * *"

func NextAfter(expr string, after time.Time) (time.Time, error) {
	parsed, err := cronexpr.Parse(expr)
	if err != nil {
		return time.Time{}, err
	}
	// cronexpr.Next already returns a time strictly after its argument.
	return parsed.Next(after).UTC(), nil
}

func RunHourlyCron(ctx context.Context, fn func(context.Context)) {
	fn(ctx)
	for {
		timer := time.NewTimer(time.Until(nextHourlyRun(time.Now())))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
			fn(ctx)
		}
	}
}

func nextHourlyRun(after time.Time) time.Time {
	return cronexpr.MustParse(hourlyCronExpr).Next(after)
}

func NextAfterInZone(expr string, tz string, after time.Time) (time.Time, error) {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.Time{}, err
	}
	parsed, err := cronexpr.Parse(expr)
	if err != nil {
		return time.Time{}, err
	}
	return parsed.Next(after.In(loc)).UTC(), nil
}

func ValidateMinInterval(expr string, minInterval time.Duration) error {
	parsed, err := cronexpr.Parse(expr)
	if err != nil {
		return err
	}
	prev := parsed.Next(time.Now().UTC())
	for range 10_000 {
		next := parsed.Next(prev)
		if next.IsZero() {
			return nil
		}
		if next.Sub(prev) < minInterval {
			return fmt.Errorf("scheduled syncs must be %s or more apart", minInterval)
		}
		prev = next
	}
	return nil
}
