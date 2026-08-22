package realestate

import (
	"context"
	"log/slog"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

type Store interface {
	ActiveRealEstate(ctx context.Context) ([]wealth.RealEstate, error)
	CreateRealEstate(ctx context.Context, in wealth.CreateRealEstateInput) (*wealth.CreateRealEstateResult, error)
	UpdateRealEstate(ctx context.Context, in wealth.UpdateRealEstateInput) (int64, error)
	LatestAccountBalanceSnapshotForAccount(ctx context.Context, accountID int64) (*wealth.SnapshotRow, error)
	RealEstateByConnectionID(ctx context.Context, connectionID int64) (*wealth.RealEstate, error)
	BalanceSyncScheduleDue(ctx context.Context, id syncerids.ID, now time.Time) (string, bool, error)
	SetBalanceSyncScheduleSynced(ctx context.Context, id syncerids.ID, nextBalanceSyncAt time.Time) error
}

type Service struct {
	Store Store
	Log   *slog.Logger
}

type LinkInput struct {
	OwnerID            int64
	Label              string
	Details            wealth.RealEstateDetails
	ManualValuationUSD money.Cents
}

type UpdateInput struct {
	ConnectionID int64
	Name         *string
	Details      wealth.RealEstateDetails
	ValuationUSD *money.Cents
}

func (s *Service) Link(ctx context.Context, input LinkInput) (*model.Connection, *model.Account, error) {
	valuation := s.valuation(input.ManualValuationUSD)
	result, err := s.Store.CreateRealEstate(ctx, wealth.CreateRealEstateInput{
		OwnerID:          input.OwnerID,
		Label:            input.Label,
		Details:          input.Details,
		InitialValuation: &valuation,
	})
	if err != nil {
		return nil, nil, err
	}
	return result.Connection, result.Account, nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (int64, error) {
	return s.Store.UpdateRealEstate(ctx, wealth.UpdateRealEstateInput{
		ConnectionID: input.ConnectionID,
		Name:         input.Name,
		Details:      input.Details,
		Valuation:    s.optionalValuation(input.ValuationUSD),
	})
}

func (s *Service) optionalValuation(valueUSD *money.Cents) *wealth.RealEstateValuation {
	if valueUSD == nil {
		return nil
	}
	valuation := s.valuation(*valueUSD)
	return &valuation
}

func (s *Service) valuation(valueUSD money.Cents) wealth.RealEstateValuation {
	now := time.Now().UTC()
	return wealth.RealEstateValuation{
		ValueUSD: valueUSD,
		Date:     now.Format("2006-01-02"),
		SyncedAt: now,
		Source:   s.Source(),
	}
}
