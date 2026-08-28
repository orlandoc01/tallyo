package realestate

import (
	"context"
	"errors"
	"testing"
	"time"

	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	testutil "tallyo/internal/utils/test"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

func TestRealEstateSyncDueSkipsNotDue(t *testing.T) {
	store := newFakeRealEstateAdapterStore()
	store.home = &wealth.RealEstate{AssetID: 1, AccountID: 1}
	store.latest = &wealth.SnapshotRow{AccountID: 1, Date: "2025-12-31", BalanceUSD: 185200}
	svc := &Service{Store: store, Log: testutil.Logger}

	must.NoErr(t, svc.SyncDue(context.Background(), realEstateAdapterSink(store, fixedRealEstateSnapshotNow())))
	if len(store.snapshots) != 0 || store.NextSync != nil {
		t.Fatalf("snapshots=%d nextSync=%v, want no work", len(store.snapshots), store.NextSync)
	}
}

func TestRealEstateSyncDueWritesAndSchedules(t *testing.T) {
	tests := map[string]string{
		"carries latest snapshot": "2025-12-31",
		"rewrites today snapshot": "2026-01-01",
	}
	for name, latestDate := range tests {
		t.Run(name, func(t *testing.T) {
			store := newFakeRealEstateAdapterStore()
			store.Due = true
			store.home = &wealth.RealEstate{AssetID: 1, AccountID: 1}
			store.latest = &wealth.SnapshotRow{AccountID: 1, Date: latestDate, BalanceUSD: 185200}
			svc := &Service{Store: store, Log: testutil.Logger}

			must.NoErr(t, svc.SyncDue(context.Background(), realEstateAdapterSink(store, fixedRealEstateSnapshotNow())))
			assertRealEstateSnapshot(t, store.snapshots[0], 1, 1, 185200)
			assertRealEstateNextSync(t, store.NextSync)
		})
	}
}

func TestRealEstateSyncDueContinuesAfterSourceError(t *testing.T) {
	store := newFakeRealEstateAdapterStore()
	store.Due = true
	store.homes = []wealth.RealEstate{
		{AssetID: 2, AccountID: 2},
		{AssetID: 3, AccountID: 3},
	}
	store.latestErrs[2] = errors.New("latest failed")
	store.latestByAcct[3] = &wealth.SnapshotRow{AccountID: 3, Date: "2025-12-31", BalanceUSD: 250000}
	svc := &Service{Store: store, Log: testutil.Logger}

	must.NoErr(t, svc.SyncDue(context.Background(), realEstateAdapterSink(store, fixedRealEstateSnapshotNow())))
	if len(store.snapshots) != 1 {
		t.Fatalf("snapshots = %#v, want one successful home", store.snapshots)
	}
	assertRealEstateSnapshot(t, store.snapshots[0], 3, 3, 250000)
	assertRealEstateNextSync(t, store.NextSync)
}

func TestRealEstateSyncConnectionInto(t *testing.T) {
	store := newFakeRealEstateAdapterStore()
	store.home = &wealth.RealEstate{AssetID: 1, AccountID: 1, ConnectionID: 1}
	store.latest = &wealth.SnapshotRow{AccountID: 1, Date: "2025-12-31", BalanceUSD: 185200}
	svc := &Service{Store: store, Log: testutil.Logger}

	handled, err := svc.Handles(
		context.Background(),
		wealth.ConnectionRef{ConnectionID: 1, SourceTable: wealth.SourceTableAssets},
	)
	must.NoErr(t, err)
	if !handled {
		t.Fatal("real estate adapter should handle assets account events")
	}
	must.NoErr(t, svc.SyncConnectionInto(
		context.Background(),
		wealth.ConnectionRef{ConnectionID: 1},
		realEstateAdapterSink(store, fixedRealEstateSnapshotNow()),
	))
	assertRealEstateSnapshot(t, store.snapshots[0], 1, 1, 185200)
	if store.NextSync != nil {
		t.Fatalf("connection sync scheduled next sync = %v, want nil", store.NextSync)
	}
}

func newFakeRealEstateAdapterStore() *fakeStore {
	return &fakeStore{
		ID:           syncerids.RealEstate,
		latestByAcct: map[int64]*wealth.SnapshotRow{},
		latestErrs:   map[int64]error{},
	}
}

func realEstateAdapterSink(store *fakeStore, now time.Time) wealth.PersistSink {
	return (&wealth.SnapshotPersister{Wealth: store}).WithRun(wealth.UTCDate(now), now)
}

func fixedRealEstateSnapshotNow() time.Time {
	return time.Date(2026, 1, 1, 20, 0, 0, 0, time.UTC)
}

func assertRealEstateSnapshot(
	tb testing.TB,
	snapshot wealth.AccountBalanceSnapshot,
	accountID int64,
	assetID int64,
	valueUSD money.Cents,
) {
	tb.Helper()
	if snapshot.AccountID != accountID || snapshot.Source != "realestate" || snapshot.Date != "2026-01-01" {
		tb.Fatalf("snapshot = %+v, want %d realestate 2026-01-01", snapshot, accountID)
	}
	if snapshot.BalanceUSD != valueUSD {
		tb.Fatalf("BalanceUSD = %d, want %d", snapshot.BalanceUSD, valueUSD)
	}
	if len(snapshot.Holdings) != 1 || snapshot.Holdings[0].AssetID != assetID {
		tb.Fatalf("Holdings = %+v, want %d", snapshot.Holdings, assetID)
	}
	if snapshot.Holdings[0].Price == nil || *snapshot.Holdings[0].Price != valueUSD.Dollars() || !snapshot.Holdings[0].Manual {
		tb.Fatalf("Holdings = %+v, want manual holding at value", snapshot.Holdings)
	}
}

func assertRealEstateNextSync(tb testing.TB, got *time.Time) {
	tb.Helper()
	expected := time.Date(2026, 1, 1, 21, 30, 0, 0, time.UTC)
	if got == nil || !got.Equal(expected) {
		tb.Fatalf("next sync = %v, want %v", got, expected)
	}
}
