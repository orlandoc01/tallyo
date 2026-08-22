package auth

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"time"
)

type authPersistence interface {
	BeginTX(ctx context.Context) (context.Context, error)
	Commit(ctx context.Context) error
	Rollback(ctx context.Context) error
	UpsertFrontendClient(ctx context.Context, redirectURIs []string, scopes []string) error
	SaveOAuthClient(ctx context.Context, client OAuthClient) error
	OAuthClient(ctx context.Context, id string) (OAuthClient, error)
	LoadSigningKeyPEM(ctx context.Context) (SigningKeyPEM, error)
	SaveSigningKeyPEM(ctx context.Context, key SigningKeyPEM) error
	CreateLoginSession(ctx context.Context, session LoginSession) error
	LoginSessionByID(ctx context.Context, id string) (LoginSession, error)
	LoginSessionByCallbackState(ctx context.Context, state string) (LoginSession, error)
	SaveLoginSessionWebAuthn(ctx context.Context, id, sessionJSON string) error
	MarkLoginSessionAuthenticated(ctx context.Context, id, subject string, now time.Time) error
	ClaimAuthenticatedLoginSession(ctx context.Context, id string, now time.Time) error
	DeleteLoginSession(ctx context.Context, id string) error
	SaveEmailOTP(ctx context.Context, update EmailOTPUpdate) error
	IncrementEmailOTPAttempts(ctx context.Context, sessionID string) error
	CreateAuthCode(ctx context.Context, code string, auth AuthCode) error
	AuthCode(ctx context.Context, code string, now time.Time, activeOnly bool) (AuthCode, error)
	InvalidateAuthCode(ctx context.Context, code string) error
	UpdateAuthCodePKCE(ctx context.Context, code, challenge, method string) error
	CreateAccessToken(ctx context.Context, token OAuthToken) error
	AccessToken(ctx context.Context, signature string, now time.Time, activeOnly bool) (OAuthToken, error)
	DeleteAccessToken(ctx context.Context, signature string) error
	DeleteAccessTokensByRequestID(ctx context.Context, requestID string) error
	CreateRefreshToken(ctx context.Context, token OAuthToken) error
	RefreshToken(ctx context.Context, signature string, now time.Time, activeOnly bool) (OAuthToken, error)
	RevokeRefreshToken(ctx context.Context, signature string) error
	RevokeRefreshTokensByRequestID(ctx context.Context, requestID string) error
	RevokeLiveRefreshToken(ctx context.Context, signature string, now time.Time) error
	IsEmailAllowed(ctx context.Context, email string) (bool, error)
	UserRole(ctx context.Context, email string) (string, error)
	UserIDByEmail(ctx context.Context, email string) (int64, error)
	UserExists(ctx context.Context, email string) (bool, error)
	UserEmailByID(ctx context.Context, id int64) (string, error)
	RevokeUserTokens(ctx context.Context, email string) error
	CreateWebAuthnCredential(ctx context.Context, credential WebAuthnCredential) error
	ConsumeWebAuthnRegistration(ctx context.Context, credential WebAuthnCredential) error
	WebAuthnCredentialsByUserID(ctx context.Context, userID int64) ([]WebAuthnCredential, error)
	UpdateWebAuthnCredential(ctx context.Context, id, credentialJSON string, lastUsedAt time.Time) error
	RenameWebAuthnCredential(ctx context.Context, id string, userID int64, name string) error
	DeleteWebAuthnCredential(ctx context.Context, id string, userID int64) error
	SaveWebAuthnRegistration(ctx context.Context, registration WebAuthnRegistration) error
	WebAuthnRegistration(ctx context.Context, userID int64) (WebAuthnRegistration, error)
	DeleteWebAuthnRegistration(ctx context.Context, userID int64) error
	CleanupExpiredAuth(ctx context.Context, now time.Time) error
}

var (
	ErrInvalidCode     = errors.New("invalid_code")
	ErrInvalidToken    = errors.New("invalid_token")
	ErrTooManyAttempts = errors.New("too_many_attempts")
	ErrExpired         = errors.New("expired")
	ErrAlreadyUsed     = errors.New("already_used")
)

func NewStore(db authPersistence) *Store {
	return &Store{db: db}
}

func (s *Store) UpsertFrontendClient(ctx context.Context, redirectURIs []string) error {
	return s.db.UpsertFrontendClient(ctx, redirectURIs, ClientAllowedScopes)
}

func (s *Store) SaveClient(ctx context.Context, c Client) error {
	return s.db.SaveOAuthClient(ctx, c.OAuthClient)
}

func (s *Store) Client(ctx context.Context, id string) (Client, error) {
	c, err := s.db.OAuthClient(ctx, id)
	if err != nil {
		return Client{}, err
	}
	return Client{OAuthClient: c}, nil
}

func (s *Store) LoadOrCreateSigningKey(ctx context.Context) (*SigningKey, error) {
	keyPEM, err := s.db.LoadSigningKeyPEM(ctx)
	if err == nil {
		return parseSigningKey(keyPEM.PrivatePEM, keyPEM.PublicPEM)
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, fmt.Errorf("load signing key: %w", err)
	}
	var privatePEM, publicPEM string
	key, privatePEM, publicPEM, err := newSigningKey()
	if err != nil {
		return nil, err
	}
	if err := s.db.SaveSigningKeyPEM(ctx, SigningKeyPEM{PrivatePEM: privatePEM, PublicPEM: publicPEM}); err != nil {
		return nil, err
	}
	return key, nil
}

func (s *Store) CreateLoginSession(ctx context.Context, session LoginSession) error {
	return s.db.CreateLoginSession(ctx, session)
}

func (s *Store) LoginSessionByID(ctx context.Context, id string) (LoginSession, error) {
	return s.db.LoginSessionByID(ctx, id)
}

func (s *Store) LoginSessionByCallbackState(ctx context.Context, state string) (LoginSession, error) {
	return s.db.LoginSessionByCallbackState(ctx, state)
}

func (s *Store) MarkLoginSessionAuthenticated(ctx context.Context, id, subject string) error {
	return s.db.MarkLoginSessionAuthenticated(ctx, id, subject, time.Now().UTC())
}

func (s *Store) ClaimAuthenticatedLoginSession(ctx context.Context, id string) error {
	return s.db.ClaimAuthenticatedLoginSession(ctx, id, time.Now().UTC())
}

func (s *Store) SaveLoginSessionWebAuthn(ctx context.Context, id, sessionJSON string) error {
	return s.db.SaveLoginSessionWebAuthn(ctx, id, sessionJSON)
}

func (s *Store) DeleteLoginSession(ctx context.Context, id string) error {
	return s.db.DeleteLoginSession(ctx, id)
}

func (s *Store) SaveEmailOTP(ctx context.Context, sessionID, email, hashedOTP, hashedMagicToken, pkceVerifier string, expiresAt time.Time) error {
	return s.db.SaveEmailOTP(ctx, EmailOTPUpdate{
		SessionID:        sessionID,
		Email:            email,
		HashedOTP:        hashedOTP,
		HashedMagicToken: hashedMagicToken,
		PKCEVerifier:     pkceVerifier,
		ExpiresAt:        expiresAt,
	})
}

func (s *Store) VerifyEmailOTP(ctx context.Context, sessionID, email, hashedOTP string) (LoginSession, error) {
	return s.verifyEmailSecret(ctx, sessionID, email, hashedOTP,
		func(session LoginSession) string { return session.EmailOTP },
		func(session LoginSession) error {
			if session.EmailOTPAttempts >= 5 {
				return ErrTooManyAttempts
			}
			if session.EmailOTP == "" || session.EmailOTPExpiresAt.Before(time.Now().UTC()) {
				return ErrExpired
			}
			if err := s.db.IncrementEmailOTPAttempts(ctx, sessionID); err != nil {
				return fmt.Errorf("increment otp attempts: %w", err)
			}
			return nil
		},
		func(session LoginSession) (LoginSession, error) {
			updated, readErr := s.LoginSessionByID(ctx, sessionID)
			if readErr != nil {
				return session, readErr
			}
			return updated, ErrInvalidCode
		},
	)
}

func (s *Store) VerifyEmailMagicToken(ctx context.Context, sessionID, email, hashedToken string) (LoginSession, error) {
	return s.verifyEmailSecret(ctx, sessionID, email, hashedToken,
		func(session LoginSession) string { return session.EmailMagicToken },
		func(session LoginSession) error {
			if session.Authenticated {
				return ErrAlreadyUsed
			}
			if session.EmailMagicToken == "" || session.EmailOTPExpiresAt.Before(time.Now().UTC()) {
				return ErrExpired
			}
			return nil
		},
		func(session LoginSession) (LoginSession, error) { return session, ErrInvalidToken },
	)
}

func (s *Store) verifyEmailSecret(
	ctx context.Context,
	sessionID string,
	email string,
	hashedSecret string,
	storedSecret func(LoginSession) string,
	checkSession func(LoginSession) error,
	mismatch func(LoginSession) (LoginSession, error),
) (LoginSession, error) {
	session, err := s.LoginSessionByID(ctx, sessionID)
	if err != nil {
		return session, fmt.Errorf("login session not found: %w", err)
	}
	if err := checkSession(session); err != nil {
		return session, err
	}
	emailMatch := subtle.ConstantTimeCompare([]byte(session.Email), []byte(email)) == 1
	secretMatch := subtle.ConstantTimeCompare([]byte(storedSecret(session)), []byte(hashedSecret)) == 1
	if !emailMatch || !secretMatch {
		return mismatch(session)
	}
	if err := s.MarkLoginSessionAuthenticated(ctx, sessionID, session.Email); err != nil {
		return session, err
	}
	return s.LoginSessionByID(ctx, sessionID)
}
