# Troubleshooting

This guide is for self-hosted Tallyo installations. Start with the smallest failing boundary: process, HTTP, authentication, provider sync, then UI.

## Quick Diagnosis

For the repository's Docker Compose service:

```bash
docker compose ps
docker compose logs --tail=200 tallyo
curl -i http://127.0.0.1:8080/healthz
```

For a bare-metal process:

```bash
DB_PATH=<database-path> ./tallyo
curl -i http://127.0.0.1:8080/healthz
```

A healthy HTTP process returns `204 No Content` from `/healthz`.

> [!IMPORTANT]
> `/healthz` is a shallow liveness check. It returns 204 without querying SQLite or any provider. It does not prove that authentication, Plaid, SimpleFIN, reports, background sync, or outbound networking works.

> [!WARNING]
> Treat logs as sensitive. Provider errors can contain institution/account context, and when email authentication is enabled without an SMTP host, Tallyo deliberately logs the complete OTP email body, including the one-time code and magic link. Redact email addresses, identifiers, callback query strings, and credentials before sharing logs. Do not publish an unredacted `docker compose config`; it can contain resolved environment secrets.

## Startup And Containers

### Container is stopped or restarting

1. Check state and the last startup error:

   ```bash
   docker compose ps
   docker compose logs --tail=200 tallyo
   ```

2. Confirm the host port is not already occupied and that the compose port maps to Tallyo's configured `PORT` (default `8080`).
3. Confirm `/data` is persistent and writable. The release image runs as a non-root user; a bind mount created with restrictive ownership can prevent database directory or file creation. Running the container as the bind mount's owner (`--user <uid>:<gid>` or compose `user:`) avoids many host ownership mismatches.
4. Check `DB_PATH`. Its default is `/data/tallyo.db`; a bare-metal run normally needs an explicit writable path.
5. Look for configuration validation errors. After setup is complete, at least one authentication method is required. OAuth methods also require an issuer URL, at least one frontend redirect URI, and positive token lifetimes.

The server creates the database directory, runs migrations and seeds, loads runtime configuration, initializes authentication, and only then starts HTTP. A failure before the `server listening` log means `/healthz` cannot be available.

### Container exits after changing Authorization settings

This is expected behavior. Saving the **Authorization** section, including issuer, frontend redirects, token lifetimes, master password, or disable-auth state, schedules an exit with status 1 after about two seconds. The sample Compose configuration uses `restart: unless-stopped`, so the container should return automatically with the new settings.

If no restart policy or process supervisor is present, start the process again yourself:

```bash
docker compose up -d
docker compose ps
curl -i http://127.0.0.1:8080/healthz
```

Google, email, passkey, trusted-proxy, locale, tracking, MCP, and Ollama sections have live update paths and do not by themselves schedule this authorization restart. If an authorization restart loops, inspect the first fatal configuration error in the logs rather than repeatedly restarting.

### Image has no shell

The release image is based on a distroless image. Commands such as `docker compose exec tallyo sh` are not expected to work. Use Docker/Compose commands from the host, the Tallyo binary's maintenance flags, or a separate utility container for volume inspection.

## Storage, SQLite, And Backups

Tallyo uses one SQLite database. The default container location is `/data/tallyo.db`. WAL mode can create related `-wal` and `-shm` files while the process is running.

- Do not copy the live database file as a backup while Tallyo is running.
- Do not place the live database on SMB, NFS, SSHFS, or another remote filesystem with unreliable SQLite locking.
- Keep the database and all backups private. They include financial data, Plaid access tokens, SimpleFIN access URLs, OAuth refresh tokens, and the JWT signing key.
- A named Docker volume is persistent across container replacement, but it is not by itself an off-host backup.

Create a consistent plaintext snapshot with the built-in maintenance command:

```bash
docker compose exec -T tallyo /tallyo --backup-plain-data=/data/tallyo-backup.db
```

For bare metal, use the same environment and encryption key as the running service:

```bash
DB_PATH=<database-path> ./tallyo --backup-plain-data=<backup-path>
```

The maintenance process exits after creating the backup. Choose a new destination if the requested backup path already exists. The output is deliberately plaintext even when the live database is encrypted, so move it to protected encrypted storage immediately.

If startup reports `create db directory`, `open sqlite`, `init schema`, `readonly`, or `permission denied`, verify that the parent directory exists on the intended persistent mount and is writable by the container process. Fix ownership by `chown`-ing the directory to the container's UID, or run the container as the directory's owner with `--user`.

## Database Encryption

`DB_ENCRYPTION_KEY` and `DB_ENCRYPTION_KEY_FILE` accept a 64-character hexadecimal key. The file setting takes precedence. Generate a key with:

```bash
openssl rand -hex 32
```

Store the key outside the database volume and back it up separately. Losing it makes an encrypted database unusable. Avoid exposing it in shell history, process listings, Compose output, or support logs; a mounted secret file is safer than a literal environment value.

Setting an encryption key does not convert an existing plaintext database. Stop normal service access, configure the key, and run the one-shot conversion:

```bash
docker compose stop tallyo
docker compose run --rm tallyo --encrypt-db
docker compose up -d
docker compose logs --tail=100 tallyo
```

The conversion replaces the configured database with an encrypted copy and leaves the original plaintext at `<database-path>.bak`. Protect that `.bak` as a full secret. A pre-existing `.bak` causes conversion to stop instead of overwriting it.

Typical encryption failures:

- `DB Encryption Key must be exactly 64 hex characters`: wrong length.
- `DB Encryption Key must be valid hex`: non-hexadecimal characters.
- SQLite/open errors immediately after adding a key to a plaintext database: run the explicit conversion rather than opening plaintext through the encrypted VFS.
- Open/init errors after key rotation or restore: the configured key does not match that database.

## Health And Logs

Test both sides of a reverse proxy:

```bash
curl -i http://127.0.0.1:8080/healthz
curl -i https://<tallyo-host>/healthz
```

- Internal fails: diagnose the Tallyo process, port, or container network.
- Internal succeeds but external fails: diagnose proxy routing, TLS, DNS, or firewall.
- Both return 204 but the app fails: continue with authentication, browser network requests, and provider logs. The health route is intentionally shallow.

Tallyo logs JSON to standard output. Each HTTP request logs method, path, status, and duration. Sync paths log completion counts and failures. Start with a bounded log view:

```bash
docker compose logs --tail=200 tallyo
```

Use `docker compose logs -f tallyo` only while reproducing a problem, then stop following and protect the captured output.

## Reverse Proxy And External URL

Tallyo serves the SPA, GraphQL, REST, OAuth, discovery, and optional MCP endpoints on one port. Proxy the whole origin at `/`; the frontend and PWA use root-relative paths and are not designed to be mounted under an arbitrary URL prefix.

For an external origin such as `https://<tallyo-host>`:

- Set the OAuth issuer URL to exactly that origin, without a path.
- Set the frontend redirect URI to exactly `https://<tallyo-host>/auth/callback`.
- For Google, register exactly `https://<tallyo-host>/auth/google/callback` in Google Cloud.
- Preserve the request host and scheme in the proxy and terminate TLS correctly.
- Do not cache `/query`, `/transactions/*`, `/auth/*`, `/authorize`, `/token`, `/register`, `/.well-known/*`, or `/mcp`.
- Allow normal request bodies. GraphQL has a 1 MiB body cap; CSV upload uses multipart data and is separate from that cap.

OAuth redirect URI comparison is exact. Scheme, hostname, port, path, and trailing slash all matter. A proxy redirect from one hostname to another, or from HTTP to HTTPS after OAuth parameters were created, commonly causes a mismatch.

Configure **Settings > Security > Trusted Proxies** only with the IP addresses or CIDRs of proxies that directly reach Tallyo. This setting controls when `X-Forwarded-For` or `X-Real-IP` is trusted for rate limiting. Leave it empty for direct exposure; otherwise clients can spoof forwarding headers. Trusted proxy settings update live.

The server enables HSTS when the configured issuer starts with `https://`, not by inspecting each incoming request. Make sure the external HTTPS origin is genuinely stable before using it.

## OAuth Callback Problems

The browser always asks the frontend client to return to its current origin at `/auth/callback`. Check all three values together:

```text
Issuer:           https://<tallyo-host>
Frontend callback:https://<tallyo-host>/auth/callback
Google callback:  https://<tallyo-host>/auth/google/callback
```

Diagnose these symptoms:

- `redirect_uri` mismatch or token exchange failure: compare the frontend redirect setting with the browser address bar exactly. Remove accidental trailing slashes and old hostnames.
- `Invalid OAuth callback state`: restart sign-in from the same browser profile. Normal PKCE state/verifier values are stored in local storage; private browsing, aggressive storage clearing, or switching profiles can remove them.
- Callback works internally but not externally: the issuer or redirect still points at the internal origin, or the proxy is not routing `/authorize`, `/token`, and `/auth/*`.
- Redirect loop after changing the public URL: update issuer and frontend callback together, allow the expected server restart, then start a fresh sign-in.

The access token issuer/audience is the configured issuer. Changing the issuer invalidates assumptions made by already issued sessions; sign in again after the restart.

## Sign-In Methods

### Google

- Google requires a configured client ID and secret and the exact callback `https://<tallyo-host>/auth/google/callback`.
- The returned Google email must already be an allowed Tallyo user. An unknown address receives `google account is not allowed`.
- `authorization state expired` means the temporary login session is missing or expired; begin sign-in again.
- `google token exchange failed` or `google email lookup failed` indicates callback credentials, outbound HTTPS/DNS, or Google availability. Check server logs and the Google Cloud redirect registration.

### Email OTP and magic links

- Only users already present in Tallyo can sign in. The send endpoint intentionally gives the same success-style response for unknown addresses.
- Codes and magic links expire after 10 minutes. A new-code request is limited to once per 60 seconds, and too many incorrect attempts require starting over.
- Check SMTP host, port, sender, username, password, outbound DNS, and firewall. Tallyo uses SMTP with plain authentication through the Go SMTP client.
- If SMTP host is blank, Tallyo uses development log delivery and prints the full OTP and magic link to stdout. This is not production mail delivery and makes logs authentication-sensitive.
- A magic link can open in a new tab because its short-lived PKCE verifier is carried through the server flow. Use the same external hostname so its callback cookie reaches `/auth/callback`.

### Passkeys

- Use HTTPS for a deployed instance. Browsers only expose WebAuthn in a secure context, with localhost as the normal development exception.
- The RP ID is normally the issuer hostname. RP origins must include the exact scheme and host, including a non-default port.
- If RP ID or public hostname changes, existing credentials may no longer be valid for the new relying party. Keep another working sign-in method while changing passkey configuration.
- The sign-in button appears only when passkeys are enabled and the browser exposes `PublicKeyCredential`.
- A passkey-only setup requires registration of a passkey before completion. Complete onboarding on the device/browser where the credential will be created.

### Master password

- The master password is sent as `X-API-Key` and receives all scopes. Treat it as an administrator credential.
- `MASTER_PASSWORD` from the process environment overrides the value stored through setup. If a UI password change appears ineffective, inspect the deployment's environment source without publishing it.
- The web app stores a master-password session in browser local storage. Sign out or clear this site's storage if the browser keeps presenting an obsolete value.
- `DISABLE_ALL_AUTH=true` is for local development only. Tallyo accepts it only when the issuer is empty or uses HTTP on a loopback host, so an unfinished instance can still be dangerously open if its network exposure is not restricted.

## Plaid Sync

Plaid credentials are configured at runtime under **Settings > Connections**.

Check:

1. The credential environment matches the Plaid secret.
2. The connection is active.
3. The account page shows a recent `last synced` time and a future next transaction sync.
4. **Review > Accounts** or the account row does not show **Update required** or **Sync error**.
5. `SYNC_OFF` and transaction tracking are not disabling the poller.
6. Outbound DNS and HTTPS to Plaid work.

`ITEM_LOGIN_REQUIRED` changes the connection health to `LINK_UPDATE_REQUIRED`. Use the account connection's **Update login** action, which opens Plaid Link update mode and then runs a verification sync. Other Plaid API failures are recorded as `SYNC_ERROR` when they can be parsed.

Default transaction sync cron is `0 6,18 * * *`, and recurring sync is `0 12 * * 0`. These transaction cron expressions are evaluated in UTC. The background loop checks due work at startup and at minute 1 of each hour, so execution is not a second-accurate cron job. New links also schedule a delayed initial transaction sync after about 60 seconds when background workers are running.

Reviewed transactions preserve their user category during Plaid updates. Closed accounts are informational and continue to sync; hidden accounts also sync, but their transactions are hidden from normal reports.

## SimpleFIN Sync

SimpleFIN setup tokens are one-time claim tokens. Tallyo stores the claimed access URL as a secret and does not return it through the API. See [SimpleFIN Setup](simplefin-setup.md).

- If initial account fetch fails, the token remains saved but may show no accounts. Correct network/provider access and let a later sync retry.
- Transaction sync defaults to `0 6,18 * * *` UTC and is checked by the same hourly due-work loop as Plaid.
- **Settings > Connections > SimpleFIN > Reset sync** clears sync progress and makes the token due for a fuller pull on a later background tick. It does not make `SYNC_OFF` workers run.
- SimpleFIN does not supply transaction categories. Transactions normally arrive uncategorized unless a transaction rule matches; Ollama can handle later categorization when enabled for synced transactions.
- Review inferred SimpleFIN account types. The importer uses names, holdings, and balance sign to infer account type, and ambiguous accounts can require review.

Check the logs for request, parse, persistence, and connection health errors. Never paste a SimpleFIN setup token or access URL into an issue or log excerpt.

## Tracking Toggles And `SYNC_OFF`

There are two separate controls:

| Control | Effect |
|---|---|
| `SYNC_OFF=true` | Startup setting. Does not start transaction, recurring, balance, portfolio, account-event, or related background sync workers. Manual API-triggered sync operations remain available. Requires process restart to change. |
| Disable transaction tracking | Runtime setting. Hides transaction-related routes and makes scheduled transaction/recurring due-work return without syncing. |
| Disable wealth tracking | Runtime setting. Hides wealth routes and makes scheduled balance/portfolio due-work return without syncing. |

The runtime toggles are under **Settings > General** and update without restarting. If a whole navigation section disappeared, check these toggles and the signed-in user's scopes before assuming data was lost.

`SYNC_OFF` is visible in resolved configuration but is controlled by startup configuration, not the runtime toggle. A SimpleFIN reset or changed Plaid schedule will not be acted on by a disabled background worker.

## Reports, Categories, And Wealth

### Expense totals look wrong

- Transaction amounts follow Plaid convention: positive is spending; negative is a refund, credit, or inflow.
- Expense reports exclude categories whose group kind is `INCOME` or `TRANSFER`.
- Cash Flow excludes `TRANSFER`, keeps `INCOME`, and presents income as a positive total before computing savings.
- Hidden transactions are excluded by default. Hiding an account updates existing transactions for that account to the same hidden state.
- Transactions staged for Ollama categorization are excluded from spending/cash-flow queries until staging is resolved.
- Date buckets use the instance/user token timezone. After changing locale, refresh the session if day/month boundaries still reflect the prior token.

The category group's kind, not its display name, controls expense/income/transfer report behavior. Check **Settings > Categories** when a transaction appears in the wrong report.

### Net worth or portfolio is empty/stale

- Confirm wealth tracking and background sync are enabled.
- Wait for a successful balance snapshot after linking an account and inspect balance-sync logs.
- Hidden accounts are excluded from net worth/portfolio queries.
- Plaid and SimpleFIN balance schedules default to `16:30` America/New\_York on weekdays. Manual accounts, real estate, and EVM wallets default to daily `16:30` America/New\_York. The worker checks due schedules hourly.
- Snapshot rows use a UTC date for the sync run even though those default balance schedules are evaluated in America/New_York.
- Portfolio analysis needs holdings and external Yahoo Finance classification/quote requests. A balance sync can succeed while a quote/classification request logs a separate failure.
- [DeBank wallet wealth](crypto-tracking.md) requires outbound access and a valid `0x` plus 40-hex-character EVM address; no wallet key is used. If a token balance is missing, confirm its chain is selected in the wallet's account detail form.

Balance review flags and portfolio classifications are separate from transaction categorization. Resolve the relevant queue instead of expecting a transaction rule to change wealth data.

## CSV Import And Export

Read [CSV Transaction Import](csv-import.md) before importing.

The most common current failure is:

```text
account_id "..." not found
```

Exported CSV files are valid import templates. Export writes GraphQL/global account IDs in `account_id`, and import accepts the exported `source` and `external_id` columns for re-import updates.

Other checks:

- The import control is only in the desktop-width Transactions toolbar.
- Import needs `write:transactions`; export needs `read:transactions`.
- The UI rejects files over 10 MiB.
- Use comma-delimited UTF-8 without a BOM and exact supported headers.
- Inspect the 200 response for skipped rows; 200 does not mean every row imported.
- Do not retry a partial import blindly unless the file has stable `source` and `external_id` values. Rows with matching source/external IDs are updated; rows without stable IDs can duplicate because database failures are non-atomic.

## PWA And Browser Cache

Tallyo's production web app is installable and uses an auto-updating service worker. Static app assets are precached, but GraphQL and transaction REST requests use network-only handling. Financial data is not available offline.

If the installed app shows an old shell or fails after an upgrade:

1. Verify `https://<tallyo-host>/healthz` and the normal browser site first.
2. Fully close and reopen the installed app so the auto-updated worker can take control.
3. In browser developer tools, inspect **Application > Service Workers** and unregister the old worker if necessary.
4. Clear site data for only the Tallyo origin, then sign in again. This also removes the refresh token, master-password session, PKCE state, and local UI preferences.
5. Make sure the reverse proxy is not caching API/auth routes and is serving the current `index.html`, service worker, manifest, JavaScript, and CSS with correct content types.

An app shell that opens without data while offline is expected. Test PWA installation and passkeys on HTTPS using the same public origin configured as the OAuth issuer.

See [FAQ](faq.md) for operational behavior and [Security And Deployment Notes](security.md) before exposing an instance.
