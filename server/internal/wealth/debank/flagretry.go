package debank

import "time"

const (
	flagRetryBaseDelay = 5 * time.Minute
	flagRetryWindow    = 2 * time.Hour
	flagRetryMaxShift  = 5 // 2^5 * 5m = 160m, already beyond flagRetryWindow
)

// nextFlagRetryDelay returns the exponential backoff delay before the next
// deviation recheck, capped at flagRetryWindow.
func nextFlagRetryDelay(retryCount int32) time.Duration {
	shift := min(retryCount, flagRetryMaxShift)
	delay := flagRetryBaseDelay * time.Duration(int64(1)<<uint(shift))
	return min(delay, flagRetryWindow)
}
