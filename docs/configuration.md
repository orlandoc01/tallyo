# Configuring Tallyo

Tallyo has two configuration layers:

- Startup configuration controls values needed before or while opening SQLite. It comes from environment variables or YAML and requires a restart to change.
- Application configuration lives in the SQLite `configurations` table. Administrators manage it through the setup wizard or Settings. All of it applies live, without a restart.

See [Installing Tallyo](install.md) for deployment examples, [Plaid Setup](plaid-setup.md), [SimpleFIN Setup](simplefin-setup.md), [Crypto Tracking](crypto-tracking.md), and [Security and Deployment Notes](security.md) before publishing an instance.

## Startup precedence

The precedence from highest to lowest is:

1. Environment variable.
2. YAML configuration file.
3. Built-in default.

`DB_ENCRYPTION_KEY_FILE` is a second precedence rule: when it is nonempty, Tallyo reads and trims that file and uses its content instead of `DB_ENCRYPTION_KEY`, regardless of where the inline key was configured.

Set `CONFIG_FILE_PATH` to select an exact YAML file. An explicitly selected file must exist and parse successfully or startup fails. Without it, Tallyo optionally looks for `config.yaml` in its current working directory. `CONFIG_FILE_PATH` itself cannot usefully be selected from inside the file it is meant to locate.

Environment values override matching YAML keys. For database-managed authorization, a nonempty `MASTER_PASSWORD` overrides the stored master password, and `DISABLE_ALL_AUTH=true` forces authentication off. A false `DISABLE_ALL_AUTH` value does not force a database-disabled authorization section back on.

## Server environment variables

All variables in this table are read at startup and require a process restart to change.

| Environment variable | YAML key | Default | Behavior |
|---|---|---|---|
| `CONFIG_FILE_PATH` | None | Empty | Select an exact YAML file. Without it, optional `config.yaml` discovery is used. |
| `DB_PATH` | `db_path` | `/data/tallyo.db` | SQLite database filename. The parent directory is created if needed. |
| `DB_ENCRYPTION_KEY` | `db_encryption_key` | Empty | Optional 64-character hexadecimal key for Adiantum database encryption. |
| `DB_ENCRYPTION_KEY_FILE` | `db_encryption_key_file` | Empty | File containing the encryption key. Its trimmed content takes precedence over the inline key. |
| `DB_WARN_FULL_SCANS` | `db_warn_full_scans` | `false` | SQLite diagnostic that warns on actual full scans and automatic transient indexes. |
| `PORT` | `port` | `8080` | HTTP listen port. |
| `SYNC_OFF` | `sync_off` | `false` | Skips all background sync and backfill goroutines. |
| `MASTER_PASSWORD` | `authorization.master_password` | Empty | Master-password and API-key credential. A nonempty startup value overrides the database value and grants all scopes. |
| `DISABLE_ALL_AUTH` | `authorization.disable_all_auth` | `false` | Development-only override that forces all authentication off. If an issuer is configured, it must be loopback HTTP. |

Plaid client IDs, secrets, environments, and labels are database-managed under Settings > Connections; see [Plaid Setup](plaid-setup.md).

SimpleFIN access tokens and connects are also database-managed under Settings > Connections; see [SimpleFIN setup](simplefin-setup.md).

### Frontend build variables

These Vite variables are relevant only when developing or rebuilding the embedded web application. They are compiled into the frontend and changing them on a running release binary has no effect.

| Environment variable | Default | Behavior |
|---|---|---|
| `VITE_API_URL` | `/query` | GraphQL endpoint. Keep the default for normal same-origin production builds. |
| `VITE_DEV_API_TARGET` | `http://localhost:8082` | Target used by the Vite development proxy. It is not a production server setting. |
| `VITE_APP_VERSION` | Empty | Optional version displayed by the web app; release automation supplies it. |

## YAML example

```yaml
db_path: <database-path>
db_encryption_key_file: <key-file>
db_warn_full_scans: false
port: "8080"
sync_off: false
authorization:
  master_password: <strong-password>
  disable_all_auth: false
```

Protect a YAML file that contains `master_password` or `db_encryption_key` as a secret. Prefer a key file or the host's secret-management facility over placing the database key inline.

`DB_WARN_FULL_SCANS` is for temporary diagnostics and normally remains disabled. It emits a warning for each statement that reports runtime full-scan steps or automatic transient-index rows. Warnings contain placeholder SQL and runtime counters, never bound values. Intentional scans also warn, so the setting can be noisy. It uses SQLite runtime counters and does not execute `EXPLAIN QUERY PLAN`.

## Database-managed configuration

The GraphQL API returns secret fields as `********`; it never returns their stored values. Saving that placeholder preserves the current secret. Provider credentials use separate APIs and are not part of the sections below.

Defaults need one distinction: an absent database section generally resolves to disabled, empty, or false. The setup wizard and Settings forms prefill some practical values before first save; those form defaults are identified below.

### Authorization

| Field | Default or initial value | Validation and behavior |
|---|---|---|
| Enabled / `disableAllAuth` | Authorization enabled when saved; the form defaults `disableAllAuth` to false | Disabling all auth is accepted only with no issuer or a loopback HTTP issuer. Do not use it on a network-accessible deployment. |
| Master password | Unset | At least one master password, Google, email, or passkey method is required when setup completes. A nonempty `MASTER_PASSWORD` overrides this field. |
| OAuth issuer URL | Wizard uses the browser origin | Required when any OAuth sign-in provider is enabled. It becomes the token issuer and base for callbacks. |
| Frontend redirect URIs | Wizard uses `<public-origin>/auth/callback` | At least one is required with OAuth providers. OAuth redirect matching is exact, including scheme, port, path, and trailing slash. |
| Access token lifetime | `15m0s` when written by the wizard | Go duration string; must parse and be greater than zero when OAuth is active. |
| Refresh token lifetime | `168h0m0s` when written by the wizard | Go duration string; must parse and be greater than zero when OAuth is active. |
| Development CORS allowed origins | Empty list | Comma-separated origins in the UI. Intended for a separate development frontend, not general reverse-proxy access. |

Saving the Authorization card applies immediately: the server rebuilds its OAuth provider, token issuer, frontend redirect client, and CORS rules in place. No process restart is involved. Access tokens issued under a previous issuer URL stop validating, so users sign in again after an issuer change.

### Google Sign-In

| Field | Default | Validation and behavior |
|---|---|---|
| Enabled | `false` | Provider changes apply live; enabling the first OAuth provider requires valid Authorization settings but no restart. |
| Google client ID | Empty | Tallyo stores the value but does not test it when saved. |
| Google client secret | Empty | Stored as a secret and obfuscated when read; connectivity is tested only by an actual sign-in. |

The Google authorized redirect URI is exactly `<public-origin>/auth/google/callback`, where `<public-origin>` is the OAuth issuer URL without a trailing slash.

### Email OTP and magic links

| Field | Default or initial value | Validation and behavior |
|---|---|---|
| Enabled | `false`; the OAuth wizard initially selects email when OAuth is chosen | Provider changes apply live; enabling the first OAuth provider requires valid Authorization settings but no restart. |
| SMTP host | Empty in storage; wizard initially suggests `smtp.gmail.com` | An empty host jst writes OTP and magic-link data to server logs so do not rely on that mode in production. |
| SMTP port | Empty in storage; wizard initially uses `587` | Stored as text. SMTP connectivity is not tested when saved. |
| SMTP from | Empty in storage; wizard initially uses `Tallyo` | Passed to the SMTP sender. Use a value accepted by the provider. |
| SMTP username | Empty | Stored as plain configuration inside the protected database. |
| SMTP password | Empty | Stored as a secret and obfuscated when read. |

Provider completeness and SMTP delivery are not validated at save time. Test a sign-in or invitation after changing these fields.

### Passkeys and WebAuthn

| Field | Default or initial value | Validation and behavior |
|---|---|---|
| Enabled | `false` | Provider changes apply live; enabling the first OAuth provider requires valid Authorization settings but no restart. |
| Relying-party ID | Wizard uses the browser hostname | If empty, Tallyo derives it from the OAuth issuer host. It must be valid for the public site used by the browser. |
| Relying-party name | `Tallyo` | Display name shown by authenticators. Empty values fall back to `Tallyo`. |
| Relying-party origins | Wizard uses the browser origin | If empty, Tallyo derives the issuer origin. The WebAuthn library validates the resulting configuration. |

Before a passkey-only setup can be enabled, at least one admin passkey must already exist. Use HTTPS at the final public origin except for browser-supported local development contexts.

### LLM categorization

| Field | Default or initial value | Validation and behavior |
|---|---|---|
| Enabled | `false` | Applies live. The categorizer is active only when enabled and a URL is nonempty. |
| Ollama URL | Empty | No connectivity check is made when saved. |
| Ollama model | Empty in storage; Settings seeds the field with `qwen2.5:7b-instruct` as the default | Passed to Ollama as the model name. Tallyo does not pull the model. |

### MCP

| Field | Default | Validation and behavior |
|---|---|---|
| Enabled | `false` | Applies live. `/mcp` returns 404 while disabled. Enabling also permits OAuth dynamic client registration. |
| Dynamic redirect hosts | Empty list | Entries are trimmed, lowercased, and must be bare hostnames without a scheme, path, or port. Applies live. |

Loopback HTTP redirects and supported native application URI schemes are handled separately by the authorization server. Dynamic clients still require user consent and receive only scopes allowed by the signed-in user's role.

### General tracking

| Field | Default | Validation and behavior |
|---|---|---|
| Disable transaction tracking | `false` | Applies live. Hides transaction-related routes and pauses background transaction and recurring-transaction polling. |
| Disable wealth tracking | `false` | Applies live. Hides wealth-related routes and pauses background balance, pricing, and portfolio polling. |

These switches do not delete existing data. They are independent of `SYNC_OFF`, which is a startup-wide switch for every background sync loop.

### Security

| Field | Default | Validation and behavior |
|---|---|---|
| Trusted proxy CIDRs | Empty list | Each entry must parse as an IP address or CIDR prefix. Applies live to client-IP resolution and rate limiting. |

Leave the list empty unless requests arrive through a trusted reverse proxy that sets forwarding headers. Only list the actual proxy networks, not client networks.

### Locale

| Field | Default | Validation and behavior |
|---|---|---|
| Timezone | `America/New_York` | Must be a nonempty IANA timezone recognized by the bundled timezone database. Applies live to reports, budgets, and the timezone claim in newly issued access tokens. |

### Setup state

| Field | Default | Validation and behavior |
|---|---|---|
| Setup complete | `false` | The setup wizard writes `true` at completion. Completion requires at least one master-password, Google, email, or passkey method, even when the development-only authless override is active. The public mutation does not set it back to false. |

The setup marker applies immediately. The normal final wizard submission also writes Authorization, which triggers the controlled process exit described above.

Before setup completes, an instance with no startup master password allows unauthenticated access so the wizard can operate. Keep first-run access restricted and complete setup promptly. Supplying `MASTER_PASSWORD` protects the wizard and remains an override after setup.

## First-run Setup

The setup wizard sequence is:

1. Welcome.
2. Choose a master password, OAuth providers, or both.
3. Enter and confirm the master password if selected.
4. Configure OAuth issuer, redirect URI, and passkey, email, or Google settings if OAuth is selected.
5. Register the initial admin email and, when selected, an initial passkey.
6. Create at least one household owner.
7. Optionally store Plaid credentials or a SimpleFIN token.
8. Finish setup. Sign-in settings take effect immediately; no restart is needed.

The Plaid step stores credentials only. Link bank accounts after setup from Accounts > Link Connection.

### Use the final public origin

The wizard infers OAuth and WebAuthn values from the browser URL. If the service will be reached through a reverse proxy or tunnel, open the wizard through its final public origin from the start. Do not configure OAuth while browsing through a temporary internal origin and then publish it under another origin.

The following must agree:

- OAuth issuer URL: `<public-origin>`.
- Frontend redirect URI: `<public-origin>/auth/callback`.
- WebAuthn relying-party ID and origin.
- Google Cloud authorized redirect URI: `<public-origin>/auth/google/callback`.

Changing Authorization later is supported and applies live.

## Database encryption and maintenance

### New encrypted database

Generate a key file with restrictive permissions, set `DB_ENCRYPTION_KEY_FILE`, and start Tallyo before the database exists. The key must contain exactly 64 hexadecimal characters. Keep it separate from the database storage.

### Encrypt an existing plaintext database

Stop Tallyo first and make an independent backup. Ensure `<database-path>.bak` does not already exist, then run the same binary version with the intended database path and key:

```bash
DB_PATH='<database-path>' \
DB_ENCRYPTION_KEY_FILE='<key-file>' \
./tallyo --encrypt-db
```

The command creates an encrypted replacement in place, renames the original plaintext database to `<database-path>.bak`, logs the result, and exits. It refuses an in-memory database, an empty or invalid key, or an existing backup filename. Start the server afterward with the same key configuration.

Merely adding an encryption key to an existing plaintext database does not encrypt it; it makes Tallyo attempt to open it as encrypted and fail.

### Create a consistent plaintext backup

Use Tallyo's SQLite backup operation instead of copying a live database file:

```bash
DB_PATH='<database-path>' \
DB_ENCRYPTION_KEY_FILE='<key-file>' \
./tallyo --backup-plain-data='<backup-path>'
```

`--backup-plain-data` works for plaintext and encrypted source databases, but its output is always plaintext. Omitting the destination writes a `.plain` database beside the source. The command exits after the backup.

Every backup contains financial data, Plaid access tokens and credentials, OAuth refresh tokens, and signing keys. Encrypt backup storage, restrict access, and test restoration. Never treat a plaintext maintenance backup as safe merely because the source database was encrypted.
