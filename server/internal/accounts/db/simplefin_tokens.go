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
)

const DefaultSimpleFinSyncCron = "0 6,18 * * *"

func (s *Store) CreateSimpleFinAccessToken(ctx context.Context, accessURL string, ownerID int64, label string) (*model.SimpleFinAccessToken, error) {
	nextSyncAt := time.Now().UTC()
	row, err := s.q.CreateSimpleFinAccessToken(ctx, dbgen.CreateSimpleFinAccessTokenParams{
		AccessUrl:  accessURL,
		Label:      lo.EmptyableToPtr(label),
		OwnerID:    ownerID,
		SyncCron:   DefaultSimpleFinSyncCron,
		NextSyncAt: &nextSyncAt,
	})
	if err != nil {
		return nil, fmt.Errorf("create simplefin access token: %w", err)
	}
	return simpleFinAccessTokenFromCreateRow(row), nil
}

func simpleFinAccessTokenFromCreateRow(row dbgen.CreateSimpleFinAccessTokenRow) *model.SimpleFinAccessToken {
	return &model.SimpleFinAccessToken{
		ID:           model.New(model.GlobalIDSimpleFinAccessToken, row.ID),
		Label:        row.Label,
		Owner:        &model.Owner{ID: model.New(model.GlobalIDOwner, row.OwnerID)},
		SyncCron:     row.SyncCron,
		LastSyncedAt: row.LastSyncedAt,
		NextSyncAt:   row.NextSyncAt,
		CreatedAt:    row.CreatedAt,
	}
}

func (s *Store) SimpleFinAccessTokens(ctx context.Context) ([]*model.SimpleFinAccessToken, error) {
	rows, err := s.q.SimpleFinAccessTokens(ctx, dbgen.SimpleFinAccessTokensParams{})
	return dbutil.MapRows(rows, err, simpleFinAccessTokenFromSQLRow)
}

func (s *Store) SimpleFinAccessTokenByID(ctx context.Context, id int64) (*model.SimpleFinAccessToken, error) {
	rows, err := s.q.SimpleFinAccessTokens(ctx, dbgen.SimpleFinAccessTokensParams{ID: &id})
	return dbutil.MapFirstRow(rows, err, simpleFinAccessTokenFromSQLRow)
}

func simpleFinAccessTokenFromSQLRow(row dbgen.SimpleFinAccessTokensRow) *model.SimpleFinAccessToken {
	return &model.SimpleFinAccessToken{
		ID:           model.New(model.GlobalIDSimpleFinAccessToken, row.ID),
		Label:        row.Label,
		Owner:        &model.Owner{ID: model.New(model.GlobalIDOwner, row.OwnerID), Name: row.OwnerName},
		SyncCron:     row.SyncCron,
		LastSyncedAt: row.LastSyncedAt,
		NextSyncAt:   row.NextSyncAt,
		CreatedAt:    row.CreatedAt,
	}
}

func simpleFinSecretFromRow(row dbgen.SimplefinAccessToken) accounts.SimpleFinAccessTokenSecret {
	return accounts.SimpleFinAccessTokenSecret{
		ID:                row.ID,
		AccessURL:         row.AccessUrl,
		OwnerID:           row.OwnerID,
		SyncCron:          row.SyncCron,
		LastSyncedAt:      row.LastSyncedAt,
		NextSyncAt:        row.NextSyncAt,
		NextBalanceSyncAt: row.NextBalanceSyncAt,
	}
}

func SimpleFinTokenSecretByConnID(ctx context.Context, q *dbgen.Queries, connID int64) (*accounts.SimpleFinAccessTokenSecret, error) {
	row, err := q.SimpleFinTokenSecretByConnID(ctx, dbgen.SimpleFinTokenSecretByConnIDParams{ConnID: connID})
	toSecret := func(row dbgen.SimplefinAccessToken) *accounts.SimpleFinAccessTokenSecret {
		secret := simpleFinSecretFromRow(row)
		return &secret
	}
	return dbutil.MapRow(row, err, toSecret)
}

func (s *Store) SimpleFinTokenSecretByConnID(ctx context.Context, connID int64) (*accounts.SimpleFinAccessTokenSecret, error) {
	return SimpleFinTokenSecretByConnID(ctx, s.q, connID)
}

func SimpleFinTokenSecretsDue(
	ctx context.Context,
	q *dbgen.Queries,
	kind accounts.SimpleFinTokenSecretKind,
	now time.Time,
) ([]accounts.SimpleFinAccessTokenSecret, error) {
	nowUTC := now.UTC()
	rows, err := q.SimpleFinTokenSecrets(ctx, dbgen.SimpleFinTokenSecretsParams{Kind: string(kind), Now: &nowUTC})
	return dbutil.MapRows(rows, err, simpleFinSecretFromRow)
}

func (s *Store) SimpleFinTokensDueForSync(ctx context.Context, now time.Time) ([]accounts.SimpleFinAccessTokenSecret, error) {
	return SimpleFinTokenSecretsDue(ctx, s.q, accounts.SimpleFinTokenSecretKindSync, now)
}

func (s *Store) SetSimpleFinTokenSynced(ctx context.Context, id int64, lastSyncedAt time.Time, nextSyncAt time.Time) error {
	last := lastSyncedAt.UTC()
	next := nextSyncAt.UTC()
	return s.q.SetSimpleFinTokenSynced(ctx, dbgen.SetSimpleFinTokenSyncedParams{
		ID:           id,
		LastSyncedAt: &last,
		NextSyncAt:   &next,
	})
}

func (s *Store) DeleteSimpleFinAccessToken(ctx context.Context, id int64) error {
	return s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		connections, err := q.SimpleFinConnections(ctx, dbgen.SimpleFinConnectionsParams{AccessTokenIds: []int64{id}})
		if err != nil {
			return fmt.Errorf("list simplefin connections: %w", err)
		}
		for _, conn := range connections {
			connectionID := conn.ConnectionID
			if err := q.DeleteAccountsByConnection(ctx, dbgen.DeleteAccountsByConnectionParams{ConnectionID: &connectionID}); err != nil {
				return fmt.Errorf("delete accounts: %w", err)
			}
			if err := q.DeleteConnectionByID(ctx, dbgen.DeleteConnectionByIDParams{ID: connectionID}); err != nil {
				return fmt.Errorf("delete connection: %w", err)
			}
			if err := q.DeleteSimpleFinConnection(ctx, dbgen.DeleteSimpleFinConnectionParams{ID: conn.ID}); err != nil {
				return fmt.Errorf("delete simplefin connection: %w", err)
			}
		}
		if err := q.DeleteSimpleFinAccessToken(ctx, dbgen.DeleteSimpleFinAccessTokenParams{ID: id}); err != nil {
			return fmt.Errorf("delete simplefin access token: %w", err)
		}
		return nil
	})
}

func (s *Store) ResetSimpleFinTokenSyncedAt(ctx context.Context, id int64) error {
	return s.q.ResetSimpleFinTokenSyncedAt(ctx, dbgen.ResetSimpleFinTokenSyncedAtParams{ID: id})
}
