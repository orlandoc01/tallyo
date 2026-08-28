-- Used by internal/auth's WebAuthn registration-finish handler to persist a new passkey after a successful attestation ceremony.
-- name: CreateWebAuthnCredential :exec
INSERT INTO webauthn_credentials (id, user_id, name, credential)
VALUES (@id, @user_id, @name, @credential);

-- Used by internal/auth's WebAuthn login-begin handler and credentials-list handler to load a user's saved passkeys.
-- name: WebAuthnCredentialsByUserID :many
SELECT wc.*
FROM webauthn_credentials wc
WHERE wc.user_id = @user_id
ORDER BY wc.created_at DESC;

-- Used by internal/auth's WebAuthn login-finish handler to update the credential's sign counter and last-used timestamp after a successful assertion.
-- name: UpdateWebAuthnCredential :exec
UPDATE webauthn_credentials
SET credential = @credential,
    last_used_at = @last_used_at
WHERE id = @id;

-- Used by internal/auth's passkey-rename REST handler (PATCH) to rename a saved credential, scoped to its owning user.
-- name: RenameWebAuthnCredential :execrows
UPDATE webauthn_credentials
SET name = @name
WHERE id = @id
  AND user_id = @user_id;

-- Used by internal/auth's passkey-delete REST handler (DELETE) to remove a saved credential, scoped to its owning user.
-- name: DeleteWebAuthnCredential :execrows
DELETE FROM webauthn_credentials
WHERE id = @id
  AND user_id = @user_id;

-- Used by internal/auth's WebAuthn registration-begin handler to persist the attestation challenge/session for the ceremony.
-- name: SaveWebAuthnRegistration :exec
INSERT INTO webauthn_registrations (user_id, name, session, expires_at)
VALUES (@user_id, @name, @session, @expires_at)
ON CONFLICT(user_id) DO UPDATE SET
  name = excluded.name,
  session = excluded.session,
  expires_at = excluded.expires_at;

-- Used by internal/auth's WebAuthn registration-finish handler to retrieve the pending ceremony session for attestation verification.
-- name: WebAuthnRegistration :one
SELECT wr.*
FROM webauthn_registrations wr
WHERE wr.user_id = @user_id;

-- Used by internal/auth's WebAuthn registration-finish handler (and the background cleanup goroutine) to remove a ceremony session once it's consumed or expired.
-- name: DeleteWebAuthnRegistration :execrows
DELETE FROM webauthn_registrations
WHERE user_id = @user_id;

-- Used by internal/admin's setup-wizard configuration flow to check whether any admin has already registered a passkey.
-- name: AdminPasskeyExists :one
SELECT EXISTS(
  SELECT 1
  FROM webauthn_credentials wc
  JOIN users u ON u.id = wc.user_id
   WHERE u.role = 'admin'
);
