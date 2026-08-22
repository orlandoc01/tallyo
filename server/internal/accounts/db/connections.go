package accountsdb

import (
	"context"
	"database/sql"
	"fmt"
	"slices"
	"strings"

	"tallyo/internal/accounts"
	"tallyo/internal/apierror"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
)

var validDeleteConnectionSourceTables = []accounts.SourceTable{
	accounts.SourceTablePlaidItem,
	accounts.SourceTableEVMWallet,
	accounts.SourceTableSimpleFinConnection,
}

func (s *Store) Connections(ctx context.Context, includeInactive bool) ([]*model.Connection, error) {
	rows, err := s.q.Connections(ctx, dbgen.ConnectionsParams{
		SupportedProvidersOnly: true,
		ActiveOnly:             !includeInactive,
	})
	return dbutil.MapRows(rows, err, connectionFromSQLRow)
}

func (s *Store) ConnectionByID(ctx context.Context, id int64) (*model.Connection, error) {
	connections, err := s.ConnectionsByIDs(ctx, []int64{id})
	return dbutil.MapSingle(connections, err, id)
}

func (s *Store) connectionBySource(ctx context.Context, sourceTable accounts.SourceTable, sourceID int64) (*model.Connection, error) {
	rows, err := s.q.Connections(ctx, dbgen.ConnectionsParams{
		SourceLookup: true,
		SourceTable:  string(sourceTable),
		SourceID:     sourceID,
	})
	return dbutil.MapFirstRow(rows, err, connectionFromSQLRow)
}

func (s *Store) ConnectionsByIDs(ctx context.Context, ids []int64) (map[int64]*model.Connection, error) {
	if len(ids) == 0 {
		return map[int64]*model.Connection{}, nil
	}
	rows, err := s.q.Connections(ctx, dbgen.ConnectionsParams{
		Ids: ids,
	})
	toConnectionByID := func(row dbgen.ConnectionsRow) (int64, *model.Connection) {
		return row.ID, connectionFromSQLRow(row)
	}
	return dbutil.AssociateRows(rows, err, toConnectionByID)
}

func (s *Store) ConnectionByPlaidItemID(ctx context.Context, plaidItemID int64) (*model.Connection, error) {
	return s.connectionBySource(ctx, accounts.SourceTablePlaidItem, plaidItemID)
}

func (s *Store) CreateConnection(ctx context.Context, plaidItemID int64, name *string, ownerID int64) (*model.Connection, error) {
	connectionID, err := s.q.UpsertConnection(ctx, dbgen.UpsertConnectionParams{
		SourceTable: string(accounts.SourceTablePlaidItem),
		SourceID:    plaidItemID,
		Name:        name,
		OwnerID:     ownerID,
	})
	if err != nil {
		return nil, fmt.Errorf("upsert connection: %w", err)
	}
	return s.ConnectionByID(ctx, connectionID)
}

func (s *Store) UpdateConnection(ctx context.Context, input accounts.UpdateConnectionInput) (*model.Connection, error) {
	conn, err := s.ConnectionByID(ctx, input.ConnectionID)
	if err != nil || conn == nil {
		return conn, err
	}
	sourceTable := accounts.SourceTable(conn.SourceTable)
	if (input.SyncCron != nil || input.RecurringSyncCron != nil) && sourceTable != accounts.SourceTablePlaidItem {
		return nil, apierror.Publicf("sync settings are only supported for Plaid connections")
	}
	if input.EVMChainIDs != nil && sourceTable != accounts.SourceTableEVMWallet {
		return nil, apierror.Publicf("chainIds are only supported for EVM wallet connections")
	}
	if input.EVMChainIDs != nil {
		if err := accounts.ValidateEVMChainIDs(input.EVMChainIDs); err != nil {
			return nil, err
		}
		input.EVMChainIDs = accounts.NormalizeEVMChainIDs(input.EVMChainIDs)
	}

	err = s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		if input.IsActive != nil {
			if err := q.UpdateConnectionActive(ctx, dbgen.UpdateConnectionActiveParams{IsActive: *input.IsActive, ID: input.ConnectionID}); err != nil {
				return fmt.Errorf("update connection active state: %w", err)
			}
		}
		if input.SyncCron != nil || input.RecurringSyncCron != nil {
			if err := updatePlaidConnectionSyncSettings(ctx, q, conn.SourceID, input); err != nil {
				return err
			}
		}
		if input.EVMChainIDs != nil {
			if err := q.UpdateEVMWalletChainIDs(ctx, dbgen.UpdateEVMWalletChainIDsParams{ChainIds: strings.Join(input.EVMChainIDs, ","), ConnectionID: input.ConnectionID}); err != nil {
				return fmt.Errorf("update evm wallet chain ids: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.ConnectionByID(ctx, input.ConnectionID)
}

func updatePlaidConnectionSyncSettings(ctx context.Context, q *dbgen.Queries, sourceID int64, input accounts.UpdateConnectionInput) error {
	if input.SyncCron == nil || input.RecurringSyncCron == nil || input.NextSyncAt == nil || input.NextRecurringSyncAt == nil {
		return fmt.Errorf("syncCron and recurringSyncCron are required together")
	}
	nextSyncAtUTC := input.NextSyncAt.UTC()
	nextRecurringSyncAtUTC := input.NextRecurringSyncAt.UTC()
	if err := q.UpdatePlaidConnectionSyncSettings(ctx, dbgen.UpdatePlaidConnectionSyncSettingsParams{SyncCron: *input.SyncCron, RecurringSyncCron: *input.RecurringSyncCron, NextSyncAt: &nextSyncAtUTC, NextRecurringSyncAt: &nextRecurringSyncAtUTC, ID: sourceID}); err != nil {
		return fmt.Errorf("update plaid sync settings: %w", err)
	}
	return nil
}

func (s *Store) DeleteConnection(ctx context.Context, connectionID int64) (bool, error) {
	conn, err := s.ConnectionByID(ctx, connectionID)
	if err != nil || conn == nil {
		return false, err
	}
	sourceTable := accounts.SourceTable(conn.SourceTable)
	if !slices.Contains(validDeleteConnectionSourceTables, sourceTable) {
		return false, apierror.Publicf("unsupported connection provider %q", conn.SourceTable)
	}

	err = s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		if err := q.DeleteAccountsByConnection(ctx, dbgen.DeleteAccountsByConnectionParams{ConnectionID: &connectionID}); err != nil {
			return fmt.Errorf("delete accounts: %w", err)
		}
		if sourceTable == accounts.SourceTablePlaidItem {
			if err := q.DeletePlaidItem(ctx, dbgen.DeletePlaidItemParams{ID: conn.SourceID}); err != nil {
				return fmt.Errorf("delete plaid item: %w", err)
			}
		} else if sourceTable == accounts.SourceTableSimpleFinConnection {
			if err := q.DeleteSimpleFinConnection(ctx, dbgen.DeleteSimpleFinConnectionParams{ID: conn.SourceID}); err != nil {
				return fmt.Errorf("delete simplefin connection: %w", err)
			}
		} else if err := q.DeleteEVMWallet(ctx, dbgen.DeleteEVMWalletParams{ID: conn.SourceID}); err != nil {
			return fmt.Errorf("delete evm wallet: %w", err)
		}
		if err := q.DeleteConnectionByID(ctx, dbgen.DeleteConnectionByIDParams{ID: connectionID}); err != nil {
			return fmt.Errorf("delete connection: %w", err)
		}
		return nil
	})
	if err != nil {
		return false, err
	}
	return true, nil
}

func connectionFromSQLRow(row dbgen.ConnectionsRow) *model.Connection {
	return &model.Connection{
		ID:          model.New(model.GlobalIDConnection, row.ID),
		Name:        row.Name,
		Owner:       &model.Owner{ID: model.New(model.GlobalIDOwner, row.OwnerID), Name: row.OwnerName},
		IsActive:    row.IsActive,
		SourceTable: row.SourceTable,
		SourceID:    row.SourceID,
	}
}
