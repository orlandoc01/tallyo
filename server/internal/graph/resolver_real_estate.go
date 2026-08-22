package graph

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"tallyo/internal/apierror"
	"tallyo/internal/graph/model"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/realestate"

	"github.com/samber/lo"
)

func (r *Resolver) LinkRealEstate(ctx context.Context, input model.LinkRealEstateInput) (*model.LinkRealEstatePayload, error) {
	if input.ManualValuationUsd <= 0 {
		return nil, apierror.Publicf("manualValuationUSD must be positive")
	}
	label := strings.TrimSpace(lo.FromPtr(input.Label))
	ownerID, err := input.OwnerID.Int64OfType(model.GlobalIDOwner)
	if err != nil {
		return nil, err
	}
	connection, account, err := r.RealEstate.Link(ctx, realestate.LinkInput{
		OwnerID:            ownerID,
		Label:              label,
		Details:            realEstateDetails(input.Street, input.City, input.State, input.Zip, input.HomeType),
		ManualValuationUSD: input.ManualValuationUsd,
	})
	if err != nil {
		return nil, fmt.Errorf("link real estate: %w", err)
	}
	return &model.LinkRealEstatePayload{
		Connection:   connection,
		Account:      account,
		ValuationUsd: input.ManualValuationUsd,
	}, nil
}

func (r *Resolver) UpdateRealEstate(ctx context.Context, input model.UpdateRealEstateInput) (*model.UpdateRealEstatePayload, error) {
	if input.ValuationUsd != nil && *input.ValuationUsd <= 0 {
		return nil, apierror.Publicf("valuationUSD must be positive")
	}
	connectionID, err := input.ConnectionID.Int64OfType(model.GlobalIDConnection)
	if err != nil {
		return nil, err
	}
	accountID, err := r.RealEstate.Update(ctx, realestate.UpdateInput{
		ConnectionID: connectionID,
		Name:         input.Name,
		Details:      realEstateDetails(input.Street, input.City, input.State, input.Zip, input.HomeType),
		ValuationUSD: input.ValuationUsd,
	})
	if err != nil {
		if errors.Is(err, wealth.ErrRealEstateNotFound) {
			return nil, apierror.Publicf("real estate not found for connection %d", connectionID)
		}
		return nil, fmt.Errorf("update real estate: %w", err)
	}
	account, err := r.AccountsStore.AccountByID(ctx, accountID)
	if err != nil {
		return nil, fmt.Errorf("lookup account for real estate connection %d: %w", connectionID, err)
	}
	if account == nil {
		return nil, apierror.Publicf("account not found for real estate connection %d", connectionID)
	}
	return &model.UpdateRealEstatePayload{Account: account}, nil
}

func (r *Resolver) UnlinkRealEstate(ctx context.Context, id model.GlobalID) (bool, error) {
	return unlinkConnection(ctx, id, func(ctx context.Context, connectionID int64) error {
		return r.WealthDB.DeleteRealEstate(ctx, connectionID)
	}, "unlink real estate")
}

func (r *Resolver) AccountWealthProperty(ctx context.Context, account *model.Account) (model.AccountWealthProperty, error) {
	if account.Type != model.AccountTypeProperty || account.Connection == nil {
		return nil, nil
	}

	connectionID := account.Connection.ID.Int64()
	conn, err := loadersFrom(ctx).Connection.Load(ctx, connectionID)()
	if err != nil {
		return nil, err
	}
	if conn == nil || conn.SourceTable != string(wealth.SourceTableAssets) {
		return nil, nil
	}

	asset, err := loadersFrom(ctx).Asset.Load(ctx, conn.SourceID)()
	if err != nil {
		return nil, err
	}
	if asset == nil || asset.AssetType != model.AssetTypeRealEstate || asset.Address == nil {
		return nil, nil
	}
	return &model.RealEstateAssetDetails{Address: asset.Address}, nil
}

func realEstateDetails(street, city, state, zip, homeType *string) wealth.RealEstateDetails {
	return wealth.RealEstateDetails{Street: street, City: city, State: state, Zip: zip, HomeType: homeType}
}
