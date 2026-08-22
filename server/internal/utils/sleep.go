package utils

import (
	"context"
	"time"
)

// Sleeper performs a context-aware delay. Embed it in services that need to
// pause between retries or batched calls.
type Sleeper struct {
	// Sleep overrides the delay behavior, primarily for tests. When nil,
	// SleepBeforeContinue waits on a real timer.
	Sleep func(context.Context, time.Duration) error
}

// SleepBeforeContinue blocks for delay, returning early if ctx is canceled.
func (s Sleeper) SleepBeforeContinue(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	if s.Sleep != nil {
		return s.Sleep(ctx, delay)
	}

	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
