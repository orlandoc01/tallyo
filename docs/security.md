# Security And Deployment Notes

Tallyo stores financial account data, Plaid access tokens, OAuth refresh tokens, and the JWT signing key in SQLite. Treat the database file and backups as secrets.

## Authentication Defaults

- Complete setup with a strong `MASTER_PASSWORD` or with Google Sign-In, email OTP/magic links, or passkeys enabled.
- `MASTER_PASSWORD` is a valid standalone self-hosted auth method. It grants all scopes when used as `X-API-Key`, so store it like an admin credential and prefer a long random value.
- `DISABLE_ALL_AUTH=true` is for local development only. Startup rejects it when the configured OAuth issuer is not `http://localhost` or another loopback HTTP URL.

## Network Boundary

- Prefer running Tallyo behind a VPN, private reverse proxy, or an identity-aware proxy.
- Do not rely on rate limits unless trusted proxy CIDRs are configured in `/settings/security` for the reverse proxy that sets `X-Forwarded-For`.
- Trusted proxy CIDRs are DB-managed runtime settings. Users with `write:settings` can change them without restarting the server.
- Leave trusted proxy CIDRs empty when Tallyo is directly exposed; spoofed forwarding headers will be ignored by default.

## Dynamic OAuth Clients

Dynamic client registration (`POST /register`) exists to onboard remote MCP clients and is disabled by default. It only responds (otherwise 404) when the MCP configuration section is enabled under `/settings/configuration`. HTTPS redirect URIs must target the Tallyo issuer host or a host listed in that section's "Allowed redirect hosts" field, which is DB-managed and editable at runtime with no restart required. Loopback HTTP redirects and private native-app URI schemes are also allowed.

Dynamically registered clients always require an explicit consent approval after sign-in. Granted scopes are limited to the intersection of the client's requested scopes and the signed-in user's role.

The following list shows the hosts for popular Cloud model platforms. If you want to register them with the OAuth DCR flow, the host MUST be added before starting the registration process on the cloud platform:

* Claude: `claude.ai`
* ChatGPT: `chatgpt.com`

## Browser Storage

The web app stores the OAuth refresh token and, when master-password login is used, the master password in `localStorage` so sessions survive reloads and magic-link callbacks can complete in a new tab. Any same-origin script execution could read those values, so deployment security depends on keeping the Content Security Policy locked down for scripts; do not add `unsafe-inline` or `unsafe-eval` to `script-src`, and treat browser extensions or compromised client devices as out of scope for that mitigation.

## Database At Rest

- Set database file permissions so only the Tallyo process user can read it, for example `0600` on the database file and restrictive permissions on the containing directory.
- Prefer encrypted volumes, encrypted ZFS datasets, LUKS, or host-level disk encryption for persistent deployments.
- Tallyo also supports SQLite encryption through `DB_ENCRYPTION_KEY` or `DB_ENCRYPTION_KEY_FILE`; use a 64-character hex key from `openssl rand -hex 32` and store it outside the database volume.
- Protect `DB_ENCRYPTION_KEY_FILE` with restrictive permissions and include it in your secret-management process.

## Backups

SQLite backups include the same secrets as the live database, including OAuth refresh tokens, Plaid tokens, and JWT signing keys.

- Store backups encrypted.
- Restrict read access to backup files.
- Rotate credentials if a backup is exposed.
- Use Tallyo's `--backup-plain-data` command instead of copying the live database file directly; its output is always plaintext, so encrypt it externally.
