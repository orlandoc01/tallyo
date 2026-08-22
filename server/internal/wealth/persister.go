package wealth

import (
	"context"
	"fmt"
	"time"
)

type SnapshotPersister struct {
	Wealth BalanceWealthStore
	today  string
	now    time.Time
}

// SnapshotPersister also implements PersistSink. WithRun binds the shared
// persister to one sync run's UTC date bucket and clock.

func (p *SnapshotPersister) WithRun(today string, now time.Time) *SnapshotPersister {
	clone := *p
	clone.today = today
	clone.now = now.UTC()
	return &clone
}

func (p *SnapshotPersister) Open(ctx context.Context) (chan<- PersistEvent, <-chan error) {
	events := make(chan PersistEvent)
	result := make(chan error, 1)
	go func() {
		var firstErr error
		for event := range events {
			if firstErr != nil {
				continue
			}
			if err := ctx.Err(); err != nil {
				firstErr = err
				continue
			}
			firstErr = p.apply(ctx, event)
		}
		result <- firstErr
	}()
	return events, result
}

func (p *SnapshotPersister) Today() string {
	return p.today
}

func (p *SnapshotPersister) Now() time.Time {
	return p.now
}

func (p *SnapshotPersister) apply(ctx context.Context, event PersistEvent) error {
	switch {
	case event.Snapshot != nil:
		return p.persistSnapshot(ctx, *event.Snapshot)
	case event.Asset != nil:
		return p.persistAssetUpdate(ctx, *event.Asset)
	default:
		return fmt.Errorf("empty persist event")
	}
}

func (p *SnapshotPersister) persistSnapshot(ctx context.Context, draft SnapshotDraft) error {
	syncedAt, err := parseSyncedAt(draft.SyncedAt)
	if err != nil {
		return fmt.Errorf("parse snapshot synced_at %q: %w", draft.SyncedAt, err)
	}
	persist, err := snapshotPersist(draft, syncedAt)
	if err != nil {
		return err
	}
	if err := p.Wealth.PersistSnapshot(ctx, persist); err != nil {
		return fmt.Errorf("persist snapshot: %w", err)
	}
	return nil
}

func snapshotPersist(draft SnapshotDraft, syncedAt time.Time) (SnapshotPersist, error) {
	snapshot := draft.AccountBalanceSnapshot
	persist := SnapshotPersist{Snapshot: snapshot, SyncedAt: syncedAt}
	switch draft.Decision {
	case DecisionClean:
		persist.ExpireReview = true
		if draft.Anchor.Found {
			persist.Recovery = &SnapshotRecovery{
				AccountID:  draft.AccountID,
				AfterDate:  draft.Anchor.Date,
				BeforeDate: draft.Date,
			}
		}
	case DecisionFlagged:
		if draft.ProviderState == nil {
			return SnapshotPersist{}, fmt.Errorf("flagged snapshot missing provider state")
		}
		snapshot.BalanceUSD = draft.CarryUSD
		snapshot.Flagged = true
		persist.Snapshot = snapshot
		persist.Review = draft.Review
		persist.ProviderState = draft.ProviderState
	case DecisionApprovedCarryForward:
		snapshot.BalanceUSD = draft.CarryUSD
		snapshot.Flagged = true
		persist.Snapshot = snapshot
	default:
		return SnapshotPersist{}, fmt.Errorf("unknown snapshot decision %d", draft.Decision)
	}
	return persist, nil
}

func (p *SnapshotPersister) persistAssetUpdate(ctx context.Context, asset AssetUpdate) error {
	if err := p.Wealth.PersistAssetUpdate(ctx, asset); err != nil {
		return fmt.Errorf("persist asset update: %w", err)
	}
	return nil
}

func parseSyncedAt(value string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, err
	}
	return parsed.UTC(), nil
}
