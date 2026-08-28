package balancesync

import (
	"context"
	"testing"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/graph/model"
	testutil "tallyo/internal/utils/test"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

func TestNewWiresAdaptersAndPersister(t *testing.T) {
	store := testutil.OpenStore(t)
	adapter := &recordingAdapter{}
	syncer := New(
		store.Database(),
		[]wealth.SyncAdapter{adapter},
		Config{},
		testutil.Logger,
	)
	if syncer == nil || len(syncer.adapters) != 1 || syncer.adapters[0] != adapter || syncer.persister == nil || syncer.assets == nil {
		t.Fatalf("New() = %#v", syncer)
	}
}

func trackingEnabled() bool { return false }

func TestSyncDuePersistsAdapterDraftsAndPortfolio(t *testing.T) {
	ctx := context.Background()
	store := &syncStore{assets: map[int64]*model.Asset{}}
	portfolio := &recordingPortfolio{}
	adapter := &recordingAdapter{}
	syncer := testBalanceSyncer(store, adapter, portfolio, func() time.Time { return time.Date(2026, 6, 1, 23, 30, 0, 0, time.UTC) })

	syncer.syncDue(ctx)
	if store.swept != 1 {
		t.Fatalf("unreferenced-asset sweep ran %d times, want 1", store.swept)
	}
	if !adapter.due || len(store.snapshots) != 1 || len(store.synced) != 1 || !adapter.advanced || portfolio.calls != 1 {
		t.Fatalf(
			"adapter=%#v snapshots=%d synced=%d portfolio=%d",
			adapter,
			len(store.snapshots),
			len(store.synced),
			portfolio.calls,
		)
	}
	if store.snapshots[0].Date != "2026-06-01" {
		t.Fatalf("UTC snapshot date = %q", store.snapshots[0].Date)
	}
}

func TestSyncDueLogsAdapterErrors(t *testing.T) {
	ctx := context.Background()
	store := &syncStore{assets: map[int64]*model.Asset{}}
	adapter := &recordingAdapter{err: context.Canceled}
	syncer := testBalanceSyncer(store, adapter, noopPortfolioSyncer{}, func() time.Time { return time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC) })
	syncer.syncDue(ctx)
	if !adapter.due {
		t.Fatal("SyncDue was not called")
	}
	if syncer.now().IsZero() {
		t.Fatal("now returned zero")
	}
}

func TestRunStopsOnCancelledContext(t *testing.T) {
	store := &syncStore{assets: map[int64]*model.Asset{}}
	adapter := &recordingAdapter{}
	syncer := testBalanceSyncer(store, adapter, noopPortfolioSyncer{}, func() time.Time { return time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC) })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	syncer.Run(ctx)
	if !adapter.due {
		t.Fatal("Run did not perform initial due sync")
	}
}

func TestAccountEventRoutesToMatchingAdapterWithoutPortfolioSync(t *testing.T) {
	ctx := context.Background()
	store := &syncStore{assets: map[int64]*model.Asset{}}
	portfolio := &recordingPortfolio{}
	adapter := &recordingAdapter{provider: accounts.SourceTablePlaidItem}
	syncer := testBalanceSyncer(
		store,
		adapter,
		portfolio,
		func() time.Time { return time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC) },
	)

	syncer.syncAccountCreated(ctx, accounts.AccountsCreated{
		ConnectionID: 1,
		Provider:     accounts.SourceTablePlaidItem,
		SourceID:     1,
	})

	if !adapter.connection || adapter.conn.SourceTable != accounts.SourceTablePlaidItem || adapter.conn.SourceID != 1 {
		t.Fatalf("adapter = %#v", adapter)
	}
	if len(store.snapshots) != 1 || len(store.synced) != 1 {
		t.Fatalf("snapshots=%d synced=%d", len(store.snapshots), len(store.synced))
	}
	if portfolio.calls != 0 {
		t.Fatalf("portfolio calls = %d, want 0", portfolio.calls)
	}
}

func testBalanceSyncer(store *syncStore, adapter *recordingAdapter, portfolio wealth.PortfolioSyncer, now func() time.Time) *BalanceSyncer {
	return &BalanceSyncer{
		adapters: []wealth.SyncAdapter{adapter}, persister: &wealth.SnapshotPersister{Wealth: store}, assets: store,
		portfolioSync: portfolio, log: testutil.Logger, now: now, trackingDisabled: trackingEnabled,
	}
}

type recordingAdapter struct {
	provider   accounts.SourceTable
	due        bool
	connection bool
	advanced   bool
	conn       wealth.ConnectionRef
	err        error
}

func (a *recordingAdapter) Handles(_ context.Context, conn wealth.ConnectionRef) (bool, error) {
	return a.provider == "" || a.provider == conn.SourceTable, nil
}

func (a *recordingAdapter) Source() syncerids.ID {
	return syncerids.ID("test")
}

func (a *recordingAdapter) SyncDue(ctx context.Context, sink wealth.PersistSink) error {
	a.due = true
	if a.err != nil {
		return a.err
	}
	return a.emit(ctx, sink)
}

func (a *recordingAdapter) SyncConnectionInto(
	ctx context.Context,
	conn wealth.ConnectionRef,
	sink wealth.PersistSink,
) error {
	a.connection = true
	a.conn = conn
	return a.emit(ctx, sink)
}

func (a *recordingAdapter) emit(ctx context.Context, sink wealth.PersistSink) error {
	events, result := sink.Open(ctx)
	draft := wealth.SnapshotDraft{
		AccountID:  1,
		Source:     "test",
		Date:       sink.Today(),
		SyncedAt:   sink.Now().Format(time.RFC3339),
		BalanceUSD: 12,
		Decision:   wealth.DecisionClean,
	}
	events <- wealth.PersistEvent{Snapshot: &draft}
	close(events)
	if err := <-result; err != nil {
		return err
	}
	a.advanced = true
	return nil
}

type recordingPortfolio struct{ calls int }

func (p *recordingPortfolio) SyncAll(context.Context) error {
	p.calls++
	return nil
}

type syncStore struct {
	assets    map[int64]*model.Asset
	snapshots []wealth.AccountBalanceSnapshot
	synced    []int64
	swept     int
}

func (s *syncStore) SweepUnreferencedAssets(context.Context) (int64, error) {
	s.swept++
	return 0, nil
}

func (s *syncStore) PersistSnapshot(ctx context.Context, persist wealth.SnapshotPersist) error {
	if err := s.ReplaceAccountBalanceSnapshot(ctx, persist.Snapshot); err != nil {
		return err
	}
	return s.MarkAccountBalanceSynced(ctx, persist.Snapshot.AccountID, persist.SyncedAt)
}

func (s *syncStore) PersistAssetUpdate(ctx context.Context, update wealth.AssetUpdate) error {
	if err := s.UpdateAssetPrice(ctx, update.AssetID, update.Price, update.PriceAt); err != nil {
		return err
	}
	return nil
}

func (s *syncStore) ListInReviewBalanceReviews(context.Context) ([]wealth.BalanceReview, error) {
	return nil, nil
}
func (s *syncStore) GetBalanceReviewByID(context.Context, int64) (*wealth.BalanceReview, error) {
	return nil, nil
}
func (s *syncStore) GetApprovedBalanceReviewByAccount(context.Context, int64) (*wealth.ApprovedBalanceReview, error) {
	return nil, nil
}
func (s *syncStore) UpsertBalanceReview(context.Context, wealth.BalanceReviewUpsert) error {
	return nil
}
func (s *syncStore) ApproveBalanceReview(context.Context, int64) error     { return nil }
func (s *syncStore) UseProviderBalanceReview(context.Context, int64) error { return nil }
func (s *syncStore) AssetByID(_ context.Context, id int64) (*model.Asset, error) {
	return s.assets[id], nil
}
func (s *syncStore) AccountByID(context.Context, int64) (*model.Account, error) {
	return nil, nil
}
func (s *syncStore) LatestUnflaggedSnapshotWithHoldings(context.Context, int64, string) (wealth.LastUnflaggedSnapshotResult, error) {
	return wealth.LastUnflaggedSnapshotResult{}, nil
}
func (s *syncStore) ReplaceAccountBalanceSnapshot(_ context.Context, snapshot wealth.AccountBalanceSnapshot) error {
	s.snapshots = append(s.snapshots, snapshot)
	return nil
}
func (s *syncStore) MarkAccountBalanceSynced(_ context.Context, accountID int64, _ time.Time) error {
	s.synced = append(s.synced, accountID)
	return nil
}
func (s *syncStore) UpdateAssetPrice(context.Context, int64, float64, time.Time) error { return nil }
func (s *syncStore) UpsertAsset(_ context.Context, asset wealth.AssetUpsert) (*model.Asset, error) {
	assetID := int64(len(s.assets) + 1)
	created := &model.Asset{ID: model.New(model.GlobalIDAsset, assetID), Identifier: asset.Identifier}
	s.assets[assetID] = created
	return created, nil
}
