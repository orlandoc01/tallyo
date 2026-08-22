package transactions

import (
	"context"
	"errors"
)

func WithPersist(ctx context.Context, sink PersistSink, emit func(chan<- PersistEvent) error) PersistResult {
	events, result := sink.Open(ctx)
	err := emit(events)
	close(events)
	persist := <-result
	persist.Err = errors.Join(err, persist.Err)
	return persist
}
