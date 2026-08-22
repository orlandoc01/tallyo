package db

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/samber/lo"

	"tallyo/internal/apierror"
	"tallyo/internal/clients"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"
)

func (s *Store) CreatePlaidCredential(ctx context.Context, input model.CreatePlaidCredentialInput) (*model.PlaidCredential, error) {
	clientID := strings.TrimSpace(input.ClientID)
	secret := strings.TrimSpace(input.Secret)
	if clientID == "" {
		return nil, apierror.Publicf("client_id is required")
	}
	if secret == "" {
		return nil, apierror.Publicf("secret is required")
	}
	label := strings.TrimSpace(lo.FromPtr(input.Label))
	id, err := s.q.CreatePlaidCredential(ctx, dbgen.CreatePlaidCredentialParams{ClientID: clientID, Secret: secret, Environment: strings.ToLower(string(input.Environment)), Label: lo.EmptyableToPtr(label)})
	if err != nil {
		return nil, err
	}
	return s.PlaidCredential(ctx, int32(id))
}

func (s *Store) UpdatePlaidCredential(ctx context.Context, input model.UpdatePlaidCredentialInput) (*model.PlaidCredential, error) {
	secret := strings.TrimSpace(input.Secret)
	if secret == "" {
		return nil, apierror.Publicf("secret is required")
	}
	rows, err := s.q.UpdatePlaidCredential(ctx, dbgen.UpdatePlaidCredentialParams{Secret: secret, Environment: strings.ToLower(string(input.Environment)), ID: int64(input.ID)})
	if err != nil {
		return nil, err
	}
	if rows == 0 {
		return nil, sql.ErrNoRows
	}
	return s.PlaidCredential(ctx, int32(input.ID))
}

func (s *Store) DeletePlaidCredential(ctx context.Context, id int32) (bool, error) {
	rows, err := s.q.DeletePlaidCredential(ctx, dbgen.DeletePlaidCredentialParams{ID: int64(id)})
	return rows > 0, err
}

func (s *Store) PlaidCredentials(ctx context.Context) ([]*model.PlaidCredential, error) {
	rows, err := s.q.ListPlaidCredentials(ctx, dbgen.ListPlaidCredentialsParams{})
	return dbutil.MapRows(rows, err, plaidCredentialFromRow)
}

func (s *Store) PlaidCredential(ctx context.Context, id int32) (*model.PlaidCredential, error) {
	credentials, err := s.PlaidCredentialsByIDs(ctx, []int32{id})
	return dbutil.MapSingle(credentials, err, id)
}

func (s *Store) PlaidCredentialsByIDs(ctx context.Context, ids []int32) (map[int32]*model.PlaidCredential, error) {
	if len(ids) == 0 {
		return map[int32]*model.PlaidCredential{}, nil
	}
	credentialIDs := u.Map(ids, func(id int32) int64 { return int64(id) })
	rows, err := s.q.ListPlaidCredentials(ctx, dbgen.ListPlaidCredentialsParams{Ids: credentialIDs})
	toCredentialByID := func(row dbgen.ListPlaidCredentialsRow) (int32, *model.PlaidCredential) {
		return int32(row.ID), plaidCredentialFromRow(row)
	}
	return dbutil.AssociateRows(rows, err, toCredentialByID)
}

func plaidCredentialFromRow(row dbgen.ListPlaidCredentialsRow) *model.PlaidCredential {
	return &model.PlaidCredential{ID: int32(row.ID), ClientID: row.ClientID, Environment: model.PlaidEnvironment(strings.ToUpper(row.Environment)), Label: row.Label, ItemCount: int32(row.ItemCount), CreatedAt: row.CreatedAt}
}

func (s *Store) CredentialByID(ctx context.Context, id int32) (*clients.PlaidCredential, error) {
	row, err := s.q.PlaidCredentialSecretByID(ctx, dbgen.PlaidCredentialSecretByIDParams{ID: int64(id)})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &clients.PlaidCredential{ClientID: row.ClientID, Secret: row.Secret, Environment: row.Environment}, nil
}
