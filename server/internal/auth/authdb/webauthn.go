package authdb

import (
	"context"
	"errors"
	"time"

	"tallyo/internal/auth/authtypes"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"

	"github.com/samber/lo"
)

func (s *Store) CreateWebAuthnCredential(ctx context.Context, credential authtypes.WebAuthnCredential) error {
	err := s.q.CreateWebAuthnCredential(ctx, dbgen.CreateWebAuthnCredentialParams{ID: credential.ID, UserID: credential.UserID, Name: credential.Name, Credential: credential.CredentialJSON})
	return wrapDB(err, "create webauthn credential")
}

func (s *Store) ConsumeWebAuthnRegistration(ctx context.Context, credential authtypes.WebAuthnCredential) error {
	txCtx, err := s.BeginTX(ctx)
	if err != nil {
		return err
	}
	if err := s.CreateWebAuthnCredential(txCtx, credential); err != nil {
		return errors.Join(err, s.Rollback(txCtx))
	}
	if err := s.DeleteWebAuthnRegistration(txCtx, credential.UserID); err != nil {
		return errors.Join(err, s.Rollback(txCtx))
	}
	return s.Commit(txCtx)
}

func (s *Store) WebAuthnCredentialsByUserID(ctx context.Context, userID int64) ([]authtypes.WebAuthnCredential, error) {
	rows, err := s.q.WebAuthnCredentialsByUserID(ctx, dbgen.WebAuthnCredentialsByUserIDParams{UserID: userID})
	return dbutil.MapRows(rows, err, webAuthnCredentialFromRow)
}

func (s *Store) UpdateWebAuthnCredential(ctx context.Context, id, credentialJSON string, lastUsedAt time.Time) error {
	lastUsedAtUTC := lastUsedAt.UTC()
	err := s.q.UpdateWebAuthnCredential(ctx, dbgen.UpdateWebAuthnCredentialParams{Credential: credentialJSON, LastUsedAt: &lastUsedAtUTC, ID: id})
	return wrapDB(err, "update webauthn credential")
}

func (s *Store) RenameWebAuthnCredential(ctx context.Context, id string, userID int64, name string) error {
	rows, err := s.q.RenameWebAuthnCredential(ctx, dbgen.RenameWebAuthnCredentialParams{Name: name, ID: id, UserID: userID})
	return wrapAffectedRows(err, rows, "rename webauthn credential")
}

func (s *Store) DeleteWebAuthnCredential(ctx context.Context, id string, userID int64) error {
	rows, err := s.q.DeleteWebAuthnCredential(ctx, dbgen.DeleteWebAuthnCredentialParams{ID: id, UserID: userID})
	return wrapAffectedRows(err, rows, "delete webauthn credential")
}

func (s *Store) SaveWebAuthnRegistration(ctx context.Context, registration authtypes.WebAuthnRegistration) error {
	err := s.q.SaveWebAuthnRegistration(ctx, dbgen.SaveWebAuthnRegistrationParams{UserID: registration.UserID, Name: registration.Name, Session: registration.SessionJSON, ExpiresAt: registration.ExpiresAt.UTC()})
	return wrapDB(err, "save webauthn registration")
}

func (s *Store) WebAuthnRegistration(ctx context.Context, userID int64) (authtypes.WebAuthnRegistration, error) {
	row, err := s.q.WebAuthnRegistration(ctx, dbgen.WebAuthnRegistrationParams{UserID: userID})
	if err != nil {
		return authtypes.WebAuthnRegistration{}, err
	}
	return webAuthnRegistrationFromRow(row), nil
}

func (s *Store) DeleteWebAuthnRegistration(ctx context.Context, userID int64) error {
	rows, err := s.q.DeleteWebAuthnRegistration(ctx, dbgen.DeleteWebAuthnRegistrationParams{UserID: userID})
	return wrapAffectedRows(err, rows, "delete webauthn registration")
}

func webAuthnCredentialFromRow(row dbgen.WebauthnCredential) authtypes.WebAuthnCredential {
	return authtypes.WebAuthnCredential{ID: row.ID, UserID: row.UserID, Name: row.Name, CredentialJSON: row.Credential, CreatedAt: row.CreatedAt, LastUsedAt: lo.FromPtr(row.LastUsedAt)}
}

func webAuthnRegistrationFromRow(row dbgen.WebauthnRegistration) authtypes.WebAuthnRegistration {
	return authtypes.WebAuthnRegistration{UserID: row.UserID, Name: row.Name, SessionJSON: row.Session, ExpiresAt: row.ExpiresAt}
}
