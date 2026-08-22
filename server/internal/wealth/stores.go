package wealth

import (
	"context"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/wealth/syncerids"
)

type ServiceStore interface {
	SnapshotEditStore

	LatestLiabilityAccountBalances(ctx context.Context, filter AccountFilter) ([]LiabilityAccountBalance, error)
	AccountBalanceSnapshotTimestampRange(ctx context.Context, filter AccountFilter) (SnapshotTimestampRange, error)
	AccountLastBalanceSyncedAtForAccounts(ctx context.Context, accountIDs []int64) (map[int64]time.Time, error)
	CurrentHoldings(ctx context.Context, filter AccountFilter) ([]CurrentHolding, error)
	AccountBalanceSnapshotValues(ctx context.Context, startTime, endTime string, filter AccountFilter) ([]SnapshotValue, error)
	ClassifierSnapshotValues(ctx context.Context, startTime, endTime string, filter AccountFilter) ([]ClassifierSnapshotValue, error)
	AllAssets(ctx context.Context, input model.AssetsInput) ([]*model.Asset, error)
	AssetByKey(ctx context.Context, assetType model.AssetType, identifier string) (*model.Asset, error)
	AssetsByIDs(ctx context.Context, ids []int64) (map[int64]*model.Asset, error)
	UpsertAsset(ctx context.Context, asset AssetUpsert) (*model.Asset, error)
	UpdateAsset(ctx context.Context, input model.UpdateAssetInput) (*model.Asset, error)
	MergeAssetBySource(ctx context.Context, adapter syncerids.ID, sourceID string, targetAssetID int64) (*model.Asset, error)
	RevalueLatestAssetHoldings(ctx context.Context, assetID int64, price float64) error
	UpdateAssetPrice(ctx context.Context, assetID int64, price float64, priceAt time.Time) error
}

type SnapshotEditStore interface {
	AccountByID(ctx context.Context, id int64) (*model.Account, error)
	AssetByID(ctx context.Context, id int64) (*model.Asset, error)
	GetAccountBalanceSnapshotByID(ctx context.Context, id int64) (*SnapshotRow, error)
	LatestAccountBalanceSnapshotInWindow(ctx context.Context, accountID int64, startTime, endTime string) (*SnapshotRow, error)
	LatestAccountBalanceSnapshotForAccount(ctx context.Context, accountID int64) (*SnapshotRow, error)
	LatestAccountBalanceSnapshotsForAccounts(ctx context.Context, accountIDs []int64) (map[int64]*SnapshotRow, error)
	NewerAccountBalanceSnapshotsForAccount(ctx context.Context, accountID int64, date string) ([]*SnapshotRow, error)
	AccountBalanceSnapshotsPage(ctx context.Context, accountID int64, afterDate *string, limit int64) ([]*SnapshotRow, error)
	AccountBalanceSnapshotDayCount(ctx context.Context, accountID int64) (int, error)
	SnapshotHoldingsBySnapshotID(ctx context.Context, snapshotID int64) ([]SnapshotHolding, error)
	SnapshotHoldingsBySnapshotIDs(ctx context.Context, snapshotIDs []int64) (map[int64][]SnapshotHolding, error)
	UpdateAccountSnapshots(ctx context.Context, edits []SnapshotEdit) error
}

type AccountFilter struct {
	OwnerIDs           []int64
	AccountIDs         []int64
	AssetIDs           []int64
	ExcludeLiabilities bool
}

type AssetPriceStore interface {
	UpdateAssetPrice(ctx context.Context, assetID int64, price float64, priceAt time.Time) error
	UpdateAssetPriceConnectivity(ctx context.Context, assetID int64, status model.ConnectivityStatus) error
}

type BalanceReviewStore interface {
	ListInReviewBalanceReviews(ctx context.Context) ([]BalanceReview, error)
	GetBalanceReviewByID(ctx context.Context, id int64) (*BalanceReview, error)
	GetApprovedBalanceReviewByAccount(ctx context.Context, accountID int64) (*ApprovedBalanceReview, error)
	ApproveBalanceReview(ctx context.Context, id int64) error
	UseProviderBalanceReview(ctx context.Context, id int64) error
}
