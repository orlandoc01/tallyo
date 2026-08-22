package plaid

import (
	"context"
	"log/slog"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/clients"
	"tallyo/internal/database"
	"tallyo/internal/graph/model"
	"tallyo/internal/wealth"
	wealthdb "tallyo/internal/wealth/db"
	"tallyo/internal/wealth/syncerids"
)

type PlaidBalanceStore interface {
	PlaidItemsDueForBalanceSync(ctx context.Context, now time.Time) ([]accounts.PlaidItemSecret, error)
	PlaidItemSecretByID(ctx context.Context, itemID int64) (*accounts.PlaidItemSecret, error)
	BalanceSyncScheduleCron(ctx context.Context, id syncerids.ID) (string, error)
	SetItemBalanceSynced(ctx context.Context, itemID int64, nextBalanceSyncAt time.Time) error
}

// ReadStore extends the base adapter read surface with the adapter-source
// lookup needed to resolve a holding's persisted asset (with any stored
// custom tracking, forced price, or user-edited identifier) before pricing.
type ReadStore interface {
	wealth.AdapterReadStore
	AssetByAdapterSource(ctx context.Context, source wealth.AdapterSource) (*model.Asset, error)
}

type Adapter struct {
	wealth.BaseAdapter
	plaid   PlaidBalanceStore
	clients clients.PlaidClientFactory
	prices  wealth.PriceProvider
	reads   ReadStore
}

func New(
	db *database.DB,
	clients clients.PlaidClientFactory,
	prices wealth.PriceProvider,
	log *slog.Logger,
) *Adapter {
	store := wealthdb.New(db)
	return &Adapter{
		BaseAdapter: wealth.BaseAdapter{Reads: store, Log: log},
		plaid:       store,
		clients:     clients,
		prices:      prices,
		reads:       store,
	}
}

func (a *Adapter) Source() syncerids.ID {
	return syncerids.Plaid
}
