package accountsdb

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/samber/lo"
	"tallyo/internal/accounts"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"
)

// LinkSimpleFinConnection upserts the simplefin_connections row and its
// polymorphic connections row in one transaction, returning both IDs so
// callers (initial linking and every sync pass) never need to reread either.
func (s *Store) LinkSimpleFinConnection(ctx context.Context, conn accounts.UpsertSimpleFinConnectionParams) (simpleFinConnID int64, connectionID int64, err error) {
	err = s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		id, err := q.UpsertSimpleFinConnection(ctx, dbgen.UpsertSimpleFinConnectionParams{
			ExternalID:    conn.ExternalID,
			AccessTokenID: conn.AccessTokenID,
			OrgID:         conn.OrgID,
			OrgDomain:     conn.OrgDomain,
			OrgUrl:        conn.OrgURL,
			SfinUrl:       conn.SfinURL,
			LogoUrl:       conn.LogoURL,
		})
		if err != nil {
			return err
		}
		simpleFinConnID = id
		connectionID, err = createSimpleFinConnectionRow(ctx, q, id, conn.Name, conn.OwnerID)
		return err
	})
	return simpleFinConnID, connectionID, err
}

func createSimpleFinConnectionRow(ctx context.Context, q *dbgen.Queries, connID int64, name string, ownerID int64) (int64, error) {
	id, err := q.UpsertConnection(ctx, dbgen.UpsertConnectionParams{
		SourceTable: string(accounts.SourceTableSimpleFinConnection),
		SourceID:    connID,
		Name:        lo.EmptyableToPtr(name),
		OwnerID:     ownerID,
	})
	if err != nil {
		return 0, fmt.Errorf("upsert simplefin connection row: %w", err)
	}
	return id, nil
}

// SimpleFinConnectionsByTokenIDs hydrates every token's connections (with
// their accounts) in a fixed two reads regardless of token count.
func (s *Store) SimpleFinConnectionsByTokenIDs(ctx context.Context, accessTokenIDs []int64) (map[int64][]*model.SimpleFinConnection, error) {
	toEmptyConnections := func(id int64) (int64, []*model.SimpleFinConnection) {
		return id, []*model.SimpleFinConnection{}
	}
	byToken := lo.SliceToMap(accessTokenIDs, toEmptyConnections)
	if len(accessTokenIDs) == 0 {
		return byToken, nil
	}
	rows, err := s.q.SimpleFinConnections(ctx, dbgen.SimpleFinConnectionsParams{AccessTokenIds: accessTokenIDs})
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return byToken, nil
	}
	toConnID := func(row dbgen.SimpleFinConnectionsRow) int64 { return row.ID }
	accountsByConnID, err := s.accountsBySimpleFinConnectionIDs(ctx, u.Map(rows, toConnID))
	if err != nil {
		return nil, fmt.Errorf("load simplefin connection accounts: %w", err)
	}
	for _, row := range rows {
		conn := simpleFinConnectionFromSQLRow(row, accountsByConnID)
		byToken[row.AccessTokenID] = append(byToken[row.AccessTokenID], conn)
	}
	return byToken, nil
}

func (s *Store) SimpleFinConnectionByConnID(ctx context.Context, connID int64) (*model.SimpleFinConnection, error) {
	connections, err := s.SimpleFinConnectionsByConnIDs(ctx, []int64{connID})
	return dbutil.MapSingle(connections, err, connID)
}

func (s *Store) SimpleFinConnectionIDsByExternalID(
	ctx context.Context,
	tokenID int64,
	externalIDs []string,
) (map[string]int64, error) {
	if len(externalIDs) == 0 {
		return map[string]int64{}, nil
	}
	rows, err := s.q.SimpleFinConnections(ctx, dbgen.SimpleFinConnectionsParams{
		AccessTokenIds: []int64{tokenID},
		ExternalIds:    externalIDs,
	})
	if err != nil {
		return nil, err
	}
	toIDByExternalID := func(row dbgen.SimpleFinConnectionsRow) (string, int64) {
		return row.ExternalID, row.ID
	}
	return lo.Associate(rows, toIDByExternalID), nil
}

func (s *Store) SimpleFinConnectionsByConnIDs(ctx context.Context, connIDs []int64) (map[int64]*model.SimpleFinConnection, error) {
	if len(connIDs) == 0 {
		return map[int64]*model.SimpleFinConnection{}, nil
	}
	rows, err := s.q.SimpleFinConnections(ctx, dbgen.SimpleFinConnectionsParams{Ids: connIDs})
	if err != nil {
		return nil, err
	}
	accountsByConnID, err := s.accountsBySimpleFinConnectionIDs(ctx, connIDs)
	if err != nil {
		return nil, fmt.Errorf("load simplefin connection accounts: %w", err)
	}
	toConnectionByID := func(row dbgen.SimpleFinConnectionsRow) (int64, *model.SimpleFinConnection) {
		conn := simpleFinConnectionFromSQLRow(row, accountsByConnID)
		return conn.ID.Int64(), conn
	}
	return lo.Associate(rows, toConnectionByID), nil
}

func (s *Store) accountsBySimpleFinConnectionIDs(ctx context.Context, connIDs []int64) (map[int64][]*model.Account, error) {
	return s.accountsByConnectionSource(ctx, accounts.SourceTableSimpleFinConnection, connIDs)
}

func simpleFinConnectionFromSQLRow(row dbgen.SimpleFinConnectionsRow, accountsByConnID map[int64][]*model.Account) *model.SimpleFinConnection {
	return &model.SimpleFinConnection{
		ID:           model.New(model.GlobalIDSimpleFinConnection, row.ID),
		OrgDomain:    row.OrgDomain,
		OrgURL:       row.OrgUrl,
		Accounts:     lo.Ternary(accountsByConnID[row.ID] != nil, accountsByConnID[row.ID], []*model.Account{}),
		LastSyncedAt: row.LastSyncedAt,
		CreatedAt:    row.CreatedAt,
		UpdatedAt:    row.UpdatedAt,
	}
}

func (s *Store) SetSimpleFinConnectionHealth(ctx context.Context, connID int64, state string, errMsg *string, lastSyncedAt time.Time) error {
	lastSyncedAtUTC := lastSyncedAt.UTC()
	return s.q.SetSimpleFinConnectionHealth(ctx, dbgen.SetSimpleFinConnectionHealthParams{
		ID:                 connID,
		HealthState:        state,
		HealthErrorMessage: errMsg,
		LastSyncedAt:       &lastSyncedAtUTC,
	})
}
