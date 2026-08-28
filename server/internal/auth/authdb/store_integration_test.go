package authdb

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"tallyo/internal/auth/authtypes"
	"tallyo/internal/database"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbtest"
	"tallyo/internal/utils/must"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	return New(dbtest.Open(t))
}

func TestAuthClientAndKeyStore(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	must.NoErr(t, store.UpsertFrontendClient(ctx, []string{"http://localhost/callback"}, []string{"read"}))
	client, err := store.OAuthClient(ctx, "tallyo-web")
	must.NoErr(t, err)
	if !client.Public || client.RedirectURIs[0] != "http://localhost/callback" || client.Scopes[0] != "read" {
		t.Fatalf("OAuthClient = %+v", client)
	}

	key := authtypes.SigningKeyPEM{PrivatePEM: "private", PublicPEM: "public"}
	must.NoErr(t, store.SaveSigningKeyPEM(ctx, key))
	loadedKey, err := store.LoadSigningKeyPEM(ctx)
	if err != nil || loadedKey != key {
		t.Fatalf("LoadSigningKeyPEM = %+v, %v", loadedKey, err)
	}

}

func TestAuthLoginSessionStore(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	expires := time.Now().UTC().Add(time.Hour)
	session := authtypes.LoginSession{
		ID:                  "session",
		ClientID:            "client",
		RedirectURI:         "http://localhost/callback",
		State:               "state",
		CodeChallenge:       "challenge",
		CodeChallengeMethod: "S256",
		Scopes:              []string{"read"},
		CallbackState:       "google-state",
		ExpiresAt:           expires,
	}

	must.NoErr(t, store.CreateLoginSession(ctx, session))
	must.NoErr(t, store.SaveEmailOTP(ctx, authtypes.EmailOTPUpdate{SessionID: session.ID, Email: "user@example.com", HashedOTP: "otp", HashedMagicToken: "magic", PKCEVerifier: "verifier", ExpiresAt: expires}))
	must.NoErr(t, store.IncrementEmailOTPAttempts(ctx, session.ID))
	must.NoErr(t, store.MarkLoginSessionAuthenticated(ctx, session.ID, "user@example.com", time.Now().UTC()))
	if err := store.MarkLoginSessionAuthenticated(ctx, session.ID, "attacker@example.com", time.Now().UTC()); !errors.Is(err, database.ErrNotFound) {
		t.Fatalf("second MarkLoginSessionAuthenticated err = %v", err)
	}
	loaded, err := store.LoginSessionByCallbackState(ctx, "google-state")
	must.NoErr(t, err)
	if !loaded.Authenticated || loaded.Subject != "user@example.com" || loaded.EmailOTPAttempts != 1 || loaded.PKCEVerifier != "verifier" {
		t.Fatalf("LoginSessionByCallbackState = %+v", loaded)
	}
	must.NoErr(t, store.ClaimAuthenticatedLoginSession(ctx, session.ID, time.Now().UTC()))
	if err := store.ClaimAuthenticatedLoginSession(ctx, session.ID, time.Now().UTC()); !errors.Is(err, database.ErrNotFound) {
		t.Fatalf("second ClaimAuthenticatedLoginSession err = %v", err)
	}
	if _, err := store.LoginSessionByID(ctx, session.ID); !errors.Is(err, database.ErrNotFound) {
		t.Fatalf("LoginSessionByID deleted err = %v", err)
	}
}

func TestAuthCodeAndTokenStore(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	must.NoErr(t, store.SaveOAuthClient(ctx, authtypes.OAuthClient{ID: "client", RedirectURIs: []string{"http://localhost/callback"}, GrantTypes: []string{"authorization_code", "refresh_token"}, ResponseTypes: []string{"code"}, Scopes: []string{"read"}, Public: true}))
	authCode := authtypes.AuthCode{
		ClientID:            "client",
		Subject:             "user@example.com",
		Scopes:              []string{"read"},
		RedirectURI:         "http://localhost/callback",
		CodeChallenge:       "challenge",
		CodeChallengeMethod: "S256",
		ExpiresAt:           now.Add(time.Hour),
	}
	must.NoErr(t, store.CreateAuthCode(ctx, "code-sig", authCode))
	must.NoErr(t, store.UpdateAuthCodePKCE(ctx, "code-sig", "new-challenge", "S256"))
	loadedCode, err := store.AuthCode(ctx, "code-sig", now, true)
	if err != nil || loadedCode.CodeChallenge != "new-challenge" {
		t.Fatalf("AuthCode = %+v, %v", loadedCode, err)
	}
	must.NoErr(t, store.InvalidateAuthCode(ctx, "code-sig"))
	consumed, err := store.AuthCode(ctx, "code-sig", now, false)
	if err != nil || consumed.Subject != authCode.Subject || consumed.Active {
		t.Fatalf("AuthCode inactive = %+v, %v", consumed, err)
	}

	access := authtypes.OAuthToken{Signature: "access", ClientID: "client", Subject: "user@example.com", Scopes: []string{"read"}, ExpiresAt: now.Add(time.Hour), RequestID: "req"}
	must.NoErr(t, store.CreateAccessToken(ctx, access))
	loadedAccess, err := store.AccessToken(ctx, "access", now, false)
	if err != nil || loadedAccess.Subject != access.Subject {
		t.Fatalf("AccessToken = %+v, %v", loadedAccess, err)
	}
	must.NoErr(t, store.DeleteAccessTokensByRequestID(ctx, "req"))
	must.NoErr(t, store.CreateAccessToken(ctx, authtypes.OAuthToken{Signature: "access-delete", ClientID: "client", Subject: "user@example.com", Scopes: []string{"read"}, ExpiresAt: now.Add(time.Hour)}))
	must.NoErr(t, store.DeleteAccessToken(ctx, "access-delete"))

	refresh := authtypes.OAuthToken{Signature: "refresh", ClientID: "client", Subject: "user@example.com", Scopes: []string{"read"}, ExpiresAt: now.Add(time.Hour), RequestID: "refresh-req"}
	must.NoErr(t, store.CreateRefreshToken(ctx, refresh))
	must.NoErr(t, store.RevokeLiveRefreshToken(ctx, "refresh", now))
	loadedRefresh, err := store.RefreshToken(ctx, "refresh", now, false)
	if err != nil || loadedRefresh.Active {
		t.Fatalf("RefreshToken inactive = %+v, %v", loadedRefresh, err)
	}
	must.NoErr(t, store.CreateRefreshToken(ctx, authtypes.OAuthToken{Signature: "refresh-next", ClientID: "client", Subject: "user@example.com", Scopes: []string{"read"}, ExpiresAt: now.Add(time.Hour)}))
	loadedRefresh, err = store.RefreshToken(ctx, "refresh-next", now, true)
	if err != nil || loadedRefresh.ClientID != "client" {
		t.Fatalf("RefreshToken = %+v, %v", loadedRefresh, err)
	}
	must.NoErr(t, store.RevokeRefreshToken(ctx, "refresh-next"))
	must.NoErr(t, store.CreateRefreshToken(ctx, authtypes.OAuthToken{Signature: "refresh-request", ClientID: "client", Subject: "user@example.com", Scopes: []string{"read"}, ExpiresAt: now.Add(time.Hour), RequestID: "rotate-req"}))
	must.NoErr(t, store.RevokeRefreshTokensByRequestID(ctx, "rotate-req"))
}

func TestAuthUserStoreAndCleanup(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	if _, err := store.q.InsertUser(ctx, dbgen.InsertUserParams{Email: "admin@example.com", Role: "admin"}); err != nil {
		t.Fatalf("InsertUser admin: %v", err)
	}
	allowed, err := store.IsEmailAllowed(ctx, "admin@example.com")
	if err != nil || !allowed {
		t.Fatalf("IsEmailAllowed = %v, %v", allowed, err)
	}
	user, err := store.q.InsertUser(ctx, dbgen.InsertUserParams{Email: "user@example.com", Role: "readonly"})
	must.NoErr(t, err)
	role, err := store.UserRole(ctx, "user@example.com")
	if err != nil || role != "readonly" {
		t.Fatalf("UserRole = %q, %v", role, err)
	}
	if id, err := store.UserIDByEmail(ctx, "user@example.com"); err != nil || id != user.ID {
		t.Fatalf("UserIDByEmail = %d, %v", id, err)
	}
	exists, err := store.UserExists(ctx, "user@example.com")
	if err != nil || !exists {
		t.Fatalf("UserExists = %v, %v", exists, err)
	}
	must.NoErr(t, store.SaveOAuthClient(ctx, authtypes.OAuthClient{ID: "client", RedirectURIs: []string{"http://localhost/callback"}, GrantTypes: []string{"authorization_code"}, ResponseTypes: []string{"code"}, Scopes: []string{"read"}, Public: true}))
	must.NoErr(t, store.CreateAccessToken(ctx, authtypes.OAuthToken{Signature: "user-access", ClientID: "client", Subject: "user@example.com", Scopes: []string{"read"}, ExpiresAt: time.Now().Add(time.Hour)}))
	must.NoErr(t, store.CreateRefreshToken(ctx, authtypes.OAuthToken{Signature: "user-refresh", ClientID: "client", Subject: "user@example.com", Scopes: []string{"read"}, ExpiresAt: time.Now().Add(time.Hour)}))
	must.NoErr(t, store.RevokeUserTokens(ctx, "user@example.com"))
	must.NoErr(t, store.CleanupExpiredAuth(ctx, time.Now().UTC().Add(24*time.Hour)))
}

func TestWebAuthnCRUD(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	if _, err := store.q.InsertUser(ctx, dbgen.InsertUserParams{Email: "wa@example.com", Role: "admin"}); err != nil {
		t.Fatalf("InsertUser webauthn user: %v", err)
	}
	userID, err := store.UserIDByEmail(ctx, "wa@example.com")
	must.NoErr(t, err)

	reg := authtypes.WebAuthnRegistration{
		UserID:      userID,
		Name:        "Touch ID",
		SessionJSON: `{"session":"data"}`,
		ExpiresAt:   time.Now().UTC().Add(5 * time.Minute),
	}
	must.NoErr(t, store.SaveWebAuthnRegistration(ctx, reg))
	gotReg, err := store.WebAuthnRegistration(ctx, userID)
	if err != nil || gotReg.Name != reg.Name || gotReg.SessionJSON != reg.SessionJSON {
		t.Fatalf("WebAuthnRegistration = %+v, %v", gotReg, err)
	}

	cred := authtypes.WebAuthnCredential{
		ID:             "cred-id-1",
		UserID:         userID,
		Name:           "Touch ID",
		CredentialJSON: `{"pub":"key"}`,
	}
	must.NoErr(t, store.ConsumeWebAuthnRegistration(ctx, cred))
	if _, err := store.WebAuthnRegistration(ctx, userID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("WebAuthnRegistration after consume error = %v", err)
	}
	second := cred
	second.ID = "cred-id-2"
	if err := store.ConsumeWebAuthnRegistration(ctx, second); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("second ConsumeWebAuthnRegistration() error = %v", err)
	}
	must.NoErr(t, store.SaveWebAuthnRegistration(ctx, reg))
	_, err = store.db.SQL().ExecContext(ctx, `CREATE TRIGGER reject_webauthn_registration_delete BEFORE DELETE ON webauthn_registrations BEGIN SELECT RAISE(ABORT, 'forced registration deletion failure'); END`)
	must.NoErr(t, err)
	failed := cred
	failed.ID = "cred-id-3"
	if err := store.ConsumeWebAuthnRegistration(ctx, failed); err == nil {
		t.Fatal("ConsumeWebAuthnRegistration() returned no error when deletion failed")
	}

	creds, err := store.WebAuthnCredentialsByUserID(ctx, userID)
	if err != nil || len(creds) != 1 || creds[0].ID != cred.ID || creds[0].CredentialJSON != cred.CredentialJSON {
		t.Fatalf("WebAuthnCredentialsByUserID = %+v, %v", creds, err)
	}
	if got, err := store.WebAuthnRegistration(ctx, userID); err != nil || got.Name != reg.Name {
		t.Fatalf("registration after failed consume = %+v, %v", got, err)
	}

	newJSON := `{"pub":"key2"}`
	must.NoErr(t, store.UpdateWebAuthnCredential(ctx, cred.ID, newJSON, time.Now().UTC()))
	creds, err = store.WebAuthnCredentialsByUserID(ctx, userID)
	if err != nil || len(creds) != 1 || creds[0].CredentialJSON != newJSON {
		t.Fatalf("WebAuthnCredentialsByUserID after update = %+v, %v", creds, err)
	}

	must.NoErr(t, store.RenameWebAuthnCredential(ctx, cred.ID, userID, "Face ID"))
	if err := store.RenameWebAuthnCredential(ctx, cred.ID, userID+1, "X"); !errors.Is(err, database.ErrNotFound) {
		t.Fatalf("RenameWebAuthnCredential wrong user err = %v", err)
	}

	must.NoErr(t, store.DeleteWebAuthnCredential(ctx, cred.ID, userID))
	if err := store.DeleteWebAuthnCredential(ctx, cred.ID, userID); !errors.Is(err, database.ErrNotFound) {
		t.Fatalf("DeleteWebAuthnCredential second delete err = %v", err)
	}
}

func TestSaveLoginSessionWebAuthn(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	expires := time.Now().UTC().Add(time.Hour)
	session := authtypes.LoginSession{
		ID:                  "wa-session",
		ClientID:            "client",
		RedirectURI:         "http://localhost/cb",
		State:               "state",
		CodeChallenge:       "challenge",
		CodeChallengeMethod: "S256",
		Scopes:              []string{"read"},
		ExpiresAt:           expires,
	}
	must.NoErr(t, store.CreateLoginSession(ctx, session))
	must.NoErr(t, store.SaveLoginSessionWebAuthn(ctx, session.ID, `{"wa":"session"}`))
}
