package wealth

import (
	"context"
	"log/slog"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/wealth/syncerids"
)

type SyncAdapter interface {
	Source() syncerids.ID
	Handles(ctx context.Context, conn ConnectionRef) (bool, error)
	SyncDue(ctx context.Context, sink PersistSink) error
	SyncConnectionInto(ctx context.Context, conn ConnectionRef, sink PersistSink) error
}

const SourceTableAssets = accounts.SourceTableAsset

type ConnectionRef struct {
	ConnectionID int64
	SourceTable  accounts.SourceTable
	SourceID     int64
}

type PersistSink interface {
	Open(ctx context.Context) (events chan<- PersistEvent, result <-chan error)
	Today() string
	Now() time.Time
}

type PersistEvent struct {
	Snapshot *SnapshotDraft
	Asset    *AssetUpdate
}

type SnapshotDecision int

const (
	DecisionClean SnapshotDecision = iota
	DecisionFlagged
	DecisionApprovedCarryForward
)

type SnapshotDraft struct {
	AccountBalanceSnapshot

	Decision      SnapshotDecision
	Anchor        LastUnflaggedBalanceResult
	Review        *BalanceReviewUpsert
	ProviderState *SnapshotProviderState
	CarryUSD      money.Cents
}

type SnapshotPersist struct {
	Snapshot      AccountBalanceSnapshot
	SyncedAt      time.Time
	ExpireReview  bool
	Recovery      *SnapshotRecovery
	Review        *BalanceReviewUpsert
	ProviderState *SnapshotProviderState
}

type SnapshotProviderState struct {
	ProviderBalanceUSD   money.Cents
	ProviderHoldingsJSON string
}

type SnapshotRecovery struct {
	AccountID  int64
	AfterDate  string
	BeforeDate string
}

type AssetUpdate struct {
	AssetID            int64
	Price              float64
	PriceAt            time.Time
	TrackingMultiplier *float64
}

type BaseAdapter struct {
	Reads AdapterReadStore
	Log   *slog.Logger
}

type AdapterReadStore interface {
	AssetByID(ctx context.Context, id int64) (*model.Asset, error)
	AccountByID(ctx context.Context, id int64) (*model.Account, error)
	AccountByExternalID(ctx context.Context, externalID string) (int64, model.AccountType, error)
	LatestUnflaggedSnapshotWithHoldings(ctx context.Context, accountID int64, date string) (LastUnflaggedSnapshotResult, error)
	GetApprovedBalanceReviewByAccount(ctx context.Context, accountID int64) (*ApprovedBalanceReview, error)
}
