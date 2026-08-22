package realestate

import (
	"context"
	"fmt"

	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

var _ wealth.SyncAdapter = (*Service)(nil)

func (s *Service) Handles(ctx context.Context, conn wealth.ConnectionRef) (bool, error) {
	if conn.SourceTable != wealth.SourceTableAssets {
		return false, nil
	}
	re, err := s.Store.RealEstateByConnectionID(ctx, conn.ConnectionID)
	return re != nil, err
}

func (s *Service) Source() syncerids.ID {
	return syncerids.RealEstate
}

func (s *Service) SyncDue(ctx context.Context, sink wealth.PersistSink) error {
	return wealth.RunScheduledBalanceSync(ctx, s.Store, syncerids.RealEstate, sink.Now(), func() error {
		return s.snapshotAll(ctx, sink)
	})
}

func (s *Service) SyncConnectionInto(
	ctx context.Context,
	conn wealth.ConnectionRef,
	sink wealth.PersistSink,
) error {
	re, err := s.Store.RealEstateByConnectionID(ctx, conn.ConnectionID)
	if err != nil {
		return fmt.Errorf("lookup real estate for connection %d: %w", conn.ConnectionID, err)
	}
	if re == nil {
		return fmt.Errorf("real estate for connection %d not found", conn.ConnectionID)
	}
	if err := wealth.WithPersist(ctx, sink, func(events chan<- wealth.PersistEvent) error {
		return s.emitSnapshot(ctx, *re, sink, events)
	}); err != nil {
		return fmt.Errorf("persist real estate snapshot: %w", err)
	}
	return nil
}

func (s *Service) snapshotAll(ctx context.Context, sink wealth.PersistSink) error {
	homes, err := s.Store.ActiveRealEstate(ctx)
	if err != nil {
		return fmt.Errorf("list real estate for balance sync: %w", err)
	}
	return s.emitSnapshots(ctx, homes, sink)
}

func (s *Service) emitSnapshots(
	ctx context.Context,
	homes []wealth.RealEstate,
	sink wealth.PersistSink,
) error {
	if err := wealth.WithPersist(ctx, sink, func(events chan<- wealth.PersistEvent) error {
		for _, home := range homes {
			if err := s.emitSnapshot(ctx, home, sink, events); err != nil {
				s.Log.Error("real estate balance sync failed", "account_id", home.AccountID, "error", err)
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("persist real estate snapshots: %w", err)
	}
	return nil
}

func (s *Service) emitSnapshot(
	ctx context.Context,
	re wealth.RealEstate,
	sink wealth.PersistSink,
	events chan<- wealth.PersistEvent,
) error {
	latest, err := s.Store.LatestAccountBalanceSnapshotForAccount(ctx, re.AccountID)
	if err != nil {
		return fmt.Errorf("latest real estate snapshot: %w", err)
	}
	if latest == nil {
		return nil
	}
	draft := wealth.SnapshotDraft{
		AccountBalanceSnapshot: wealth.NewRealEstateSnapshot(
			re,
			latest.BalanceUSD,
			s.Source().Str(),
			sink.Today(),
			sink.Now(),
		),
		Decision: wealth.DecisionClean,
	}
	events <- wealth.PersistEvent{Snapshot: &draft}
	return nil
}
