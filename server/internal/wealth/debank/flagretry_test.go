package debank

import (
	"testing"
	"time"
)

func TestNextFlagRetryDelay(t *testing.T) {
	cases := []struct {
		retryCount int32
		want       time.Duration
	}{
		{0, 5 * time.Minute},
		{1, 10 * time.Minute},
		{2, 20 * time.Minute},
		{3, 40 * time.Minute},
		{4, 80 * time.Minute},
		{5, 120 * time.Minute},  // capped at flagRetryWindow (2h)
		{6, 120 * time.Minute},  // capped before exponential growth can overflow
		{20, 120 * time.Minute}, // large retry counts stay capped
	}
	for _, tc := range cases {
		if got := nextFlagRetryDelay(tc.retryCount); got != tc.want {
			t.Errorf("nextFlagRetryDelay(%d) = %v, want %v", tc.retryCount, got, tc.want)
		}
	}
}
