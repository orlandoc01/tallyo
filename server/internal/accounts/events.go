package accounts

import (
	"log/slog"
	"sync"
)

type SourceTable string

const (
	SourceTablePlaidItem           SourceTable = "plaid_items"
	SourceTableEVMWallet           SourceTable = "evm_wallets"
	SourceTableSimpleFinConnection SourceTable = "simplefin_connections"
	SourceTableAsset               SourceTable = "assets"

	accountsCreatedBufferSize = 64
)

// AccountsCreated describes a freshly linked connection. Subscribers route
// by ConnectionID, Provider, and SourceID.
type AccountsCreated struct {
	ConnectionID int64
	Provider     SourceTable
	SourceID     int64
}

// LogAttrs returns the event's identifying slog attribute pairs.
func (ev AccountsCreated) LogAttrs() []any {
	return []any{"provider", ev.Provider, "connection_id", ev.ConnectionID, "source_id", ev.SourceID}
}

type Publisher interface {
	// Publish sends to every subscriber without blocking the caller. If a
	// subscriber buffer is full, the event is dropped and logged.
	Publish(ev AccountsCreated)
}

type EventBus struct {
	mu          sync.RWMutex
	subscribers []accountSubscriber
	log         *slog.Logger
}

type accountSubscriber struct {
	name string
	ch   chan AccountsCreated
}

func NewEventBus(log *slog.Logger) *EventBus {
	return &EventBus{
		log: log,
	}
}

func (b *EventBus) RegisterSubscriber(name string) <-chan AccountsCreated {
	ch := make(chan AccountsCreated, accountsCreatedBufferSize)
	b.mu.Lock()
	b.subscribers = append(b.subscribers, accountSubscriber{name: name, ch: ch})
	b.mu.Unlock()
	return ch
}

func (b *EventBus) Publish(ev AccountsCreated) {
	b.mu.RLock()
	subscribers := append([]accountSubscriber{}, b.subscribers...)
	b.mu.RUnlock()

	for _, subscriber := range subscribers {
		select {
		case subscriber.ch <- ev:
		default:
			b.log.Warn(
				"dropped accounts created event",
				append([]any{"subscriber", subscriber.name}, ev.LogAttrs()...)...,
			)
		}
	}
}

var _ Publisher = (*EventBus)(nil)
