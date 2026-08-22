package balancesync

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/database"
	u "tallyo/internal/utils"
	"tallyo/internal/wealth"
	wealthdb "tallyo/internal/wealth/db"
)

// assetSweeper garbage-collects unreferenced asset catalog rows after a sync run.
type assetSweeper interface {
	SweepUnreferencedAssets(ctx context.Context) (int64, error)
}

type BalanceSyncer struct {
	adapters         []wealth.SyncAdapter
	persister        *wealth.SnapshotPersister
	assets           assetSweeper
	portfolioSync    wealth.PortfolioSyncer
	events           <-chan accounts.AccountsCreated
	log              *slog.Logger
	now              func() time.Time
	trackingDisabled func() bool
}

type Config struct {
	PortfolioSync    wealth.PortfolioSyncer
	TrackingDisabled func() bool
}

func New(
	db *database.DB,
	adapters []wealth.SyncAdapter,
	cfg Config,
	log *slog.Logger,
) *BalanceSyncer {
	store := wealthdb.New(db, wealthdb.WithLogger(log))
	portfolioSync := cfg.PortfolioSync
	if portfolioSync == nil {
		portfolioSync = noopPortfolioSyncer{}
	}
	trackingDisabled := cfg.TrackingDisabled
	if trackingDisabled == nil {
		trackingDisabled = func() bool { return false }
	}
	return &BalanceSyncer{
		adapters:         adapters,
		persister:        &wealth.SnapshotPersister{Wealth: store},
		assets:           store,
		portfolioSync:    portfolioSync,
		log:              log,
		now:              time.Now,
		trackingDisabled: trackingDisabled,
	}
}

type noopPortfolioSyncer struct{}

func (noopPortfolioSyncer) SyncAll(context.Context) error { return nil }

func (s *BalanceSyncer) Run(ctx context.Context) {
	u.RunHourlyCron(ctx, s.syncDue)
}

func (s *BalanceSyncer) Subscribe(events <-chan accounts.AccountsCreated) {
	s.events = events
}

func (s *BalanceSyncer) RunAccountEvents(ctx context.Context) {
	u.PollChannel(ctx, s.events, func(ctx context.Context, ev accounts.AccountsCreated) {
		s.syncAccountCreated(ctx, ev)
	})
}

func (s *BalanceSyncer) syncAccountCreated(ctx context.Context, ev accounts.AccountsCreated) {
	if s.trackingDisabled() {
		return
	}
	conn := wealth.ConnectionRef{
		ConnectionID: ev.ConnectionID,
		SourceTable:  ev.Provider,
		SourceID:     ev.SourceID,
	}
	for _, adapter := range s.adapters {
		handled, err := adapter.Handles(ctx, conn)
		if err != nil {
			s.logError(
				"balance sync adapter routing failed",
				err,
				"source",
				adapter.Source(),
				"connection_id",
				ev.ConnectionID,
				"source_id",
				ev.SourceID,
			)
			continue
		}
		if !handled {
			continue
		}
		if err := s.runPipeline(ctx, func(sink wealth.PersistSink) error {
			return adapter.SyncConnectionInto(ctx, conn, sink)
		}); err != nil {
			s.logError("initial balance sync failed", err, ev.LogAttrs()...)
		}
		return
	}
	s.log.Warn("no balance sync adapter for account event", ev.LogAttrs()...)
}

func (s *BalanceSyncer) syncDue(ctx context.Context) {
	if s.trackingDisabled() {
		return
	}
	if err := s.runPipeline(ctx, func(sink wealth.PersistSink) error {
		for _, adapter := range s.adapters {
			if err := adapter.SyncDue(ctx, sink); err != nil {
				s.logError("balance sync adapter failed", err)
			}
		}
		return nil
	}); err != nil {
		s.logError("balance sync failed", err)
	}
	if err := s.portfolioSync.SyncAll(ctx); err != nil {
		s.logError("portfolio analysis sync failed", err)
	}
}

func (s *BalanceSyncer) runPipeline(ctx context.Context, produce func(wealth.PersistSink) error) error {
	now := s.now().UTC()
	sink := s.persister.WithRun(wealth.UTCDate(now), now)
	if err := produce(sink); err != nil {
		return fmt.Errorf("produce balance snapshots: %w", err)
	}
	// Once the run's snapshots are committed, sweep any asset catalog rows left
	// unreferenced. Best-effort housekeeping — never fail the sync over it.
	if removed, err := s.assets.SweepUnreferencedAssets(ctx); err != nil {
		s.log.Warn("sweep unreferenced assets failed", "error", err)
	} else if removed > 0 {
		s.log.Info("swept unreferenced assets", "removed", removed)
	}
	return nil
}

func (s *BalanceSyncer) logError(message string, err error, args ...any) {
	s.log.Error(message, append(args, "error", err)...)
}
