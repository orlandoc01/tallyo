# Tallyo Server

Go server for [Tallyo](../README.md). A single `tallyo` binary that:

- runs background sync loops (Plaid transactions/recurring/balances, SimpleFIN, EVM wallets, real estate snapshots, portfolio price/classification backfill),
- serves the GraphQL API, REST endpoints, and a built-in OAuth 2.1 authorization server,
- embeds and serves the React SPA from `web/dist` (`//go:embed`),
- exposes an optional MCP server for AI assistants.

```
Plaid / SimpleFIN / DeBank / Yahoo ──► sync loops ──► SQLite
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
- [Configuration](#configuration)
- [Authentication](#authentication)
- [HTTP Surface](#http-surface)
- [Development Commands](#development-commands)
- [Testing](#testing)
  - [Sandbox instance](#sandbox-instance)
- [Contributing](#contributing)

## Tech Stack

- Go (toolchain per `go.mod`), [chi](https://github.com/go-chi/chi) router
- [gqlgen](https://gqlgen.com) — schema-first GraphQL; the schema lives in [`../schema/*.graphql`](../schema)
- SQLite via `github.com/ncruces/go-sqlite3` (pure Go/WASM, no CGO) with optional Adiantum at-rest encryption
- [Fosite](https://github.com/ory/fosite) OAuth 2.1 provider (PKCE-only, ES256 JWTs)
- `github.com/plaid/plaid-go` for Plaid; hand-rolled clients for SimpleFIN Bridge, DeBank, and Yahoo Finance in `internal/clients/`
- sqlc for generated, typed database access (static and dynamic queries via a custom dynamic-filter plugin)

## Getting Started

The server embeds the SPA, so populate `web/dist` before running:

```bash
cd web && npm ci && npm run build && cd ..   # build the SPA once
cd server
make sync-web                                # copy ../web/dist into server/web/dist
MASTER_PASSWORD=dev-password go run ./cmd/tallyo
curl -i http://localhost:8080/healthz        # 204 when up
```

For frontend work you usually run the server once and iterate with the Vite dev server instead (it proxies API calls — see [../web/README.md](../web/README.md)).

Useful dev flags: `SYNC_OFF=true` skips starting background sync loops while leaving manual sync actions available; `DB_PATH` relocates the SQLite file (defaults to `/data/tallyo.db`). The full environment variable table is in the [root README](../README.md#environment-variables).

## Package Layout

```
server/
├── gqlgen.yml            # gqlgen config; schema path ../schema/*.graphql
├── sqlc.yaml             # sqlc config for internal/database/queries
├── web/embed.go          # //go:embed all:dist (dist/ is gitignored; make sync-web)
├── cmd/
│   └── tallyo/main.go    # entrypoint: config, wiring, sync loops, HTTP
└── internal/
    ├── auth/             # Fosite OAuth provider, identity providers (master password,
    │                     #   Google, email OTP/magic link, WebAuthn), roles/scopes, JWT
    ├── handler/          # HTTP router, GraphQL handler, SPA serving, CSV import/export
    ├── middleware/       # request logging, security headers, per-IP rate limiting
    ├── config/           # env var parsing
    ├── clients/          # stateless API adapters: Plaid, SimpleFIN, DeBank, Yahoo
    ├── database/         # SQLite open/pragmas, migrations, seeds, generated SQL
    │   ├── queries/      #   SQL source (sqlc)
    │   └── dbgen/        #   sqlc-generated (make generate-sql)
    ├── accounts/         # accounts, connections, owners, Plaid link, EVM wallets
    ├── transactions/     # transactions, categories, rules, spending, import, recurring
    │   └── categorizer/  #   rules → Plaid mapping → Ollama LLM pipeline
    ├── wealth/           # assets, holdings, snapshots, net worth, Yahoo pricing
    │   ├── simplefin/    #   SimpleFIN sync adapter
    │   ├── evmchain/     #   EVM wallet sync (DeBank)
    │   ├── manual/       #   Manual account snapshot sync adapter
    │   └── realestate/   #   real estate valuation snapshots
    ├── budgets/          # budget CRUD + reports
    ├── portfolio/        # analysis reports (composition/Morningstar/sectors)
    ├── admin/            # user management, Plaid credentials, runtime configuration
    ├── graph/            # gqlgen resolvers + generated code (do not edit generated files)
    ├── mcpserver/        # MCP tool registrations, delegates to graph.Resolver
    └── utils/            # shared helpers, Plaid client factory, test utilities
```

Domain packages follow a consistent shape: `stores.go` declares the store interfaces a package consumes, `db/` implements them over SQLite (sqlc-generated queries, `WithTx` for multi-step writes), and `service.go` composes stores with business logic. There is no ORM — parameterized SQL only. `cmd/tallyo/main.go` stays minimal: parse config, wire dependencies, run.

## Database

Single SQLite file, opened with `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=30000`. Migrations run on startup and are idempotent (`CREATE TABLE IF NOT EXISTS`, additive column changes). First boot seeds the category tree, the uncategorized sentinel (category `0`), and Plaid category mappings. The authoritative schema snapshot lives at `internal/database/testdata/schema.sql`.

Table groups at a glance:

| Area | Tables |
|------|--------|
| Transactions | `transactions`, `categories`, `category_groups`, `rules`, `rule_accounts`, `tags` |
| Accounts & connections | `accounts`, `owners`, `plaid_credentials`, `plaid_items`, `simplefin_*`, EVM wallet tables |
| Wealth & portfolio | `assets`, holdings, balance/valuation snapshots, `analysis_reports` |
| Budgets | budgets + monthly report data |
| Auth & config | `users`, `login_sessions`, `oauth_clients`, `oauth_refresh_tokens`, `signing_keys`, `configurations` |

[Full Production Schema](./internal/database/testdata/schema.sql)

Conventions that matter when touching data:

- `transactions.amount` keeps Plaid's sign convention: positive = spent, negative = refund/credit. Never flip it.
- `transactions.category_id` is NOT NULL; `0` is the uncategorized sentinel.
- `category_groups.kind` (EXPENSE/INCOME/TRANSFER) is authoritative; categories have no `kind` column — always join `category_groups`.
- Reviewed transactions keep their user-assigned category through sync updates; only Plaid-sourced fields are overwritten.
- Secrets live in the DB (`plaid_items.access_token`, `oauth_refresh_tokens`, `signing_keys.private_key_pem`, SimpleFIN access URLs) and must never surface through GraphQL, logs, or errors.

For temporary full-scan diagnostics, start with:

```bash
DB_WARN_FULL_SCANS=true ./tallyo
```

This restart-required setting normally remains disabled.

### SQL code generation

All SQL lives in `internal/database/queries/*.sql` and is compiled by sqlc (`make generate-sql`), including filter-heavy dynamic reads (a pinned `sqlc-gen-go` fork adds `-- :if @param` conditional lines — see "Optional SQL filters and index scans" below). Generated output in `internal/database/dbgen` is committed; `make check-codegen` verifies it is current.

### Optional SQL filters and index scans

Do not combine filtered and unfiltered operations with a disabled-OR predicate such as `(@filter_x = 0 OR indexed_column = @x)`. SQLite plans one statement for both parameter values, so the indexed condition may become a residual test over a scan even when the filter is enabled.

This was captured against a read-only production database with SQLite 3.45.1 and reproduced with the server's Go SQLite driver. With `@filter_indexed_column = 1` and `@x = 1`:

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

Use a conditional line when only predicates, joins, or ordering differ. Reserve separate named sqlc queries for genuinely different result shapes.

### Encryption, backups, and inspection

- Optional at-rest encryption: `DB_ENCRYPTION_KEY` or `DB_ENCRYPTION_KEY_FILE` (64 hex chars, `openssl rand -hex 32`).
- Backups contain every secret the live DB does — encrypt and restrict them.
- Never copy the live file while the server runs; snapshot it instead:

```bash
/tallyo --backup-plain-data=/data/tallyo-inspect.db
```

and open the snapshot with your SQLite browser of choice. Avoid opening the live DB over SMB/NFS/SSHFS — SQLite depends on locking those filesystems handle poorly.

## Configuration

Env vars cover only what's needed before the database opens (see the [root README](../README.md#environment-variables)). Everything else is runtime configuration in the `configurations` table, edited through the setup wizard, **Settings → Configuration** / **Settings → AI Integration**, or the `updateConfiguration` mutation. Every section applies live — no restart for any of them:

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

The server is its own OAuth 2.1 provider (Fosite): authorization code + PKCE (S256 required), ES256 JWT access tokens (15 min), rotating opaque refresh tokens (7 days, replay revokes the chain). Different Authentication providers — master password, Google Sign-In, email OTP/magic link, and passkeys — can be active simultaneously; any of them completes the same OAuth code grant. `X-API-Key: <MASTER_PASSWORD>` is the server-to-server fallback and grants all scopes.

Authorization is scope-based. Every root GraphQL field in `../schema/*.graphql` declares `@requiresScope(scope: "...")` — the single source of truth, enforced by gqlgen for GraphQL and by `graph.RequireOperationScope` for MCP tools. Do not add per-resolver auth checks. REST routes declare scopes at the router. Roles-to-scope mapping lives in `internal/auth/roles.go`.

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
| `GET /mcp` | Bearer | MCP endpoint; 404 unless the MCP section is enabled |
| `GET /*` | none | Embedded SPA with client-side routing fallback |

## Development Commands

```bash
# from server/
make generate        # gqlgen + sqlc (run after editing ../schema/*.graphql or queries/*.sql)
make check-codegen  # fail if make generate changes tracked generated output; required before "done"
make sync-web        # refresh embedded SPA from ../web/dist
go run ./cmd/tallyo  # run locally
make lint            # golangci-lint (fast set); make lint-fix to autofix
make deadcode        # fail if deadcode reports unused Go declarations; required before "done"
make test            # plain go test
make coverage        # race-enabled tests + coverage gate — required before "done"
make coverage-html   # open the filtered coverage report
make test-sql        # sqlc vet
make test-all        # codegen + sqlc vet + deadcode + coverage gate
```

Never hand-edit generated files: `internal/graph/generated.go`, `internal/graph/model/models_gen.go`, `internal/database/dbgen/`.

## Testing

- Required backend checks before "done": `make check-codegen`, `make lint`, `make deadcode`, and `make coverage`. `make deadcode` runs `deadcode -test ./...` and fails on any reported output.
- `make coverage` is the bar: `-race`, `-count=1`, and a minimum handwritten-code coverage threshold (generated code and `cmd/` are excluded from the measurement). `go test ./...` alone is not sufficient.
- Naming convention: tests that open SQLite, run migrations/seeds, or compose real stores are `*_integration_test.go`; pure unit tests are `*_test.go`.
- No tests under `cmd/` — keep entrypoints minimal and logic in `internal/`.
- Shared test helpers (in-memory DB setup, seeds, composite stores) live in `internal/utils/test/`.

### Sandbox instance

To try changes against a throwaway instance (in-memory data, nothing persisted):

```bash
docker build -t tallyo:dev .   # from the repo root
docker run --rm -it -e MASTER_PASSWORD=sandbox -e SYNC_OFF=true \
  --tmpfs /data:noexec,size=64m -p 8080:8080 tallyo:dev
```

If you expose the sandbox through ngrok or a LAN hostname for OAuth testing, the issuer URL, frontend redirect URIs, and (for Google) the Cloud Console redirect URI must all match that external URL exactly.

## Contributing

- Edit the API in `../schema/*.graphql` first, then `make generate` and implement resolvers. Every new root field needs `@requiresScope`.
- Keep non-generated Go files under ~300 lines; split by responsibility. Wrap errors with `fmt.Errorf("operation: %w", err)`; log with `log/slog`.
- Parameterized SQL only; wrap multi-step writes in a transaction.
- PRs verify generated code, then run lint, deadcode, and the coverage gate for the server (plus typecheck/lint/coverage for `web/`) in CI. Run `make test-sql` when changing SQL queries.
- `feat:` / `fix:` commit prefixes are grouped into the release changelog; releases are built by GoReleaser (binaries + multi-arch Docker images).
- Security issues: see [SECURITY.md](../SECURITY.md); deployment hardening: [docs/security.md](../docs/security.md).

`AGENTS.md` in this directory is the exhaustive contributor/agent reference (design decisions, invariants, pitfalls) — worth reading before larger changes.
