package authdb

import (
	"context"
	"time"

	"github.com/samber/lo"

	"tallyo/internal/auth/authtypes"
	"tallyo/internal/database/dbgen"
)

func (s *Store) CreateAccessToken(ctx context.Context, token authtypes.OAuthToken) error {
	err := createAccessToken(ctx, s.q, token)
	return wrapDB(err, "create access token")
}

func (s *Store) AccessToken(ctx context.Context, signature string, now time.Time, _ bool) (authtypes.OAuthToken, error) {
	row, err := s.q.AccessToken(ctx, dbgen.AccessTokenParams{Signature: signature, Now: now.UTC()})
	if err != nil {
		return authtypes.OAuthToken{}, err
	}
	return tokenFromSQL(signature, row), nil
}

func (s *Store) DeleteAccessToken(ctx context.Context, signature string) error {
	err := s.q.DeleteAccessToken(ctx, dbgen.DeleteAccessTokenParams{Signature: signature})
	return wrapDB(err, "delete access token session")
}

func (s *Store) DeleteAccessTokensByRequestID(ctx context.Context, requestID string) error {
	err := s.q.DeleteAccessTokensByRequestID(ctx, dbgen.DeleteAccessTokensByRequestIDParams{RequestID: &requestID})
	return wrapDB(err, "revoke access token")
}

func (s *Store) CreateRefreshToken(ctx context.Context, token authtypes.OAuthToken) error {
	err := createRefreshToken(ctx, s.q, token)
	return wrapDB(err, "create refresh token")
}

func (s *Store) RefreshToken(ctx context.Context, signature string, now time.Time, activeOnly bool) (authtypes.OAuthToken, error) {
	row, err := s.q.RefreshToken(ctx, dbgen.RefreshTokenParams{Signature: signature, ActiveOnly: activeOnly, Now: now.UTC()})
	if err != nil {
		return authtypes.OAuthToken{}, err
	}
	return tokenFromSQL(signature, row), nil
}

func (s *Store) RevokeRefreshToken(ctx context.Context, signature string) error {
	err := s.q.RevokeRefreshToken(ctx, dbgen.RevokeRefreshTokenParams{Signature: signature})
	return wrapDB(err, "delete refresh token session")
}

func (s *Store) RevokeRefreshTokensByRequestID(ctx context.Context, requestID string) error {
	err := s.q.RevokeRefreshTokensByRequestID(ctx, dbgen.RevokeRefreshTokensByRequestIDParams{RequestID: &requestID})
	return wrapDB(err, "revoke refresh token")
}

func (s *Store) RevokeLiveRefreshToken(ctx context.Context, signature string, now time.Time) error {
	rows, err := s.q.RevokeLiveRefreshToken(ctx, dbgen.RevokeLiveRefreshTokenParams{Signature: signature, Now: now.UTC()})
	return wrapAffectedRows(err, rows, "revoke live refresh token")
}

func createAccessToken(ctx context.Context, q *dbgen.Queries, token authtypes.OAuthToken) error {
	scopes := joinSpace(token.Scopes)
	return q.CreateAccessToken(ctx, dbgen.CreateAccessTokenParams{Signature: token.Signature, ClientID: token.ClientID, Subject: token.Subject, Scopes: &scopes, ExpiresAt: token.ExpiresAt.UTC(), RequestID: lo.EmptyableToPtr(token.RequestID)})
}

func createRefreshToken(ctx context.Context, q *dbgen.Queries, token authtypes.OAuthToken) error {
	scopes := joinSpace(token.Scopes)
	return q.CreateRefreshToken(ctx, dbgen.CreateRefreshTokenParams{Signature: token.Signature, ClientID: token.ClientID, Subject: token.Subject, Scopes: &scopes, ExpiresAt: token.ExpiresAt.UTC(), RequestID: lo.EmptyableToPtr(token.RequestID)})
}
