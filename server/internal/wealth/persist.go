package wealth

import (
	"context"
	"errors"
)

func WithPersist(ctx context.Context, sink PersistSink, emit func(chan<- PersistEvent) error) error {
	events, result := sink.Open(ctx)
	err := emit(events)
	close(events)
	return errors.Join(err, <-result)
}
