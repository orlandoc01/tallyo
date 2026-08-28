package simplefin

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/clients"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

type SimpleFinBalanceStore interface {
	wealth.AdapterReadStore
	SimpleFinTokensDueForBalanceSync(ctx context.Context, now time.Time) ([]accounts.SimpleFinAccessTokenSecret, error)
	SimpleFinTokenSecretByConnID(ctx context.Context, connID int64) (*accounts.SimpleFinAccessTokenSecret, error)
	BalanceSyncScheduleCron(ctx context.Context, id syncerids.ID) (string, error)
	SetSimpleFinTokenBalanceSynced(ctx context.Context, id int64, nextBalanceSyncAt time.Time) error
}

type Adapter struct {
	wealth.BaseAdapter
	store  SimpleFinBalanceStore
	client clients.SimpleFinClient
}

var _ wealth.SyncAdapter = (*Adapter)(nil)

func New(
	store SimpleFinBalanceStore,
	client clients.SimpleFinClient,
	log *slog.Logger,
) *Adapter {
	return &Adapter{
		Reads:  store,
		Log:    log,
		store:  store,
		client: client,
	}
}

func (a *Adapter) Handles(_ context.Context, conn wealth.ConnectionRef) (bool, error) {
	return conn.SourceTable == accounts.SourceTableSimpleFinConnection, nil
}

func (a *Adapter) Source() syncerids.ID {
	return syncerids.SimpleFin
}

func (a *Adapter) SyncDue(ctx context.Context, sink wealth.PersistSink) error {
	tokens, err := a.store.SimpleFinTokensDueForBalanceSync(ctx, sink.Now())
	if err != nil {
		return err
	}
	cron, err := a.store.BalanceSyncScheduleCron(ctx, syncerids.SimpleFin)
	if err != nil {
		return err
	}
	for _, token := range tokens {
		if err := a.SyncTokenInto(ctx, token, cron, sink); err != nil {
			a.Log.Error("simplefin balance sync token failed", "token_id", token.ID, "error", err)
		}
	}
	return nil
}

func (a *Adapter) SyncConnectionInto(
	ctx context.Context,
	conn wealth.ConnectionRef,
	sink wealth.PersistSink,
) error {
	return wealth.SyncConnectionVia(ctx, sink, "simplefin token for connection", conn.SourceID, a.store.SimpleFinTokenSecretByConnID, func(ctx context.Context) (string, error) {
		return a.store.BalanceSyncScheduleCron(ctx, syncerids.SimpleFin)
	}, a.SyncTokenInto)
}

func (a *Adapter) SyncTokenInto(
	ctx context.Context,
	token accounts.SimpleFinAccessTokenSecret,
	cron string,
	sink wealth.PersistSink,
) error {
	accountSet, err := a.client.GetAccounts(ctx, token.AccessURL, clients.GetAccountsOpts{})
	if err != nil {
		return fmt.Errorf("simplefin accounts get: %w", err)
	}
	next, err := wealth.NextBalanceSyncAfter(
		cron,
		sink.Now(),
	)
	if err != nil {
		return err
	}

	if err := wealth.WithPersist(ctx, sink, func(events chan<- wealth.PersistEvent) error {
		return a.reconcileAccounts(ctx, accountSet.Accounts, sink, events)
	}); err != nil {
		a.Log.Warn("persist simplefin token snapshots failed", "token_id", token.ID, "error", err)
		return err
	}
	return a.store.SetSimpleFinTokenBalanceSynced(ctx, token.ID, next)
}
