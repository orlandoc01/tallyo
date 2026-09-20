# Tallyo Server

Rust server for [Tallyo](../README.md). A single `tallyo` binary that:

- runs background sync loops (Plaid transactions/recurring/balances, SimpleFIN, EVM wallets, real estate snapshots, portfolio price/classification backfill),
- serves the GraphQL API, REST endpoints, and a built-in OAuth 2.1 authorization server,
- embeds and serves the React SPA from `web/dist` (`rust-embed`),
- exposes an optional MCP server for AI assistants.

```
Plaid / SimpleFIN / DeBank / Yahoo ──► sync loops ──► SQLite (SQLCipher)
                                                        │
                    HTTP server (GraphQL + REST + OAuth + MCP + embedded SPA)
```

## Table of Contents

- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Package Layout](#package-layout)
- [Database](#database)
  - [SQL code generation](#sql-code-generation)
  - [Optional SQL filters and index scans](#optional-sql-filters-and-index-scans)
  - [Encryption, backups, and inspection](#encryption-backups-and-inspection)
  - [Converting an adiantum database to SQLCipher](#converting-an-adiantum-database-to-sqlcipher)
- [Configuration](#configuration)
- [Authentication](#authentication)
- [HTTP Surface](#http-surface)
- [Development Commands](#development-commands)
- [Testing](#testing)
  - [Sandbox instance](#sandbox-instance)
- [Contributing](#contributing)

## Tech Stack

- Rust 1.97.1 (pinned in `rust-toolchain.toml` and `mise.toml`), [axum](https://github.com/tokio-rs/axum) on tokio
- [async-graphql](https://async-graphql.github.io) — schema-first GraphQL; the schema lives in [`../schema/*.graphql`](../schema) and `tools/graphql-gen` emits the Rust types and resolver traits from it
- SQLite via [sqlx](https://github.com/launchbadge/sqlx) with bundled SQLCipher for at-rest encryption
- Hand-rolled OAuth 2.1 provider (PKCE-only, ES256 JWTs via `jsonwebtoken` + `p256`), passkeys via `webauthn-rs-core`
- `reqwest` clients for Plaid, SimpleFIN Bridge, DeBank, Yahoo Finance, and Ollama in `src/clients/`
- [rmcp](https://github.com/modelcontextprotocol/rust-sdk) streamable-HTTP MCP server
- sqlc for generated, typed database access (static and dynamic queries via the [`sqlc-gen-rust`](https://github.com/orlandoc01/sqlc-gen-rust) plugin)

## Getting Started

The server embeds the SPA, so populate `web/dist` before building:

```bash
cd web && npm ci && npm run build && cd ..   # build the SPA once
cd server-rs
make sync-web                                # copy ../web/dist into server-rs/web/dist
MASTER_PASSWORD=dev-password cargo run
curl -i http://localhost:8080/healthz        # 204 when up
```

For frontend work you usually run the server once and iterate with the Vite dev server instead (it proxies API calls — see [../web/README.md](../web/README.md)).

Useful dev flags: `SYNC_OFF=true` skips starting background sync loops while leaving manual sync actions available; `DB_PATH` relocates the SQLite file (defaults to `/data/tallyo.db`). The full environment variable table is in the [root README](../README.md#environment-variables).

## Package Layout

```
server-rs/
├── sqlc.yaml               # sqlc config; pins the sqlc-gen-rust release WASM by SHA-256
├── migrations/             # sqlx migrations (schema init + seed), run on startup
├── sql/queries/            # SQL source compiled by sqlc
├── tools/graphql-gen/      # ../schema/*.graphql → src/schema/generated*
├── web/dist/               # embedded SPA (gitignored; make sync-web)
└── src/
    ├── main.rs             # entrypoint: config, --encrypt-db, --backup-plain-data, bootstrap
    ├── bootstrap.rs        # wiring: stores, services, sync loops, HTTP server
    ├── config.rs           # env var + YAML config parsing
    ├── auth/               # OAuth provider, identity providers (master password,
    │   └── oauth/          #   Google, email OTP/magic link, WebAuthn), roles/scopes, JWT
    ├── handler/            # HTTP router, GraphQL handler, SPA serving, CSV import/export
    ├── middleware/         # request logging, security headers, per-IP rate limiting
    ├── clients/            # stateless API adapters: Plaid, SimpleFIN, DeBank, Yahoo, Ollama
    ├── database/           # SQLite open/pragmas, SQLCipher, seeds, generated SQL
    │   └── queries.rs      #   sqlc-generated (make generate)
    ├── schema/generated*   # graphql-gen output: enums, inputs, objects, resolver traits
    ├── graph/              # resolver implementations, guards, dataloaders
    ├── accounts/           # accounts, connections, owners, Plaid link, EVM wallets
    ├── transactions/       # transactions, categories, rules, spending, import, recurring
    │   └── sync/           #   Plaid/SimpleFIN sync + rules → Plaid mapping → Ollama LLM
    ├── wealth/             # assets, holdings, snapshots, net worth, Yahoo pricing
    │   ├── adapters/       #   Plaid, SimpleFIN, DeBank, manual, real estate sync adapters
    │   └── balancesync/    #   scheduled balance snapshot loop
    ├── budgets/            # budget CRUD + reports
    ├── portfolio/          # analysis reports (composition/Morningstar/sectors)
    ├── admin/              # user management, Plaid credentials, runtime configuration
    ├── mcpserver/          # MCP tool registrations, delegates to graph::Resolver
    ├── pfc2/               # Plaid personal-finance-category code table
    ├── ids.rs, money.rs    # ID and money newtypes
    └── utils/              # cron, HTTP server plumbing, timezone helpers
```

Domain modules follow a consistent shape: `store/` implements typed reads and writes over SQLite (sqlc-generated queries, transactions for multi-step writes) and `service.rs` composes stores with business logic. There is no ORM — parameterized SQL only. `main.rs` stays minimal: parse config, hand off to `bootstrap`.

## Database

Single SQLite file, opened through a single-connection pool with `journal_mode=WAL`, `foreign_keys=ON`, and `busy_timeout=30000`. Migrations run on startup via `sqlx::migrate!`; a database created by a 0.2.x release is adopted in place, so upgrading needs no manual migration step. First boot seeds the category tree, the uncategorized sentinel (category `0`), and Plaid category mappings. The authoritative schema snapshot lives at `src/database/schema_snapshot.sql`.

Table groups at a glance:

| Area | Tables |
|------|--------|
| Transactions | `transactions`, `categories`, `category_groups`, `rules`, `rule_accounts`, `tags` |
| Accounts & connections | `accounts`, `owners`, `plaid_credentials`, `plaid_items`, `simplefin_*`, EVM wallet tables |
| Wealth & portfolio | `assets`, holdings, balance/valuation snapshots, `analysis_reports` |
| Budgets | budgets + monthly report data |
| Auth & config | `users`, `login_sessions`, `oauth_clients`, `oauth_refresh_tokens`, `signing_keys`, `configurations` |

[Full Production Schema](./src/database/schema_snapshot.sql)

Conventions that matter when touching data:

- `transactions.amount` keeps Plaid's sign convention: positive = spent, negative = refund/credit. Never flip it.
- `transactions.category_id` is NOT NULL; `0` is the uncategorized sentinel.
- `category_groups.kind` (EXPENSE/INCOME/TRANSFER) is authoritative; categories have no `kind` column — always join `category_groups`.
- Reviewed transactions keep their user-assigned category through sync updates; only Plaid-sourced fields are overwritten.
- Secrets live in the DB (`plaid_items.access_token`, `oauth_refresh_tokens`, `signing_keys.private_key_pem`, SimpleFIN access URLs) and must never surface through GraphQL, logs, or errors.

### SQL code generation

All SQL lives in `sql/queries/*.sql` and is compiled by sqlc (`make generate`), including filter-heavy dynamic reads (the `sqlc-gen-rust` plugin's `-- :if @param`, `-- :flag @name`, and `-- :switch`/`-- :case` annotations make WHERE conjuncts, OR operands, ORDER BY terms, and JOINs runtime-selectable — see "Optional SQL filters and index scans" below). Generated output in `src/database/queries.rs` is committed; `make check-codegen` verifies it is current.

`make generate` also runs `tools/graphql-gen`, which validates `../schema/*.graphql` with `apollo-compiler`, merges type extensions, and emits enums, inputs, output objects, unions, the `Node` interface, and the resolver traits into `src/schema/generated.rs` and `src/schema/generated/`. Never hand-edit those files.

### Optional SQL filters and index scans

Do not combine filtered and unfiltered operations with a disabled-OR predicate such as `(@filter_x = 0 OR indexed_column = @x)`. SQLite plans one statement for both parameter values, so the indexed condition may become a residual test over a scan even when the filter is enabled.

With `@filter_indexed_column = 1` and `@x = 1`:

```sql
EXPLAIN QUERY PLAN
SELECT id, email, role, created_at
FROM users
WHERE (@filter_indexed_column = 0 OR id = @x);
-- SCAN users

EXPLAIN QUERY PLAN
SELECT id, email, role, created_at FROM users WHERE id = @x;
-- SEARCH users USING INTEGER PRIMARY KEY (rowid=?)

EXPLAIN QUERY PLAN
SELECT id, email, role, created_at
FROM users
WHERE (@x != 0 AND id = @x)
   OR (@email != '' AND email = @email);
-- MULTI-INDEX OR
--   SEARCH users USING INTEGER PRIMARY KEY (rowid=?)
--   SEARCH users USING INDEX sqlite_autoindex_users_1 (email=?)
```

`SCAN users` means SQLite examines every user row and tests `id = 1`; returning one row does not make it a primary-key lookup. `SEARCH ... USING INTEGER PRIMARY KEY` performs the indexed lookup directly. When every OR branch has its own indexed condition, SQLite can instead use `MULTI-INDEX OR`. A separate mandatory indexed predicate can still drive another index, but it does not make the optional predicate seekable.

Use a `-- :if` conditional line when only predicates, joins, or ordering differ. Reserve separate named sqlc queries for genuinely different result shapes.

### Encryption, backups, and inspection

- At-rest encryption is SQLCipher: `DB_ENCRYPTION_KEY` or `DB_ENCRYPTION_KEY_FILE` (64 hex chars, `openssl rand -hex 32`). The file takes precedence over the inline key.
- `./tallyo --encrypt-db` converts a plaintext database at `DB_PATH` into SQLCipher in place, keeping the original as `<DB_PATH>.bak` (see the conversion runbook below).
- `./tallyo --backup-plain-data[=PATH]` writes a consistent plaintext copy of `DB_PATH` (decrypted when a key is configured) to `PATH`, into an existing directory `PATH` as `<name>.plain.<ext>`, or beside the source under that name; it refuses to overwrite and runs no migrations. See [`../docs/backups.md`](../docs/backups.md).
- Backups contain every secret the live DB does — encrypt and restrict them.
- Never copy the live file while the server runs; use `--backup-plain-data`, or stop the server first.
- Avoid opening the live DB over SMB/NFS/SSHFS — SQLite depends on locking those filesystems handle poorly.

### Converting an adiantum database to SQLCipher

Releases up to v0.2.1 encrypted `tallyo.db` with the adiantum VFS; later releases read SQLCipher. The one-time conversion goes through a plaintext copy, so treat every intermediate file as a secret (they hold OAuth tokens, Plaid secrets and session keys) and keep them on the same 0600 volume. The decrypt step needs the last adiantum release, `ghcr.io/orlandoc01/tallyo:0.2.1`; the examples below call its binary `tallyo-0.2.1`; run it as `docker run --rm --user "$(id -u):$(id -g)" -v /data:/data -e DB_PATH=/data/tallyo.db -e DB_ENCRYPTION_KEY="$ADIANTUM_KEY" ghcr.io/orlandoc01/tallyo:0.2.1 <args>` if you do not extract it.

Both binaries read the same settings: `DB_PATH` (default `/data/tallyo.db`), `DB_ENCRYPTION_KEY` (64 hex characters) or `DB_ENCRYPTION_KEY_FILE` (takes precedence over the inline key), and optionally `CONFIG_FILE_PATH` naming a YAML file with the keys `db_path`, `db_encryption_key` and `db_encryption_key_file` (a `config.yaml` in the working directory is picked up without the variable). The SQLCipher key may be the adiantum key or a fresh `openssl rand -hex 32`.

1. Stop the running server. Nothing may hold the database open during the conversion.
2. Decrypt with the v0.2.1 binary; it writes `<name>.plain.db` next to the database (`--backup-plain-data=PATH` chooses another location):

   ```bash
   DB_PATH=/data/tallyo.db DB_ENCRYPTION_KEY=$ADIANTUM_KEY ./tallyo-0.2.1 --backup-plain-data
   # writes /data/tallyo.plain.db
   ```

3. Copy the plaintext file to the new server's `DB_PATH`. That path must not exist yet and no `<DB_PATH>.bak` may exist either: `--encrypt-db` refuses to overwrite a backup and treats whatever sits at `DB_PATH` as plaintext, so when the new server reuses the old path, move the adiantum file aside first:

   ```bash
   mv /data/tallyo.db /data/tallyo.adiantum.db
   cp /data/tallyo.plain.db /data/tallyo.db
   ```

4. Encrypt in place with the new binary:

   ```bash
   DB_PATH=/data/tallyo.db DB_ENCRYPTION_KEY=$SQLCIPHER_KEY ./tallyo --encrypt-db
   ```

   It exports the plaintext file into SQLCipher, keeps the original as `/data/tallyo.db.bak` (mode 0600) and logs `database encrypted` with `path` and `backup`. It fails without a key (`DB Encryption Key is required with --encrypt-db`), for `:memory:`, and when the `.bak` already exists; a failed install restores the plaintext file.

5. Start the new server with the same `DB_PATH` and key.
6. Verify: `curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:8080/healthz` prints `204`; sign in through the web app; open the Transactions page (or send `{ transactions { totalCount } }` to `/query` with a bearer token) and check the count matches what v0.2.1 showed.
7. Keep `/data/tallyo.db.bak`, `/data/tallyo.plain.db` and the adiantum file until the restore drill has passed, then delete the two plaintext copies (`shred -u`).
8. Restore drill, on a copy and a spare port so the new server keeps running; pick one:
   - v0.2.1 against the plaintext backup with no key (an empty `DB_ENCRYPTION_KEY` opens plaintext):

     ```bash
     cp /data/tallyo.db.bak /tmp/drill.db && DB_PATH=/tmp/drill.db PORT=8081 ./tallyo-0.2.1
     ```

     then hit `http://localhost:8081/healthz` and stop it.
   - v0.2.1 against the untouched adiantum file with the old key:

     ```bash
     DB_PATH=/data/tallyo.adiantum.db DB_ENCRYPTION_KEY=$ADIANTUM_KEY PORT=8081 ./tallyo-0.2.1
     ```

   - Re-run the conversion from `tallyo.plain.db`: remove the SQLCipher file and its `.bak`, then repeat steps 3–5.

## Configuration

Env vars cover only what's needed before the database opens: `DB_PATH`, `DB_ENCRYPTION_KEY` / `DB_ENCRYPTION_KEY_FILE`, `PORT`, `SYNC_OFF`, `MASTER_PASSWORD`, `DISABLE_ALL_AUTH`, and `CONFIG_FILE_PATH` (a YAML file carrying the same keys in snake_case; see the [root README](../README.md#environment-variables)). Everything else is runtime configuration in the `configurations` table, edited through the setup wizard, **Settings → Configuration** / **Settings → AI Integration**, or the `updateConfiguration` mutation. Every section applies live — no restart for any of them:

| Section | Settings |
|---------|----------|
| `authorization` | OAuth issuer URL, frontend redirect URIs, token lifetimes, dev CORS origins, master password |
| `googleAuthn` / `emailCodeAuthn` / `passKeyAuthn` | Sign-in providers (Google OAuth, SMTP for OTP/magic links, WebAuthn relying party) |
| `llmCategorization` | Ollama transaction categorization: enabled, URL, and model |
| `mcp` | MCP server enable + allowed dynamic-client redirect hosts |
| `security` | Trusted proxy CIDRs |
| `general` | Disable transaction tracking (hide transaction UI and skip background transaction + recurring sync polling), disable wealth tracking (hide wealth UI and skip background wealth adapter + portfolio polling) |
| `locale` | Timezone |

## Authentication

The server is its own OAuth 2.1 provider: authorization code + PKCE (S256 required), ES256 JWT access tokens (15 min), rotating opaque refresh tokens (7 days, replay revokes the chain). Different authentication providers — master password, Google Sign-In, email OTP/magic link, and passkeys — can be active simultaneously; any of them completes the same OAuth code grant. `X-API-Key: <MASTER_PASSWORD>` is the server-to-server fallback and grants all scopes.

Authorization is scope-based. Every root GraphQL field in `../schema/*.graphql` declares `@requiresScope(scope: "...")` — the single source of truth. `graphql-gen` turns those directives into guards inside the generated resolver bodies and rejects any root field without one; MCP tools reuse the same scope checks. Do not add per-resolver auth checks. REST routes declare scopes at the router. Roles-to-scope mapping lives in `src/auth/roles.rs`.

## HTTP Surface

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /healthz` | none | Health check, `204` |
| `GET /auth/config` | none | Available auth methods + setup state |
| `GET /authorize`, `POST /token`, `POST /register` | none | OAuth 2.1 (rate limited) |
| `/.well-known/*` | none | RFC 8414 / RFC 9728 discovery metadata |
| `/auth/google/*`, `/auth/email/*`, `/auth/webauthn/*` | mixed | Identity provider flows |
| `GET/POST /query` | Bearer | GraphQL (1 MiB body cap, complexity limit, introspection off) |
| `GET /playground` | Bearer | GraphQL playground |
| `GET /transactions/export` | Bearer | CSV export; accepts all `TransactionFilter` fields as query params |
| `POST /transactions/import` | Bearer | CSV import (`multipart/form-data`, `file` field) |
| `/mcp` | Bearer | Streamable HTTP MCP endpoint; 404 unless the MCP section is enabled |
| `GET /*` | none | Embedded SPA with client-side routing fallback |

## Development Commands

```bash
# from server-rs/
make generate        # sqlc + graphql-gen (run after editing ../schema/*.graphql or sql/queries/*.sql)
make check-codegen   # fail if make generate changes tracked generated output; required before "done"
make sync-web        # refresh embedded SPA from ../web/dist
cargo run            # run locally
make lint            # cargo fmt --check + clippy -D warnings, for the server and graphql-gen
make deadcode        # cargo machete
make test            # cargo test for the server and graphql-gen (compiles and runs generated code)
make coverage        # cargo llvm-cov with a 75% line gate — required before "done"
make test-all        # check-codegen + lint + deadcode + coverage + generator tests
```

`make generate` and `make check-codegen` need `sqlc` v1.31.1 on the path (`mise use sqlc@1.31.1`); sqlc downloads the `sqlc-gen-rust` WASM from the GitHub release pinned in `sqlc.yaml` and verifies its SHA-256. To bump the plugin, change the release tag in `wasm.url` and update `sha256` from that release's `.sha256` asset.

Never hand-edit generated files: `src/database/queries.rs`, `src/schema/generated.rs`, `src/schema/generated/`.

## Testing

- Required backend checks before "done": `make check-codegen`, `make lint`, `make deadcode`, and `make coverage`. `cargo test` alone is not sufficient.
- `make coverage` is the bar: `cargo llvm-cov` with a minimum line-coverage threshold (`main.rs` and the generated queries are excluded from the measurement).
- Tests live in `#[cfg(test)]` modules next to the code; larger suites sit in `tests.rs` / `tests/` siblings (`src/graph/tests`, `src/handler/tests`, `src/mcpserver/tests`, `src/database/queries_tests`).
- Database tests open an in-memory SQLite pool through `database::dbtest`; HTTP tests drive the axum router with `tower::ServiceExt`; external APIs are stubbed with `wiremock`, and passkeys with `webauthn-authenticator-rs`'s soft passkey.
- Shared test helpers (store fixtures, Plaid/SimpleFIN/DeBank mocks) live in `src/testutil/`.

### Sandbox instance

To try changes against a throwaway instance (in-memory data, nothing persisted):

```bash
docker build -t tallyo:dev .   # from the repo root, after staging the binary the way release.yml does
docker run --rm -it -e MASTER_PASSWORD=sandbox -e SYNC_OFF=true \
  --tmpfs /data:noexec,size=64m -p 8080:8080 tallyo:dev
```

If you expose the sandbox through ngrok or a LAN hostname for OAuth testing, the issuer URL, frontend redirect URIs, and (for Google) the Cloud Console redirect URI must all match that external URL exactly.

## Contributing

- Edit the API in `../schema/*.graphql` first, then `make generate` and implement the generated resolver traits. Every new root field needs `@requiresScope`; generation fails otherwise.
- Keep non-generated Rust files under ~300 lines; split by responsibility. Errors are `anyhow` with `.context(...)`; log with `tracing`.
- Parameterized SQL only; wrap multi-step writes in a transaction.
- Run `cargo fmt` before checks. PRs run `make lint`, `make test`, `make check-codegen`, `make deadcode`, and `make coverage` for the server (plus typecheck/lint/coverage for `web/`) in CI.
- Releases build static musl binaries for linux/amd64 and linux/arm64 and package them into the multi-arch Docker image via the root `Dockerfile`.
- Security issues: see [SECURITY.md](../SECURITY.md); deployment hardening: [docs/security.md](../docs/security.md).

`AGENTS.md` in this directory is the exhaustive contributor/agent reference (idiomatic patterns, codegen rules, invariants) — worth reading before larger changes.
