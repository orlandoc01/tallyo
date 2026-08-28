package authdb

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"tallyo/internal/auth/authtypes"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
)

func (s *Store) UpsertFrontendClient(ctx context.Context, redirectURIs []string, scopes []string) error {
	client := authtypes.OAuthClient{
		ID:              "tallyo-web",
		RedirectURIs:    redirectURIs,
		GrantTypes:      []string{"authorization_code", "refresh_token"},
		ResponseTypes:   []string{"code"},
		Scopes:          scopes,
		ApplicationType: "web",
		ClientName:      "Tallyo Web",
		Public:          true,
		Preseeded:       true,
	}
	return s.SaveOAuthClient(ctx, client)
}

func (s *Store) SaveOAuthClient(ctx context.Context, c authtypes.OAuthClient) error {
	redirects, _ := json.Marshal(c.RedirectURIs)
	grants, _ := json.Marshal(c.GrantTypes)
	responses, _ := json.Marshal(c.ResponseTypes)
	err := s.q.SaveOAuthClient(ctx, dbgen.SaveOAuthClientParams{
		ID:              c.ID,
		RedirectUris:    string(redirects),
		GrantTypes:      string(grants),
		ResponseTypes:   string(responses),
		Scopes:          joinSpace(c.Scopes),
		ApplicationType: c.ApplicationType,
		ClientName:      &c.ClientName,
		IsPublic:        c.Public,
		IsPreseeded:     c.Preseeded,
	})
	return wrapDB(err, "save oauth client")
}

func (s *Store) OAuthClient(ctx context.Context, id string) (authtypes.OAuthClient, error) {
	row, err := s.q.OAuthClient(ctx, dbgen.OAuthClientParams{ID: id})
	if err != nil {
		return authtypes.OAuthClient{}, err
	}
	return oauthClientFromSQL(row)
}

func (s *Store) LoadSigningKeyPEM(ctx context.Context) (authtypes.SigningKeyPEM, error) {
	row, err := s.q.LoadSigningKeyPEM(ctx)
	if err != nil {
		return authtypes.SigningKeyPEM{}, err
	}
	return authtypes.SigningKeyPEM{PrivatePEM: row.PrivateKeyPem, PublicPEM: row.PublicKeyPem}, nil
}

func (s *Store) SaveSigningKeyPEM(ctx context.Context, key authtypes.SigningKeyPEM) error {
	err := s.q.SaveSigningKeyPEM(ctx, dbgen.SaveSigningKeyPEMParams{PrivatePem: key.PrivatePEM, PublicPem: key.PublicPEM})
	return wrapDB(err, "save signing key")
}

func (s *Store) CreateLoginSession(ctx context.Context, session authtypes.LoginSession) error {
	scopes := joinSpace(session.Scopes)
	err := s.q.CreateLoginSession(ctx, dbgen.CreateLoginSessionParams{
		ID:                  session.ID,
		ClientID:            session.ClientID,
		RedirectUri:         session.RedirectURI,
		State:               &session.State,
		CodeChallenge:       session.CodeChallenge,
		CodeChallengeMethod: session.CodeChallengeMethod,
		Scopes:              &scopes,
		CallbackState:       session.CallbackState,
		ExpiresAt:           session.ExpiresAt.UTC(),
		Purpose:             &session.Purpose,
	})
	return wrapDB(err, "create login session")
}

func (s *Store) LoginSessionByID(ctx context.Context, id string) (authtypes.LoginSession, error) {
	return s.loginSession(ctx, dbgen.LoginSessionsParams{ID: &id})
}

func (s *Store) LoginSessionByCallbackState(ctx context.Context, state string) (authtypes.LoginSession, error) {
	return s.loginSession(ctx, dbgen.LoginSessionsParams{CallbackState: &state})
}

func (s *Store) loginSession(ctx context.Context, params dbgen.LoginSessionsParams) (authtypes.LoginSession, error) {
	rows, err := s.q.LoginSessions(ctx, params)
	row, err := dbutil.FirstRow(rows, err)
	return loginSessionFromSQL(row), err
}

func (s *Store) MarkLoginSessionAuthenticated(ctx context.Context, id, subject string, now time.Time) error {
	rows, err := s.q.MarkLoginSessionAuthenticated(ctx, dbgen.MarkLoginSessionAuthenticatedParams{Subject: &subject, ID: id, Now: now.UTC()})
	return wrapAffectedRows(err, rows, "mark login session authenticated")
}

func (s *Store) ClaimAuthenticatedLoginSession(ctx context.Context, id string, now time.Time) error {
	rows, err := s.q.ClaimAuthenticatedLoginSession(ctx, dbgen.ClaimAuthenticatedLoginSessionParams{ID: id, Now: now.UTC()})
	return wrapAffectedRows(err, rows, "claim authenticated login session")
}

func (s *Store) SaveLoginSessionWebAuthn(ctx context.Context, id, sessionJSON string) error {
	err := s.q.SaveLoginSessionWebAuthn(ctx, dbgen.SaveLoginSessionWebAuthnParams{WebauthnSession: &sessionJSON, ID: id})
	return wrapDB(err, "save login session webauthn")
}

func (s *Store) DeleteLoginSession(ctx context.Context, id string) error {
	err := s.q.DeleteLoginSession(ctx, dbgen.DeleteLoginSessionParams{ID: id})
	return wrapDB(err, "delete login session")
}

func (s *Store) SaveEmailOTP(ctx context.Context, update authtypes.EmailOTPUpdate) error {
	expiresAt := update.ExpiresAt.UTC()
	err := s.q.SaveEmailOTP(ctx, dbgen.SaveEmailOTPParams{
		Email:             &update.Email,
		EmailOtp:          &update.HashedOTP,
		EmailOtpExpiresAt: &expiresAt,
		EmailMagicToken:   &update.HashedMagicToken,
		PkceVerifier:      &update.PKCEVerifier,
		ID:                update.SessionID,
	})
	return wrapDB(err, "save email otp")
}

func (s *Store) IncrementEmailOTPAttempts(ctx context.Context, sessionID string) error {
	err := s.q.IncrementEmailOTPAttempts(ctx, dbgen.IncrementEmailOTPAttemptsParams{ID: sessionID})
	return wrapDB(err, "increment otp attempts")
}

func (s *Store) CreateAuthCode(ctx context.Context, signature string, auth authtypes.AuthCode) error {
	scopes := joinSpace(auth.Scopes)
	err := s.q.CreateAuthCode(ctx, dbgen.CreateAuthCodeParams{
		Signature:           signature,
		ClientID:            auth.ClientID,
		Subject:             auth.Subject,
		Scopes:              &scopes,
		RedirectUri:         auth.RedirectURI,
		CodeChallenge:       auth.CodeChallenge,
		CodeChallengeMethod: auth.CodeChallengeMethod,
		ExpiresAt:           auth.ExpiresAt.UTC(),
	})
	return wrapDB(err, "create authorization code")
}

func (s *Store) AuthCode(ctx context.Context, signature string, now time.Time, activeOnly bool) (authtypes.AuthCode, error) {
	row, err := s.q.AuthCode(ctx, dbgen.AuthCodeParams{Signature: signature, ActiveOnly: activeOnly, Now: now.UTC()})
	if err != nil {
		return authtypes.AuthCode{}, err
	}
	return authCodeFromSQL(row), nil
}

func (s *Store) InvalidateAuthCode(ctx context.Context, signature string) error {
	rows, err := s.q.InvalidateAuthCode(ctx, dbgen.InvalidateAuthCodeParams{Signature: signature})
	return wrapAffectedRows(err, rows, "invalidate authorize code")
}

func (s *Store) UpdateAuthCodePKCE(ctx context.Context, signature, challenge, method string) error {
	err := s.q.UpdateAuthCodePKCE(ctx, dbgen.UpdateAuthCodePKCEParams{CodeChallenge: challenge, CodeChallengeMethod: method, Signature: signature})
	return wrapDB(err, "update pkce request session")
}

func userExists(dbgen.User) bool { return true }

func (s *Store) IsEmailAllowed(ctx context.Context, email string) (bool, error) {
	rows, err := s.q.Users(ctx, dbgen.UsersParams{Email: &email})
	return dbutil.MapFirstRow(rows, err, userExists)
}

func (s *Store) UserRole(ctx context.Context, email string) (string, error) {
	rows, err := s.q.Users(ctx, dbgen.UsersParams{Email: &email})
	row, err := dbutil.FirstRow(rows, err)
	return row.Role, err
}

func (s *Store) UserIDByEmail(ctx context.Context, email string) (int64, error) {
	rows, err := s.q.Users(ctx, dbgen.UsersParams{Email: &email})
	row, err := dbutil.FirstRow(rows, err)
	return row.ID, err
}

func (s *Store) UserExists(ctx context.Context, email string) (bool, error) {
	return s.IsEmailAllowed(ctx, email)
}

func (s *Store) UserEmailByID(ctx context.Context, id int64) (string, error) {
	rows, err := s.q.Users(ctx, dbgen.UsersParams{ID: &id})
	row, err := dbutil.FirstRow(rows, err)
	return row.Email, err
}

func (s *Store) RevokeUserTokens(ctx context.Context, email string) error {
	if err := s.q.DeleteAccessTokensBySubject(ctx, dbgen.DeleteAccessTokensBySubjectParams{Subject: email}); err != nil {
		return err
	}
	return s.q.DeleteRefreshTokensBySubject(ctx, dbgen.DeleteRefreshTokensBySubjectParams{Subject: email})
}

func (s *Store) CleanupExpiredAuth(ctx context.Context, now time.Time) error {
	nowUTC := now.UTC()
	if err := s.q.CleanupExpiredAuthCodes(ctx, dbgen.CleanupExpiredAuthCodesParams{Now: nowUTC}); err != nil {
		return fmt.Errorf("cleanup auth rows: %w", err)
	}
	if err := s.q.CleanupExpiredAccessTokens(ctx, dbgen.CleanupExpiredAccessTokensParams{Now: nowUTC}); err != nil {
		return fmt.Errorf("cleanup auth rows: %w", err)
	}
	if err := s.q.CleanupExpiredRefreshTokens(ctx, dbgen.CleanupExpiredRefreshTokensParams{Now: nowUTC}); err != nil {
		return fmt.Errorf("cleanup auth rows: %w", err)
	}
	if err := s.q.CleanupExpiredLoginSessions(ctx, dbgen.CleanupExpiredLoginSessionsParams{Now: nowUTC}); err != nil {
		return fmt.Errorf("cleanup auth rows: %w", err)
	}
	if err := s.q.CleanupExpiredWebAuthnRegistrations(ctx, dbgen.CleanupExpiredWebAuthnRegistrationsParams{Now: nowUTC}); err != nil {
		return fmt.Errorf("cleanup auth rows: %w", err)
	}
	return nil
}
