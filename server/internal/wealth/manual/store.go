package manual

import (
	"context"
	"time"

	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

// Store is the persistence surface needed by manual account snapshots.
type Store interface {
	ManualSnapshotAccountIDs(ctx context.Context) ([]int64, error)
	LatestAccountBalanceSnapshotForAccount(ctx context.Context, accountID int64) (*wealth.SnapshotRow, error)
	SnapshotHoldingsBySnapshotID(ctx context.Context, snapshotID int64) ([]wealth.SnapshotHolding, error)
	PersistSnapshot(ctx context.Context, snapshot wealth.SnapshotPersist) error
	BalanceSyncScheduleDue(ctx context.Context, id syncerids.ID, now time.Time) (string, bool, error)
	BalanceSyncScheduleCron(ctx context.Context, id syncerids.ID) (string, error)
	SetBalanceSyncScheduleSynced(ctx context.Context, id syncerids.ID, nextBalanceSyncAt time.Time) error
}
