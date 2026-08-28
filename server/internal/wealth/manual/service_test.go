package manual

import (
	"context"
	"errors"
	"testing"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	testutil "tallyo/internal/utils/test"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

var sourceManual = syncerids.Manual.Str()

type fakeManualStore struct {
	testutil.ScheduleFake
	accountIDs   []int64
	rows         map[int64]*wealth.SnapshotRow
	holdings     map[int64][]wealth.SnapshotHolding
	latestErrs   map[int64]error
	holdingErrs  map[int64]error
	snapshots    []wealth.AccountBalanceSnapshot
	synced       []int64
	nextSnapshot int64
}

func (s *fakeManualStore) ManualSnapshotAccountIDs(_ context.Context) ([]int64, error) {
	return s.accountIDs, nil
}

func (s *fakeManualStore) LatestAccountBalanceSnapshotForAccount(
	_ context.Context,
	accountID int64,
) (*wealth.SnapshotRow, error) {
	if err := s.latestErrs[accountID]; err != nil {
		return nil, err
	}
	return s.rows[accountID], nil
}

func (s *fakeManualStore) SnapshotHoldingsBySnapshotID(
	_ context.Context,
	snapshotID int64,
) ([]wealth.SnapshotHolding, error) {
	if err := s.holdingErrs[snapshotID]; err != nil {
		return nil, err
	}
	return s.holdings[snapshotID], nil
}

func (s *fakeManualStore) PersistSnapshot(_ context.Context, persist wealth.SnapshotPersist) error {
	snapshot := persist.Snapshot
	s.snapshots = append(s.snapshots, snapshot)
	s.nextSnapshot++
	s.rows[snapshot.AccountID] = &wealth.SnapshotRow{
		ID:         s.nextSnapshot,
		AccountID:  snapshot.AccountID,
		Source:     snapshot.Source,
		Date:       snapshot.Date,
		SyncedAt:   snapshot.SyncedAt,
		BalanceUSD: snapshot.BalanceUSD,
		Flagged:    snapshot.Flagged,
	}
	s.synced = append(s.synced, snapshot.AccountID)
	return nil
}

func (s *fakeManualStore) PersistAssetUpdate(context.Context, wealth.AssetUpdate) error {
	return nil
}

func TestManualSnapshotSyncDueSkipsNotDue(t *testing.T) {
	store := newFakeManualStore()
	store.accountIDs = []int64{1}
	svc := &Service{Store: store, Prices: testutil.LastKnownPriceProvider{}, Log: testutil.Logger}

	must.NoErr(t, svc.SyncDue(context.Background(), manualAdapterSink(store, fixedManualSnapshotNow())))
	if len(store.snapshots) != 0 || store.NextSync != nil {
		t.Fatalf("snapshots=%d nextSync=%v, want no work", len(store.snapshots), store.NextSync)
	}
}

func TestManualSnapshotSyncDueCarriesRepricesAndSchedules(t *testing.T) {
	currentPrice := 60.0
	storedPrice := 50.0
	quantity := 2.0
	store := newFakeManualStoreWithSnapshot(1, "2025-12-31", money.FromDollars(100))
	store.holdings[1] = []wealth.SnapshotHolding{{
		Asset: &model.Asset{
			ID:           model.New(model.GlobalIDAsset, 1),
			AssetType:    model.AssetTypeOther,
			CurrentPrice: &currentPrice,
		},
		Quantity:          &quantity,
		Price:             &storedPrice,
		ValueUSD:          money.FromDollars(100),
		CountsTowardValue: true,
		Manual:            true,
	}}
	svc := &Service{Store: store, Prices: testutil.LastKnownPriceProvider{}, Log: testutil.Logger}

	must.NoErr(t, svc.SyncDue(context.Background(), manualAdapterSink(store, fixedManualSnapshotNow())))
	if len(store.snapshots) != 1 {
		t.Fatalf("snapshots = %d, want 1", len(store.snapshots))
	}
	snapshot := store.snapshots[0]
	if snapshot.Source != sourceManual || snapshot.BalanceUSD != money.FromDollars(120) || snapshot.Flagged {
		t.Fatalf("snapshot = %#v, want manual balance 120 unflagged", snapshot)
	}
	if len(snapshot.Holdings) != 1 || snapshot.Holdings[0].Price == nil || *snapshot.Holdings[0].Price != 60 || !snapshot.Holdings[0].Manual {
		t.Fatalf("holdings = %#v, want repriced manual holding", snapshot.Holdings)
	}
	assertManualNextSync(t, store.NextSync)
}

func TestManualSnapshotSyncDueRepricesTodaySnapshot(t *testing.T) {
	currentPrice := 60.0
	storedPrice := 50.0
	quantity := 2.0
	store := newFakeManualStoreWithSnapshot(1, "2026-01-01", money.FromDollars(100))
	store.holdings[1] = []wealth.SnapshotHolding{{
		Asset: &model.Asset{
			ID:           model.New(model.GlobalIDAsset, 1),
			AssetType:    model.AssetTypeOther,
			CurrentPrice: &currentPrice,
		},
		Quantity:          &quantity,
		Price:             &storedPrice,
		ValueUSD:          money.FromDollars(100),
		CountsTowardValue: true,
		Manual:            true,
	}}
	svc := &Service{Store: store, Prices: testutil.LastKnownPriceProvider{}, Log: testutil.Logger}

	must.NoErr(t, svc.SyncDue(context.Background(), manualAdapterSink(store, fixedManualSnapshotNow())))
	if len(store.snapshots) != 1 || store.snapshots[0].BalanceUSD != money.FromDollars(120) {
		t.Fatalf("snapshots = %#v, want repriced same-day snapshot", store.snapshots)
	}
	assertManualNextSync(t, store.NextSync)
}

func TestManualSnapshotSyncDueCarriesFlatBalance(t *testing.T) {
	store := newFakeManualStoreWithSnapshot(1, "2025-12-31", -500)
	svc := &Service{Store: store, Prices: testutil.LastKnownPriceProvider{}, Log: testutil.Logger}

	must.NoErr(t, svc.SyncDue(context.Background(), manualAdapterSink(store, fixedManualSnapshotNow())))
	if len(store.snapshots) != 1 || store.snapshots[0].BalanceUSD != -500 || len(store.snapshots[0].Holdings) != 0 {
		t.Fatalf("snapshots = %#v, want flat -500 snapshot", store.snapshots)
	}
}

func TestManualSnapshotSyncDueContinuesAfterSourceError(t *testing.T) {
	store := newFakeManualStoreWithSnapshot(3, "2025-12-31", 42)
	store.accountIDs = []int64{2, 3}
	store.latestErrs[2] = errors.New("latest failed")
	svc := &Service{Store: store, Prices: testutil.LastKnownPriceProvider{}, Log: testutil.Logger}

	must.NoErr(t, svc.SyncDue(context.Background(), manualAdapterSink(store, fixedManualSnapshotNow())))
	if len(store.snapshots) != 1 || store.snapshots[0].AccountID != 3 {
		t.Fatalf("snapshots = %#v, want good source only", store.snapshots)
	}
	assertManualNextSync(t, store.NextSync)
}

func TestManualSnapshotKeepsStoredValueWhenPriceUnresolvable(t *testing.T) {
	storedPrice := 7.0
	quantity := 3.0
	store := newFakeManualStoreWithSnapshot(1, "2025-12-31", money.FromDollars(21))
	store.holdings[1] = []wealth.SnapshotHolding{{
		Asset:             &model.Asset{ID: model.New(model.GlobalIDAsset, 1), AssetType: model.AssetTypeOther},
		Quantity:          &quantity,
		Price:             &storedPrice,
		ValueUSD:          money.FromDollars(21),
		CountsTowardValue: true,
		Manual:            true,
	}}
	svc := &Service{Store: store, Prices: testutil.LastKnownPriceProvider{}, Log: testutil.Logger}

	must.NoErr(t, svc.SyncDue(context.Background(), manualAdapterSink(store, fixedManualSnapshotNow())))
	holding := store.snapshots[0].Holdings[0]
	if holding.ValueUSD != 21 || holding.Price == nil || *holding.Price != 7 {
		t.Fatalf("holding = %#v, want stored price/value", holding)
	}
}

func TestManualSnapshotKeepsStoredValueWhenQuantityUnavailable(t *testing.T) {
	currentPrice := 60.0
	storedPrice := 50.0
	store := newFakeManualStoreWithSnapshot(1, "2025-12-31", money.FromDollars(100))
	store.holdings[1] = []wealth.SnapshotHolding{{
		Asset:             &model.Asset{ID: model.New(model.GlobalIDAsset, 1), AssetType: model.AssetTypeOther, CurrentPrice: &currentPrice},
		Price:             &storedPrice,
		ValueUSD:          money.FromDollars(100),
		CountsTowardValue: true,
		Manual:            true,
	}}
	svc := &Service{Store: store, Prices: testutil.LastKnownPriceProvider{}, Log: testutil.Logger}

	must.NoErr(t, svc.SyncDue(context.Background(), manualAdapterSink(store, fixedManualSnapshotNow())))
	if len(store.snapshots) != 1 {
		t.Fatalf("snapshots = %#v, want one", store.snapshots)
	}
	snapshot := store.snapshots[0]
	holding := snapshot.Holdings[0]
	if snapshot.BalanceUSD != money.FromDollars(100) || holding.Quantity != nil || holding.Price == nil || *holding.Price != 60 || holding.ValueUSD != 100 {
		t.Fatalf("snapshot = %#v, want repriced metadata with unknown quantity and preserved value", snapshot)
	}
}

func TestManualSnapshotServiceSeedInitialSnapshot(t *testing.T) {
	store := newFakeManualStore()
	account := &model.Account{
		ID:   model.New(model.GlobalIDAccount, 1),
		Type: model.AccountTypeCredit,
	}
	svc := &Service{Store: store, Prices: testutil.LastKnownPriceProvider{}, Log: testutil.Logger}
	must.NoErr(t, svc.SeedInitialSnapshot(context.Background(), account))
	if len(store.snapshots) != 1 || store.snapshots[0].Source != sourceManual || store.snapshots[0].BalanceUSD != 0 || store.snapshots[0].Flagged {
		t.Fatalf("snapshots = %#v, want unflagged zero liability seed", store.snapshots)
	}
}

func TestManualSnapshotSyncConnectionNoops(t *testing.T) {
	store := newFakeManualStore()
	svc := &Service{Store: store, Prices: testutil.LastKnownPriceProvider{}, Log: testutil.Logger}
	handled, err := svc.Handles(context.Background(), wealth.ConnectionRef{})
	must.NoErr(t, err)
	if handled {
		t.Fatal("manual adapter should not handle account-created events")
	}
	must.NoErr(t, svc.SyncConnectionInto(
		context.Background(),
		wealth.ConnectionRef{},
		manualAdapterSink(store, fixedManualSnapshotNow()),
	))
}

func TestResolvePriceWithLiveProvider(t *testing.T) {
	asset := &model.Asset{AssetType: model.AssetTypeSecurity, Identifier: "AAPL"}
	price := resolvePrice(context.Background(), asset, fakePositivePriceProvider{}, time.Now())
	if price != 99.0 {
		t.Errorf("resolvePrice(SECURITY, live) = %f, want 99.0", price)
	}
}

func TestResolvePriceWithZeroFromLiveProviderFallsBack(t *testing.T) {
	lastPrice := 50.0
	asset := &model.Asset{AssetType: model.AssetTypeSecurity, Identifier: "AAPL", CurrentPrice: &lastPrice}
	price := resolvePrice(context.Background(), asset, fakeZeroPriceProvider{}, time.Now())
	if price != 50.0 {
		t.Errorf("resolvePrice(SECURITY, zero provider) = %f, want 50.0", price)
	}
}

func newFakeManualStore() *fakeManualStore {
	return &fakeManualStore{
		ID:           syncerids.Manual,
		rows:         map[int64]*wealth.SnapshotRow{},
		holdings:     map[int64][]wealth.SnapshotHolding{},
		latestErrs:   map[int64]error{},
		holdingErrs:  map[int64]error{},
		nextSnapshot: 100,
	}
}

func newFakeManualStoreWithSnapshot(accountID int64, date string, balance money.Cents) *fakeManualStore {
	store := newFakeManualStore()
	store.Due = true
	store.accountIDs = []int64{accountID}
	store.rows[accountID] = &wealth.SnapshotRow{
		ID:         1,
		AccountID:  accountID,
		Source:     sourceManual,
		Date:       date,
		BalanceUSD: balance,
	}
	return store
}

func fixedManualSnapshotNow() time.Time {
	return time.Date(2026, 1, 1, 20, 0, 0, 0, time.UTC)
}

func manualAdapterSink(store *fakeManualStore, now time.Time) wealth.PersistSink {
	return (&wealth.SnapshotPersister{Wealth: store}).WithRun(wealth.UTCDate(now), now)
}

func assertManualNextSync(tb testing.TB, got *time.Time) {
	tb.Helper()
	expected := time.Date(2026, 1, 1, 21, 30, 0, 0, time.UTC)
	if got == nil || !got.Equal(expected) {
		tb.Fatalf("next sync = %v, want %v", got, expected)
	}
}

type fakePositivePriceProvider struct{}

func (fakePositivePriceProvider) PriceAt(_ context.Context, _ *model.Asset, _ time.Time) (float64, error) {
	return 99.0, nil
}

type fakeZeroPriceProvider struct{}

func (fakeZeroPriceProvider) PriceAt(_ context.Context, _ *model.Asset, _ time.Time) (float64, error) {
	return 0, nil
}
