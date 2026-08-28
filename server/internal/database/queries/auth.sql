-- Used by internal/auth's Fosite client store to upsert an OAuth client (static config load and dynamic client registration via POST /register).
-- name: SaveOAuthClient :exec
INSERT INTO oauth_clients (
  id, redirect_uris, grant_types, response_types, scopes, application_type, client_name, is_public, is_preseeded
) VALUES (
  @id, @redirect_uris, @grant_types, @response_types, @scopes, @application_type, @client_name, @is_public, @is_preseeded
)
ON CONFLICT(id) DO UPDATE SET
  redirect_uris = excluded.redirect_uris,
  grant_types = excluded.grant_types,
  response_types = excluded.response_types,
  scopes = excluded.scopes,
  application_type = excluded.application_type,
  client_name = excluded.client_name,
  is_public = excluded.is_public,
  is_preseeded = excluded.is_preseeded;

-- Used by internal/auth's Fosite client store (GetClient) on every OAuth request to look up a registered client.
-- name: OAuthClient :one
SELECT
  id,
  redirect_uris,
  grant_types,
  response_types,
  scopes,
  application_type,
  COALESCE(client_name, '') AS client_name,
  is_public,
  is_preseeded
FROM oauth_clients
WHERE id = @id;

-- Used by internal/auth at startup to load the persisted ECDSA P-256 JWT signing key.
-- name: LoadSigningKeyPEM :one
SELECT private_key_pem, public_key_pem
FROM signing_keys
WHERE id = 'primary';

-- Used by internal/auth at first-run startup to persist a newly generated ECDSA P-256 JWT signing key.
-- name: SaveSigningKeyPEM :exec
INSERT INTO signing_keys (id, algorithm, private_key_pem, public_key_pem)
VALUES ('primary', 'ES256', @private_pem, @public_pem);

-- Used by internal/auth's authorize endpoint to create a login session at the start of every OAuth/OIDC login (Google, email OTP/magic link, WebAuthn).
-- name: CreateLoginSession :exec
INSERT INTO login_sessions (
  id, client_id, redirect_uri, state, code_challenge, code_challenge_method, scopes, callback_state, expires_at, purpose
) VALUES (
  @id, @client_id, @redirect_uri, @state, @code_challenge, @code_challenge_method, @scopes, @callback_state, @expires_at, @purpose
);

-- Used throughout internal/auth's login handlers to look up a login session by ID or callback state.
-- name: LoginSessions :many
SELECT
  id,
  client_id,
  redirect_uri,
  COALESCE(state, '') AS state,
  code_challenge,
  code_challenge_method,
  COALESCE(scopes, '') AS scopes,
  callback_state,
  COALESCE(subject, '') AS subject,
  authenticated,
  expires_at,
  COALESCE(email, '') AS email,
  COALESCE(email_otp, '') AS email_otp,
  email_otp_expires_at,
  email_otp_attempts,
  COALESCE(email_magic_token, '') AS email_magic_token,
  COALESCE(pkce_verifier, '') AS pkce_verifier,
  COALESCE(webauthn_session, '') AS webauthn_session,
  COALESCE(purpose, '') AS purpose
FROM login_sessions
WHERE TRUE
  AND id = @id -- :if @id
  AND callback_state = @callback_state -- :if @callback_state
ORDER BY id;

-- Used by internal/auth's Google, email OTP/magic-link, and WebAuthn handlers to mark a login session authenticated once the user's identity is verified.
-- name: MarkLoginSessionAuthenticated :execrows
UPDATE login_sessions
SET subject = @subject,
    authenticated = 1
WHERE id = @id
  AND authenticated = 0
  AND expires_at > @now;

-- Used by internal/auth's WebAuthn login-begin handler to persist the ceremony challenge/session JSON on the login session.
-- name: SaveLoginSessionWebAuthn :exec
UPDATE login_sessions
SET webauthn_session = @webauthn_session
WHERE id = @id;

-- Used by internal/auth's authorize endpoint to atomically consume one authenticated login session immediately before issuing a code.
-- name: ClaimAuthenticatedLoginSession :execrows
DELETE FROM login_sessions
WHERE id = @id
  AND authenticated = 1
  AND expires_at > @now;

-- Used by internal/auth's consent and token-exchange handlers to delete a login session once it has been consumed.
-- name: DeleteLoginSession :exec
DELETE FROM login_sessions
WHERE id = @id;

-- Used by internal/auth's email OTP/magic-link handler to store a freshly issued OTP code and magic-link token hash on the login session.
-- name: SaveEmailOTP :exec
UPDATE login_sessions
SET email = @email,
    email_otp = @email_otp,
    email_otp_expires_at = @email_otp_expires_at,
    email_otp_attempts = 0,
    email_magic_token = @email_magic_token,
    pkce_verifier = @pkce_verifier
WHERE id = @id;

-- Used by internal/auth's VerifyEmailOTP to track failed attempts and enforce the OTP retry limit.
-- name: IncrementEmailOTPAttempts :exec
UPDATE login_sessions
SET email_otp_attempts = email_otp_attempts + 1
WHERE id = @id;

-- Used by internal/auth's Fosite authorization-code store to persist a new code during the authorize step.
-- name: CreateAuthCode :exec
INSERT INTO oauth_authorization_codes (
  signature, client_id, subject, scopes, redirect_uri, code_challenge, code_challenge_method, expires_at
) VALUES (
  @signature, @client_id, @subject, @scopes, @redirect_uri, @code_challenge, @code_challenge_method, @expires_at
);

-- Used by internal/auth's Fosite authorization-code store to look up a code, optionally requiring it to still be active.
-- name: AuthCode :one
SELECT
  client_id,
  subject,
  COALESCE(scopes, '') AS scopes,
  redirect_uri,
  COALESCE(code_challenge, '') AS code_challenge,
  COALESCE(code_challenge_method, '') AS code_challenge_method,
  expires_at,
  active
FROM oauth_authorization_codes
WHERE TRUE
  AND active = 1 -- :if @active_only
  AND signature = @signature
  AND expires_at > @now;

-- Used by internal/auth's Fosite authorization-code store to mark a code inactive immediately after it is exchanged for tokens.
-- name: InvalidateAuthCode :execrows
UPDATE oauth_authorization_codes
SET active = 0
WHERE signature = @signature
  AND active = 1;

-- Used by internal/auth's Fosite PKCE session store to attach the code_challenge/method to an already-created authorization code.
-- name: UpdateAuthCodePKCE :exec
UPDATE oauth_authorization_codes
SET code_challenge = @code_challenge,
    code_challenge_method = @code_challenge_method
WHERE signature = @signature;

-- Used by internal/auth's Fosite access-token store to persist a new access token at the token endpoint.
-- name: CreateAccessToken :exec
INSERT INTO oauth_access_tokens (signature, client_id, subject, scopes, expires_at, request_id)
VALUES (@signature, @client_id, @subject, @scopes, @expires_at, @request_id);

-- Used by internal/auth's Fosite access-token store and the API auth middleware to validate a bearer token on every authenticated request.
-- name: AccessToken :one
SELECT
  client_id,
  subject,
  COALESCE(scopes, '') AS scopes,
  expires_at,
  COALESCE(request_id, '') AS request_id,
  CAST(1 AS BOOLEAN) AS active
FROM oauth_access_tokens
WHERE signature = @signature
  AND expires_at > @now;

-- Used by internal/auth's Fosite access-token store to revoke a single access token.
-- name: DeleteAccessToken :exec
DELETE FROM oauth_access_tokens
WHERE signature = @signature;

-- Used by internal/auth's Fosite token store to revoke every access token issued under the same OAuth request (e.g. on refresh-token replay detection).
-- name: DeleteAccessTokensByRequestID :exec
DELETE FROM oauth_access_tokens
WHERE request_id = @request_id;

-- Used by internal/auth's Fosite refresh-token store to persist a new refresh token at the token endpoint.
-- name: CreateRefreshToken :exec
INSERT INTO oauth_refresh_tokens (signature, client_id, subject, scopes, expires_at, request_id)
VALUES (@signature, @client_id, @subject, @scopes, @expires_at, @request_id);

-- Used by internal/auth's Store.RefreshToken for Fosite refresh-token lookups, optionally requiring the token to still be active.
-- name: RefreshToken :one
SELECT
  client_id,
  subject,
  COALESCE(scopes, '') AS scopes,
  expires_at,
  COALESCE(request_id, '') AS request_id,
  active
FROM oauth_refresh_tokens
WHERE TRUE
  AND active = 1 -- :if @active_only
  AND signature = @signature
  AND expires_at > @now;

-- Used by internal/auth's Fosite refresh-token store to revoke a single refresh token (e.g. explicit logout).
-- name: RevokeRefreshToken :exec
UPDATE oauth_refresh_tokens
SET active = 0
WHERE signature = @signature;

-- Used by internal/auth's Fosite token store to revoke every refresh token issued under the same OAuth request (replay/rotation-chain revocation).
-- name: RevokeRefreshTokensByRequestID :exec
UPDATE oauth_refresh_tokens
SET active = 0
WHERE request_id = @request_id;

-- Used by internal/auth's RotateRefreshToken to atomically revoke the old (still-live) refresh token as part of rotation; execrows lets the caller detect an already-revoked token (replay).
-- name: RevokeLiveRefreshToken :execrows
UPDATE oauth_refresh_tokens
SET active = 0
WHERE signature = @signature
  AND active = 1
  AND expires_at > @now;

-- Used by GraphQL user queries and auth/admin user lookups.
-- name: Users :many
SELECT u.*
FROM users u
WHERE TRUE
  AND u.id = @id -- :if @id
  AND u.email = @email -- :if @email
ORDER BY u.role = 'admin' DESC, u.email ASC;

-- Used by GraphQL mutation updateUser (admin.graphql) via admin/service.go to change a user's role.
-- name: UpdateUserRole :exec
UPDATE users
SET role = @role
WHERE id = @id;

-- Used by GraphQL mutation addUser (admin.graphql) via admin/service.go to create and invite a new user (invitation reuses the email magic-link flow per server/AGENTS.md).
-- name: InsertUser :one
INSERT INTO users (email, role, invited_by)
VALUES (@email, @role, @invited_by)
RETURNING *;

-- Used by GraphQL mutation removeUser (admin.graphql) via admin/service.go; removal is by stable id, not email, so a re-invited user with the same email isn't accidentally removed.
-- name: DeleteUser :exec
DELETE FROM users
WHERE id = @id;

-- Used by internal/auth's RevokeUserTokens (called on user removal) to revoke all of a user's outstanding access tokens.
-- name: DeleteAccessTokensBySubject :exec
DELETE FROM oauth_access_tokens
WHERE subject = @subject;

-- Used by internal/auth's RevokeUserTokens (called on user removal) to revoke all of a user's outstanding refresh tokens.
-- name: DeleteRefreshTokensBySubject :exec
DELETE FROM oauth_refresh_tokens
WHERE subject = @subject;

-- Used by internal/auth's periodic background cleanup goroutine to delete expired authorization codes.
-- name: CleanupExpiredAuthCodes :exec
DELETE FROM oauth_authorization_codes
WHERE expires_at < @now;

-- Used by internal/auth's periodic background cleanup goroutine to delete expired access tokens.
-- name: CleanupExpiredAccessTokens :exec
DELETE FROM oauth_access_tokens
WHERE expires_at < @now;

-- Used by internal/auth's periodic background cleanup goroutine to delete expired refresh tokens.
-- name: CleanupExpiredRefreshTokens :exec
DELETE FROM oauth_refresh_tokens
WHERE expires_at < @now;

-- Used by internal/auth's periodic background cleanup goroutine to delete expired login sessions.
-- name: CleanupExpiredLoginSessions :exec
DELETE FROM login_sessions
WHERE expires_at < @now;

-- Used by internal/auth's periodic background cleanup goroutine to delete expired (abandoned) WebAuthn registration ceremonies.
-- name: CleanupExpiredWebAuthnRegistrations :exec
DELETE FROM webauthn_registrations
WHERE expires_at < @now;
