package wealth

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	u "tallyo/internal/utils"
	"tallyo/internal/wealth/syncerids"
)

// AssetUpsert describes an asset to create-or-update.
type AssetUpsert struct {
	AssetType          model.AssetType
	Identifier         string
	Name               *string
	Classifier         model.AssetClassifier
	UserEdited         bool
	UserCreated        bool
	ForcedUSDPrice     *float64
	TrackingTicker     *string
	TrackingMultiplier float64
	LastPrice          *float64
	LastPriceAt        *time.Time
	// AdapterSource is the provider-side stable ID an adapter tracks an asset by.
	AdapterSource *AdapterSource

	// SECURITY fields serialized into assets.additional.
	PlaidSecurityType      *string
	CUSIP                  *string
	ISIN                   *string
	SimpleFinCostBasis     *string
	SimpleFinPurchasePrice *string

	// CRYPTO fields serialized into assets.additional.
	LineType    *string
	ChainID     *string
	TokenID     *string
	TokenSymbol *string
	TokenName   *string
	ProjectName *string

	// REAL_ESTATE fields serialized into assets.additional.
	RealEstate *RealEstateDetails
}

// AdapterSource records one provider's stable ID for an asset.
type AdapterSource struct {
	Adapter  syncerids.ID
	SourceID string
}

func MarshalRawPayload(v any, what string) (*string, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("marshal %s: %w", what, err)
	}
	payload := string(raw)
	return &payload, nil
}

// CurrentHolding represents a valued holding at a point in time.
type CurrentHolding struct {
	Account      *model.Account
	Asset        *model.Asset
	Quantity     *float64
	ValueUSD     money.Cents
	Manual       bool
	SnapshotDate model.Date
}

// LiabilityAccountBalance is the latest USD balance for a liability account.
type LiabilityAccountBalance struct {
	Account    *model.Account
	BalanceUSD money.Cents
}

// AccountBalanceSnapshot is a daily snapshot of an account's holdings.
type AccountBalanceSnapshot struct {
	AccountID     int64
	WalletAddress string
	Source        string
	Date          string
	SyncedAt      string
	BalanceUSD    money.Cents
	RawPayload    *string
	Holdings      []AssetDailyHolding
	Flagged       bool
	FlagReason    string
}

// BalanceReview is a pending or approved review for anomalous account snapshots.
type BalanceReview struct {
	ID                     int64
	AccountID              int64
	Account                *model.Account
	Decision               string
	FirstFlaggedDate       string
	LatestFlaggedDate      string
	FlaggedSnapshotCount   int
	ProviderBalanceUSD     money.Cents
	CarryForwardBalanceUSD money.Cents
	FlagReason             *string
	CreatedAt              time.Time
	UpdatedAt              time.Time
}

// ApprovedBalanceReview is the small approved-review projection needed during sync.
type ApprovedBalanceReview struct {
	ProviderBalanceUSD money.Cents
}

// BalanceReviewUpsert describes a newly flagged snapshot chain update.
type BalanceReviewUpsert struct {
	AccountID              int64
	FirstFlaggedDate       string
	LatestFlaggedDate      string
	FlaggedSnapshotCount   int
	ProviderBalanceUSD     money.Cents
	CarryForwardBalanceUSD money.Cents
	FlagReason             string
}

// BalanceReviewProviderHolding is the JSON shape stored for provider restoration.
type BalanceReviewProviderHolding struct {
	AssetID           string       `json:"asset_id"`
	Asset             *AssetUpsert `json:"asset,omitempty"`
	PriceUpdate       *AssetUpdate `json:"price_update,omitempty"`
	Quantity          *float64     `json:"quantity,omitempty"`
	Price             *float64     `json:"price,omitempty"`
	ValueUSD          float64      `json:"value_usd"`
	CountsTowardValue bool         `json:"counts_toward_value"`
}

func MarshalBalanceReviewProviderHoldings(holdings []AssetDailyHolding) (*string, error) {
	toProviderHolding := func(holding AssetDailyHolding) BalanceReviewProviderHolding {
		return BalanceReviewProviderHolding{
			AssetID:           strconv.FormatInt(holding.AssetID, 10),
			Asset:             holding.Asset,
			PriceUpdate:       holding.PriceUpdate,
			Quantity:          holding.Quantity,
			Price:             holding.Price,
			ValueUSD:          holding.ValueUSD,
			CountsTowardValue: holding.CountsTowardValue,
		}
	}
	providerHoldings := u.Map(holdings, toProviderHolding)
	raw, err := json.Marshal(providerHoldings)
	if err != nil {
		return nil, err
	}
	value := string(raw)
	return &value, nil
}

func BalanceReviewProviderHoldingsFromJSON(raw *string) ([]BalanceReviewProviderHolding, error) {
	if raw == nil || *raw == "" {
		return []BalanceReviewProviderHolding{}, nil
	}
	var holdings []BalanceReviewProviderHolding
	if err := json.Unmarshal([]byte(*raw), &holdings); err != nil {
		return nil, err
	}
	if holdings == nil {
		holdings = []BalanceReviewProviderHolding{}
	}
	return holdings, nil
}

// LastUnflaggedBalanceResult is the balance anchor derived from the last clean snapshot.
type LastUnflaggedBalanceResult struct {
	Found     bool
	AmountUSD money.Cents
	Date      string
}

// LastUnflaggedSnapshotResult is the result of a LatestUnflaggedSnapshotWithHoldings lookup.
type LastUnflaggedSnapshotResult struct {
	Found     bool
	AmountUSD money.Cents
	Date      string
	Holdings  []AssetDailyHolding
}

// AssetDailyHolding is one holding line within an AccountBalanceSnapshot.
type AssetDailyHolding struct {
	AssetID           int64
	Asset             *AssetUpsert
	AdapterSource     *AdapterSource
	AdapterSources    []AdapterSource
	PriceUpdate       *AssetUpdate
	Quantity          *float64
	Price             *float64
	ValueUSD          float64
	CountsTowardValue bool
	Manual            bool

	// Transient EVM metadata used to upsert/enrich assets before persistence.
	LineType      string
	ChainID       string
	ProjectName   *string
	TokenID       string
	Identifier    string
	TokenSymbol   *string
	TokenName     *string
	ProviderPrice *float64
}

// SnapshotValue is one row in the net-worth series query.
type SnapshotValue struct {
	AccountID      int64
	AccountType    string
	AccountManual  bool
	AccountSubtype *string
	AccountClosed  bool
	SyncedAt       string
	BalanceUSD     money.Cents
}

// ClassifierSnapshotValue is one historical asset classifier value row.
type ClassifierSnapshotValue struct {
	AccountID     int64
	AccountClosed bool
	SyncedAt      string
	Classifier    model.AssetClassifier
	ValueUSD      money.Cents
}

// SnapshotTimestampRange is the available balance-snapshot time span.
type SnapshotTimestampRange struct {
	Earliest *time.Time
	Latest   *time.Time
}

// SnapshotRow is the account_balance_daily_snapshots projection used by the
// manual snapshot editor.
type SnapshotRow struct {
	ID          int64
	AccountID   int64
	Source      string
	Date        string
	SyncedAt    string
	BalanceUSD  money.Cents
	Flagged     bool
	AccountType model.AccountType
}

// SnapshotHolding is one stored historical holding row for a snapshot.
type SnapshotHolding struct {
	Asset             *model.Asset
	Quantity          *float64
	Price             *float64
	ValueUSD          money.Cents
	CountsTowardValue bool
	Manual            bool
}

// SnapshotEdit replaces one snapshot's balance and full holding set in place.
type SnapshotEdit struct {
	ID         int64
	AccountID  int64
	Date       string
	BalanceUSD money.Cents
	Holdings   []SnapshotEditHolding
}

// SnapshotEditHolding is the persistence shape for an edited holding line.
type SnapshotEditHolding struct {
	AssetID           int64
	Quantity          *float64
	Price             *float64
	ValueUSD          money.Cents
	CountsTowardValue bool
	Manual            bool
}
