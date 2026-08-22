package utils

import (
	"context"
	"slices"
	"sync/atomic"
	"testing"
	"time"
)

func TestPollChannelProcessesInOrderWithoutOverlap(t *testing.T) {
	ctx := t.Context()
	values := make(chan int, 3)
	values <- 1
	values <- 2
	values <- 3
	close(values)

	var active atomic.Int32
	seen := []int{}
	done := make(chan struct{})
	go func() {
		PollChannel(ctx, values, func(_ context.Context, value int) {
			if active.Add(1) != 1 {
				t.Errorf("handler overlapped for value %d", value)
			}
			defer active.Add(-1)
			seen = append(seen, value)
			time.Sleep(time.Millisecond)
		})
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("PollChannel did not exit after channel close")
	}
	if !slices.Equal(seen, []int{1, 2, 3}) {
		t.Fatalf("seen = %v, want [1 2 3]", seen)
	}
}
