package wealthdb

import (
	"context"
	"database/sql"
	"fmt"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"
	"tallyo/internal/wealth"
)

// CreateRealEstate links a home and its initial valuation in one transaction.
func (s *Store) CreateRealEstate(ctx context.Context, in wealth.CreateRealEstateInput) (*wealth.CreateRealEstateResult, error) {
	owner, err := s.OwnerByID(ctx, in.OwnerID)
	if err != nil {
		return nil, fmt.Errorf("lookup owner: %w", err)
	}
	if owner == nil {
		return nil, fmt.Errorf("unknown owner id %d", in.OwnerID)
	}

	name := in.Label
	if name == "" {
		name = defaultRealEstateName(in.Details)
	}
	externalID, err := dbutil.RandomID()
	if err != nil {
		return nil, err
	}

	additional, err := marshalAdditional(realEstateAdditional(in.Details))
	if err != nil {
		return nil, err
	}
	var result *wealth.CreateRealEstateResult
	if err := s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		assetID, err := q.InsertRealEstateAsset(ctx, dbgen.InsertRealEstateAssetParams{
			Identifier: externalID,
			Name:       &name,
			Additional: additional,
		})
		if err != nil {
			return fmt.Errorf("insert real estate asset: %w", err)
		}
		connID, err := q.UpsertConnection(ctx, dbgen.UpsertConnectionParams{
			SourceTable: string(wealth.SourceTableAssets),
			SourceID:    assetID,
			Name:        &name,
			OwnerID:     in.OwnerID,
		})
		if err != nil {
			return fmt.Errorf("insert connection: %w", err)
		}
		accountID, err := q.InsertLinkedAccount(ctx, dbgen.InsertLinkedAccountParams{
			ExternalID:   externalID,
			ConnectionID: &connID,
			OwnerID:      in.OwnerID,
			Name:         name,
			Type:         string(model.AccountTypeProperty),
		})
		if err != nil {
			return fmt.Errorf("insert real estate account: %w", err)
		}
		home := wealth.RealEstate{
			AssetID:      assetID,
			AccountID:    accountID,
			ConnectionID: connID,
			OwnerID:      in.OwnerID,
			Name:         name,
			Details:      in.Details,
		}
		if in.InitialValuation != nil {
			if err := s.persistSnapshot(ctx, q, in.InitialValuation.Persist(home)); err != nil {
				return fmt.Errorf("persist real estate valuation: %w", err)
			}
		}
		conn := &model.Connection{
			ID:          model.New(model.GlobalIDConnection, connID),
			Name:        &name,
			Owner:       owner,
			IsActive:    true,
			SourceTable: string(wealth.SourceTableAssets),
			SourceID:    assetID,
		}
		account := &model.Account{
			ID:         model.New(model.GlobalIDAccount, accountID),
			Connection: conn,
			Owner:      owner,
			Name:       name,
			Type:       model.AccountTypeProperty,
			Manual:     false,
		}
		result = &wealth.CreateRealEstateResult{Connection: conn, Account: account}
		return nil
	}); err != nil {
		return nil, err
	}

	return result, nil
}

// UpdateRealEstate updates details and an optional valuation in one transaction.
func (s *Store) UpdateRealEstate(ctx context.Context, in wealth.UpdateRealEstateInput) (int64, error) {
	var accountID int64
	if err := s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		re, err := realEstateByConnectionID(ctx, q, in.ConnectionID)
		if err != nil {
			return fmt.Errorf("lookup real estate: %w", err)
		}
		if re == nil {
			return fmt.Errorf("%w for connection %d", wealth.ErrRealEstateNotFound, in.ConnectionID)
		}
		if err := updateRealEstateDetails(ctx, q, *re, in.Name, in.Details); err != nil {
			return err
		}
		if in.Valuation != nil {
			if err := s.persistSnapshot(ctx, q, in.Valuation.Persist(*re)); err != nil {
				return fmt.Errorf("persist real estate valuation: %w", err)
			}
		}
		accountID = re.AccountID
		return nil
	}); err != nil {
		return 0, err
	}
	return accountID, nil
}

func updateRealEstateDetails(
	ctx context.Context,
	q *dbgen.Queries,
	re wealth.RealEstate,
	name *string,
	details wealth.RealEstateDetails,
) error {
	incoming, err := marshalAdditional(realEstateAdditional(details))
	if err != nil {
		return err
	}
	if name != nil {
		if err := q.UpdateAssetBase(ctx, dbgen.UpdateAssetBaseParams{Name: name, ID: re.AssetID}); err != nil {
			return fmt.Errorf("update asset name: %w", err)
		}
		if _, err := q.UpdateAccountFields(ctx, dbgen.UpdateAccountFieldsParams{SetName: true, Name: *name, ID: re.AccountID}); err != nil {
			return fmt.Errorf("update account name: %w", err)
		}
		if _, err := q.UpsertConnection(ctx, dbgen.UpsertConnectionParams{
			SourceTable: string(wealth.SourceTableAssets),
			SourceID:    re.AssetID,
			Name:        name,
			OwnerID:     re.OwnerID,
		}); err != nil {
			return fmt.Errorf("update connection name: %w", err)
		}
	}
	if incoming == nil {
		return nil
	}
	existing, err := assetAdditionalByID(ctx, q, re.AssetID)
	if err != nil {
		return fmt.Errorf("read real estate additional: %w", err)
	}
	merged, err := mergeAdditional(model.AssetTypeRealEstate, existing, incoming)
	if err != nil {
		return err
	}
	if err := q.UpdateAssetAdditional(ctx, dbgen.UpdateAssetAdditionalParams{Additional: merged, ID: re.AssetID}); err != nil {
		return fmt.Errorf("update real estate additional: %w", err)
	}
	return nil
}

// RealEstateByConnectionID returns the linked home for a given connection ID.
func (s *Store) RealEstateByConnectionID(ctx context.Context, connectionID int64) (*wealth.RealEstate, error) {
	return realEstateByConnectionID(ctx, s.q, connectionID)
}

func realEstateByConnectionID(ctx context.Context, q *dbgen.Queries, connectionID int64) (*wealth.RealEstate, error) {
	rows, err := q.ActiveRealEstate(ctx, dbgen.ActiveRealEstateParams{ConnectionID: &connectionID})
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	re, err := realEstateFromSQLRow(rows[0])
	if err != nil {
		return nil, err
	}
	return &re, nil
}

// ActiveRealEstate returns all linked homes with an open account, used for
// periodic valuation sync. Homes on closed accounts are excluded because the
// shared snapshot sink rejects writes for them.
func (s *Store) ActiveRealEstate(ctx context.Context) ([]wealth.RealEstate, error) {
	rows, err := s.q.ActiveRealEstate(ctx, dbgen.ActiveRealEstateParams{OpenOnly: true})
	if err != nil {
		return nil, fmt.Errorf("list real estate: %w", err)
	}
	return u.MapErr(rows, realEstateFromSQLRow)
}

// DeleteRealEstate removes the account, snapshots, connection, and the
// REAL_ESTATE asset for a connection, in one transaction.
func (s *Store) DeleteRealEstate(ctx context.Context, connectionID int64) error {
	return s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		re, err := realEstateByConnectionID(ctx, q, connectionID)
		if err != nil {
			return err
		}
		if re == nil {
			return fmt.Errorf("real estate for connection %d not found", connectionID)
		}
		if err := q.DeleteAccountsByConnection(ctx, dbgen.DeleteAccountsByConnectionParams{ConnectionID: &connectionID}); err != nil {
			return fmt.Errorf("delete real estate accounts: %w", err)
		}
		if err := q.DeleteConnectionByID(ctx, dbgen.DeleteConnectionByIDParams{ID: connectionID}); err != nil {
			return fmt.Errorf("delete real estate connection: %w", err)
		}
		if err := q.DeleteAssetByID(ctx, dbgen.DeleteAssetByIDParams{ID: re.AssetID}); err != nil {
			return fmt.Errorf("delete real estate asset: %w", err)
		}
		return nil
	})
}

func realEstateFromSQLRow(row dbgen.ActiveRealEstateRow) (wealth.RealEstate, error) {
	var details RealEstateAdditional
	if err := unmarshalAdditional(row.Additional, &details); err != nil {
		return wealth.RealEstate{}, err
	}
	return wealth.RealEstate{
		AssetID:      row.AssetID,
		AccountID:    row.AccountID,
		ConnectionID: row.ConnectionID,
		OwnerID:      row.OwnerID,
		Name:         row.Name,
		Details: wealth.RealEstateDetails{
			Street:   details.Street,
			City:     details.City,
			State:    details.State,
			Zip:      details.Zip,
			HomeType: details.HomeType,
		},
	}, nil
}

func defaultRealEstateName(re wealth.RealEstateDetails) string {
	if re.Street != nil && *re.Street != "" {
		return *re.Street
	}
	return "Home"
}
