package realestate

import (
	"context"

	testutil "tallyo/internal/utils/test"
	"tallyo/internal/wealth"
)

// ── Fake store ────────────────────────────────────────────────────────────────

type fakeStore struct {
	testutil.ScheduleFake
	home         *wealth.RealEstate
	homes        []wealth.RealEstate
	latest       *wealth.SnapshotRow
	latestByAcct map[int64]*wealth.SnapshotRow
	latestErrs   map[int64]error
	snapshots    []wealth.AccountBalanceSnapshot
}

func (s *fakeStore) CreateRealEstate(context.Context, wealth.CreateRealEstateInput) (*wealth.CreateRealEstateResult, error) {
	panic("unused fake method")
}

func (s *fakeStore) UpdateRealEstate(context.Context, wealth.UpdateRealEstateInput) (int64, error) {
	panic("unused fake method")
}

func (s *fakeStore) RealEstateByConnectionID(ctx context.Context, connectionID int64) (*wealth.RealEstate, error) {
	return s.home, nil
}

func (s *fakeStore) ActiveRealEstate(ctx context.Context) ([]wealth.RealEstate, error) {
	if len(s.homes) > 0 {
		return s.homes, nil
	}
	if s.home != nil {
		return []wealth.RealEstate{*s.home}, nil
	}
	return []wealth.RealEstate{}, nil
}

func (s *fakeStore) PersistSnapshot(_ context.Context, persist wealth.SnapshotPersist) error {
	s.snapshots = append(s.snapshots, persist.Snapshot)
	return nil
}

func (s *fakeStore) PersistAssetUpdate(context.Context, wealth.AssetUpdate) error {
	return nil
}

func (s *fakeStore) LatestAccountBalanceSnapshotForAccount(
	ctx context.Context,
	accountID int64,
) (*wealth.SnapshotRow, error) {
	if err := s.latestErrs[accountID]; err != nil {
		return nil, err
	}
	if row := s.latestByAcct[accountID]; row != nil {
		return row, nil
	}
	return s.latest, nil
}
