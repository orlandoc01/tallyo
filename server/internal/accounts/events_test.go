package accounts

import (
	"context"
	"testing"
	"time"

	"tallyo/internal/utils/nooplog"
)

func TestEventBusFansOutToSubscribers(t *testing.T) {
	bus := NewEventBus(nooplog.Logger)
	first := bus.RegisterSubscriber("first")
	second := bus.RegisterSubscriber("second")
	event := AccountsCreated{
		ConnectionID: 1,
		Provider:     SourceTablePlaidItem,
		SourceID:     1,
	}

	bus.Publish(event)

	assertAccountsCreated(t, first, event)
	assertAccountsCreated(t, second, event)
}

func TestEventBusDropsWhenSubscriberBufferIsFull(t *testing.T) {
	bus := NewEventBus(nooplog.Logger)
	subscriber := bus.RegisterSubscriber("blocked")
	for i := range accountsCreatedBufferSize + 1 {
		bus.Publish(AccountsCreated{ConnectionID: 1, SourceID: int64(i)})
	}

	for range accountsCreatedBufferSize {
		select {
		case <-subscriber:
		case <-time.After(time.Second):
			t.Fatal("subscriber buffer was not filled")
		}
	}
	select {
	case ev := <-subscriber:
		t.Fatalf("unexpected undropped event: %#v", ev)
	default:
	}
}

func assertAccountsCreated(t *testing.T, ch <-chan AccountsCreated, want AccountsCreated) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	select {
	case got := <-ch:
		if got.ConnectionID != want.ConnectionID || got.SourceID != want.SourceID || got.Provider != want.Provider {
			t.Fatalf("event = %#v, want %#v", got, want)
		}
	case <-ctx.Done():
		t.Fatal("timed out waiting for event")
	}
}
