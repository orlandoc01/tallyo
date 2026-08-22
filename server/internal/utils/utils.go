package utils

import "context"

// PollChannel reads values until ctx is canceled or the channel closes.
func PollChannel[T any](ctx context.Context, values <-chan T, handler func(context.Context, T)) {
	for {
		select {
		case <-ctx.Done():
			return
		case value, ok := <-values:
			if !ok {
				return
			}
			handler(ctx, value)
		}
	}
}
