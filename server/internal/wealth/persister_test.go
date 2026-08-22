package wealth

import (
	"context"
	"testing"
	"time"

	"tallyo/internal/graph/model"
)

func TestSnapshotPersisterDecisionsAndAssetUpdates(t *testing.T) {
	ctx := context.Background()
	store := &persisterStore{assets: map[int64]*model.Asset{1: {ID: model.New(model.GlobalIDAsset, 1)}}}
	p := (&SnapshotPersister{Wealth: store}).WithRun("2026-06-01", time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC))
	syncedAt := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)

	events, result := p.Open(ctx)
	events <- PersistEvent{Snapshot: &SnapshotDraft{
		AccountBalanceSnapshot: AccountBalanceSnapshot{
			AccountID: 1,
			Source:    "plaid",
			Date:      "2026-06-01",
			SyncedAt:  syncedAt.Format(time.RFC3339),
			Holdings:  []AssetDailyHolding{{Asset: &AssetUpsert{Identifier: "VTI"}, ValueUSD: 10}},
		},
		Decision: DecisionClean,
		Anchor:   LastUnflaggedBalanceResult{Found: true, Date: "2026-05-31"},
	}}
	events <- PersistEvent{Snapshot: &SnapshotDraft{
		AccountBalanceSnapshot: AccountBalanceSnapshot{
			AccountID:  2,
			Source:     "debank",
			Date:       "2026-06-01",
			SyncedAt:   syncedAt.Format(time.RFC3339),
			BalanceUSD: 999,
			FlagReason: "spike",
		},
		Decision: DecisionFlagged,
		CarryUSD: 100,
		Review: &BalanceReviewUpsert{
			AccountID:          2,
			ProviderBalanceUSD: 999,
			FlagReason:         "spike",
		},
		ProviderState: &SnapshotProviderState{
			ProviderBalanceUSD:   999,
			ProviderHoldingsJSON: "[]",
		},
	}}
	events <- PersistEvent{Snapshot: &SnapshotDraft{
		AccountBalanceSnapshot: AccountBalanceSnapshot{
			AccountID:  3,
			Source:     "plaid",
			Date:       "2026-06-01",
			SyncedAt:   syncedAt.Format(time.RFC3339),
			BalanceUSD: 999,
			Holdings:   []AssetDailyHolding{{AssetID: 1, ValueUSD: 100, CountsTowardValue: true}},
		},
		Decision: DecisionFlagged,
		CarryUSD: 100,
		ProviderState: &SnapshotProviderState{
			ProviderBalanceUSD:   999,
			ProviderHoldingsJSON: "[]",
		},
	}}
	events <- PersistEvent{Snapshot: &SnapshotDraft{
		AccountBalanceSnapshot: AccountBalanceSnapshot{
			AccountID:  4,
			Source:     "debank",
			Date:       "2026-06-01",
			SyncedAt:   syncedAt.Format(time.RFC3339),
			BalanceUSD: 999,
		},
		Decision: DecisionApprovedCarryForward,
		CarryUSD: 100,
	}}
	events <- PersistEvent{Asset: &AssetUpdate{AssetID: 1, Price: 2, PriceAt: syncedAt}}
	close(events)

	if got := <-result; got != nil {
		t.Fatalf("persist error = %v", got)
	}
	if len(store.snapshots) != 4 || len(store.synced) != 4 {
		t.Fatalf("snapshots=%d synced=%d", len(store.snapshots), len(store.synced))
	}
	if !store.snapshots[1].Flagged || store.snapshots[1].BalanceUSD != 100 || len(store.snapshots[1].Holdings) != 0 {
		t.Fatalf("flagged snapshot = %#v", store.snapshots[1])
	}
	if !store.snapshots[2].Flagged ||
		len(store.snapshots[2].Holdings) != 1 ||
		store.snapshots[2].Holdings[0].ValueUSD != 100 {
		t.Fatalf("flagged snapshot holdings = %#v", store.snapshots[2])
	}
	if len(store.reviews) != 1 || len(store.unflagged) != 1 || len(store.deletedReviews) != 1 {
		t.Fatalf("reviews=%d unflagged=%d deleted=%d", len(store.reviews), len(store.unflagged), len(store.deletedReviews))
	}
	if store.priceUpdates != 1 || store.assets[1].ID.Int64() == 0 {
		t.Fatalf("priceUpdates=%d assets=%#v", store.priceUpdates, store.assets)
	}
}

func TestSnapshotPersisterRejectsBadSyncedAt(t *testing.T) {
	ctx := context.Background()
	store := &persisterStore{assets: map[int64]*model.Asset{1: {ID: model.New(model.GlobalIDAsset, 1)}}}
	p := (&SnapshotPersister{Wealth: store}).WithRun("2026-06-01", time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC))
	events, result := p.Open(ctx)
	events <- PersistEvent{Snapshot: &SnapshotDraft{AccountBalanceSnapshot: AccountBalanceSnapshot{AccountID: 1, Source: "test", Date: "2026-06-01", SyncedAt: "bad-date"}}}
	events <- PersistEvent{Asset: &AssetUpdate{AssetID: 1, Price: 1, PriceAt: time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)}}
	close(events)
	if got := <-result; got == nil {
		t.Fatal("persist error = nil, want bad synced_at error")
	}
	if len(store.snapshots) != 0 || store.priceUpdates != 0 {
		t.Fatalf("snapshots=%d priceUpdates=%d", len(store.snapshots), store.priceUpdates)
	}
	if _, err := parseSyncedAt("bad-date"); err == nil {
		t.Fatal("parseSyncedAt(bad-date) error = nil")
	}
}

func TestSnapshotPersisterSessionHelpersAndErrors(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	store := &persisterStore{assets: map[int64]*model.Asset{1: {ID: model.New(model.GlobalIDAsset, 1)}}}
	p := (&SnapshotPersister{Wealth: store}).WithRun("2026-06-01", now)

	if p.Today() != "2026-06-01" || !p.Now().Equal(now) {
		t.Fatalf("sink time = %q %v", p.Today(), p.Now())
	}

	multiplier := 1.5
	events, result := p.Open(ctx)
	events <- PersistEvent{Asset: &AssetUpdate{
		AssetID:            1,
		Price:              10,
		PriceAt:            now,
		TrackingMultiplier: &multiplier,
	}}
	close(events)
	if got := <-result; got != nil {
		t.Fatalf("persist error = %v", got)
	}
	if store.priceUpdates != 1 || store.multiplierUpdates != 1 {
		t.Fatalf("priceUpdates=%d multiplierUpdates=%d", store.priceUpdates, store.multiplierUpdates)
	}

	events, result = p.Open(ctx)
	events <- PersistEvent{}
	close(events)
	if got := <-result; got == nil {
		t.Fatal("empty event error = nil")
	}

	canceled, cancel := context.WithCancel(ctx)
	cancel()
	events, result = p.Open(canceled)
	events <- PersistEvent{Asset: &AssetUpdate{AssetID: 1, Price: 1, PriceAt: now}}
	close(events)
	if got := <-result; got == nil {
		t.Fatal("canceled context error = nil")
	}

	events, result = p.Open(ctx)
	events <- PersistEvent{Snapshot: &SnapshotDraft{
		AccountBalanceSnapshot: AccountBalanceSnapshot{AccountID: 1, Source: "test", Date: "2026-06-01"},
		Decision:               SnapshotDecision(99),
	}}
	close(events)
	if got := <-result; got == nil {
		t.Fatal("unknown decision error = nil")
	}
}

type persisterStore struct {
	assets            map[int64]*model.Asset
	snapshots         []AccountBalanceSnapshot
	synced            []int64
	reviews           []BalanceReviewUpsert
	unflagged         []int64
	deletedReviews    []int64
	priceUpdates      int
	multiplierUpdates int
}

func (s *persisterStore) PersistSnapshot(ctx context.Context, persist SnapshotPersist) error {
	if err := s.ReplaceAccountBalanceSnapshot(ctx, persist.Snapshot); err != nil {
		return err
	}
	if persist.Recovery != nil {
		s.unflagged = append(s.unflagged, persist.Recovery.AccountID)
	}
	if persist.ExpireReview {
		s.deletedReviews = append(s.deletedReviews, persist.Snapshot.AccountID)
	}
	if persist.Review != nil {
		if err := s.UpsertBalanceReview(ctx, *persist.Review); err != nil {
			return err
		}
	}
	return s.MarkAccountBalanceSynced(ctx, persist.Snapshot.AccountID, persist.SyncedAt)
}

func (s *persisterStore) PersistAssetUpdate(ctx context.Context, update AssetUpdate) error {
	if err := s.UpdateAssetPrice(ctx, update.AssetID, update.Price, update.PriceAt); err != nil {
		return err
	}
	if update.TrackingMultiplier != nil {
		s.multiplierUpdates++
	}
	return nil
}

func (s *persisterStore) UpsertBalanceReview(_ context.Context, review BalanceReviewUpsert) error {
	s.reviews = append(s.reviews, review)
	return nil
}
func (s *persisterStore) ReplaceAccountBalanceSnapshot(ctx context.Context, snapshot AccountBalanceSnapshot) error {
	// Mirror the real store: asset upserts and per-holding price updates happen
	// inside this call's (transactional) scope, not in the persister.
	for i := range snapshot.Holdings {
		if snapshot.Holdings[i].Asset == nil {
			continue
		}
		asset, err := s.UpsertAsset(ctx, *snapshot.Holdings[i].Asset)
		if err != nil {
			return err
		}
		snapshot.Holdings[i].AssetID = asset.ID.Int64()
		if update := snapshot.Holdings[i].PriceUpdate; update != nil {
			s.priceUpdates++
			if update.TrackingMultiplier != nil {
				s.multiplierUpdates++
			}
		}
	}
	s.snapshots = append(s.snapshots, snapshot)
	return nil
}
func (s *persisterStore) MarkAccountBalanceSynced(_ context.Context, accountID int64, _ time.Time) error {
	s.synced = append(s.synced, accountID)
	return nil
}
func (s *persisterStore) UpdateAssetPrice(context.Context, int64, float64, time.Time) error {
	s.priceUpdates++
	return nil
}
func (s *persisterStore) UpsertAsset(_ context.Context, asset AssetUpsert) (*model.Asset, error) {
	id := int64(len(s.assets) + 1)
	created := &model.Asset{ID: model.New(model.GlobalIDAsset, id), Identifier: asset.Identifier}
	s.assets[id] = created
	return created, nil
}
