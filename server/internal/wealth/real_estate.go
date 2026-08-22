package wealth

import (
	"errors"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/wealth/syncerids"
)

var ErrRealEstateNotFound = errors.New("real estate not found")

// RealEstateDetails captures the address fields stored in assets.additional.
type RealEstateDetails struct {
	Street   *string
	City     *string
	State    *string
	Zip      *string
	HomeType *string
}

// RealEstateValuation describes one manual value update for a linked home.
type RealEstateValuation struct {
	ValueUSD money.Cents
	Date     string
	SyncedAt time.Time
	Source   syncerids.ID
}

// CreateRealEstateInput describes a home to link: one asset + address + 1:1 account.
type CreateRealEstateInput struct {
	OwnerID          int64
	Label            string
	Details          RealEstateDetails
	InitialValuation *RealEstateValuation
}

// CreateRealEstateResult is the persisted home link and its public models.
type CreateRealEstateResult struct {
	Connection *model.Connection
	Account    *model.Account
}

// UpdateRealEstateInput updates linked-home metadata and optionally appends a valuation.
type UpdateRealEstateInput struct {
	ConnectionID int64
	Name         *string
	Details      RealEstateDetails
	Valuation    *RealEstateValuation
}

// RealEstate is a linked home: the REAL_ESTATE asset and its 1:1 envelope account.
type RealEstate struct {
	AssetID      int64
	AccountID    int64
	ConnectionID int64
	OwnerID      int64
	Name         string
	Details      RealEstateDetails
}

func NewRealEstateSnapshot(
	re RealEstate,
	valueUSD money.Cents,
	source string,
	date string,
	syncedAt time.Time,
) AccountBalanceSnapshot {
	quantity := 1.0
	dollars := valueUSD.Dollars()
	return AccountBalanceSnapshot{
		AccountID:  re.AccountID,
		Source:     source,
		Date:       date,
		SyncedAt:   syncedAt.Format(time.RFC3339),
		BalanceUSD: valueUSD,
		Holdings: []AssetDailyHolding{{
			AssetID:           re.AssetID,
			Quantity:          &quantity,
			Price:             &dollars,
			ValueUSD:          dollars,
			CountsTowardValue: true,
			Manual:            true,
		}},
	}
}

func (v RealEstateValuation) Persist(re RealEstate) SnapshotPersist {
	return SnapshotPersist{
		Snapshot: NewRealEstateSnapshot(
			re,
			v.ValueUSD,
			v.Source.Str(),
			v.Date,
			v.SyncedAt,
		),
		SyncedAt: v.SyncedAt,
	}
}
