# AGENTS.md — tallyo server

Agent/contributor reference for `server/`: design decisions, invariants, and pitfalls that aren't obvious from the code. Tech stack, package layout, database overview, configuration reference, HTTP surface, and getting-started live in [README.md](README.md) — read that first.

Go server for a self-hosted household finance tracker. Background sync loops (Plaid transactions/recurring/balances, SimpleFIN, DeBank EVM wallets, Yahoo Finance prices, real estate and manual snapshots, portfolio backfill) write to a single SQLite file. One HTTP port serves GraphQL + REST, a built-in OAuth 2.1 provider (Fosite), an optional MCP server, and the embedded React SPA (`//go:embed web/dist`). The SPA source lives in `../web/` (see `web/AGENTS.md`).

## Hard Design Decisions — Do Not Re-Add

- **No `/transactions/get`, no orphan detection** — cursor-based `/transactions/sync` only; the cursor lives on `plaid_items`. No `is_orphaned` column, no `sync_cursors` table.
- **No hand-rolled OAuth / JWT secrets** — auth lives in `internal/auth/` via Fosite. JWT is ECDSA P-256; key persisted in `signing_keys`.
- **Runtime Configuration** - most configuration options (for plaid, simplefin, user access, etc) live in the runtime configuration managed by the database
- **All queries/mutations take at most 1 argument** (scalar or `{Op}Input`). List queries return envelope types with an `items` field (`CashFlowReport` uses `periods`).
- **`CategoryKind` lives at group level** — no `kind` column on `categories`; derive by joining `category_groups` (`cg.kind = 'EXPENSE'`). Old `is_transfer`/`is_income` columns kept for migration but unused.
- **`internal/mcpserver/` holds `*graph.Resolver` and delegates all operations** — no OAuth/JWT/rate-limit code there. Tool outputs use "lean" projections (`projections*.go`) that slim the fat GraphQL models. `addTool`'s shared `u.Validator.Struct` + generated JSON schema (`WithInputSchemaValidation()`) cover struct/bool "required" and basic types, but **not** enum validity — `AccountType`/`AnalysisView` are plain strings with no schema `enum` constraint and no `UnmarshalGQL`-style check on the MCP path (that check only runs for real GraphQL requests). Keep the `IsValid()` guards in `updateAccount`, `createManualAccount`, and `portfolioAnalysis`; deleting them lets a garbage enum string reach the DB unvalidated (`accounts.type` has no CHECK constraint).
- **No `/auth/invite` endpoint** — invitations reuse `/auth/email/magic` with a server-generated PKCE pair.
- **SQLite infra centralized in `internal/database/`; app SQL lives in domain packages** — `internal/database` owns open/pragmas, migrations (`migrations/`), seeds, and generated `dbgen`. Runtime queries live in domain `db/` subpackages (`accounts/db`, `transactions/db`, …); service packages define package-local store interfaces listing exactly the methods they consume. No broad exported `database.Store`. All SQL — static and dynamic transaction-like reads alike — stays in `internal/database/queries/*.sql` (sqlc, with `-- :if @param` dynamic-filter lines for optional predicates/ORDER BY) — never broad reads + Go filtering.
- **Plaid PFC taxonomy stays in `internal/transactions/pfc2`.** The codes are transaction-domain data. Database startup seeding and the GraphQL resolver consume that transaction feature, but those call sites do not make the taxonomy a shared primitive. Do not move it to a neutral/shared package solely to remove the `database -> transactions/pfc2` import.

## Key Invariants

### Global IDs / Relay Node
Every entity type implements `Node`. IDs are opaque base64 of `v1:<Type>:<localID>` (`internal/graph/model/global_id.go`). The `node`/`nodes` root queries carry `@requiresDynamicScope` — the scope is checked per decoded type at runtime; everything else uses `@requiresScope`.

### Dataloaders
Per-request dataloaders live in `internal/graph/loaders.go` (`graph-gophers/dataloader/v7`, injected by `LoaderInjector`): account snapshots/last-synced, assets, rule accounts, connections, Plaid items/credentials, SimpleFIN connections, EVM wallets. When a list field N+1s, add a loader there — don't query per row in the field resolver.

### Portfolio analysis labels
Constants in `internal/portfolio/types.go`:
- **`"Unclassified"`** — asset has **no** `analysis_reports` row. Controlled by `IncludeUnclassified`, enforced at the DB level (`r.asset_id IS NOT NULL`), no service-layer filtering.
- **`"Unassigned"`** — asset has a report but no data for the current view (e.g. a bond ETF in SECTORS view). Always included regardless of the toggle.

Both sort after regular slices (`Unclassified` last, `Unassigned` second-to-last).

### RBAC / Scopes
`internal/auth/roles.go` is the source of truth for scopes and role→scope mapping. Scopes are `(read|write):<resource>` over: transactions, accounts, users, rules, categories, owners, assets, wealth, budgets, tags, settings, plus read-only `spending`, `cashflow`, `portfolio`, `holdings`.

- Shorthand `read`/`write` request scopes expand to all granular scopes of that action before role intersection ("request everything, role decides") — the SPA requests `read write` on every login.
- `read:spending` gates `spendingByCategory` **only**; `read:cashflow` gates `cashFlow` **only**. Do NOT reuse these for anything else — raw transaction access still needs `read:transactions`.
- `read:holdings` gates direct per-account `Holding` rows (`HoldingRollup.holdings`, `AccountSnapshot.holdings`, `AssetSnapshot.holdings`) at the schema-directive level, separately from the aggregate `read:wealth`/`read:portfolio` scopes that gate the reports containing them. Granted to Admin/Writer/Readonly only — not Net Worth Tracker or Portfolio Tracker, which see aggregate values but not per-account rows.
- Operation auth is schema-driven: every root `Query`/`Mutation` field in `../schema/*.graphql` must have `@requiresScope` (or `@requiresDynamicScope`). gqlgen enforces it via `graph.ConfigWithAuth`; MCP tools call `graph.RequireOperationScope`; REST declares scopes at the router (`requireScope`). Do not add operation-level auth to resolver methods.

### Categories
- `DeleteCategory` rejects ID `0` (uncategorized sentinel) before the transaction count.
- `UpdateCategoryGroup` updates only `category_groups`; `category_rows` is a view, so no category columns are denormalized. A missing group makes update and reorder return `category group <id> not found`; deleting a missing group returns `false, nil`.
- `ReorderCategories` guards with `AND group_id = ?` to block cross-group moves.

### Rules
- At least one of `merchantPattern`/`originalPattern` must be non-empty (create and update).
- `updateRule`: account associations are fully replaced (delete all + insert) in the same transaction as the rule UPDATE.
- `applyRetroactively` on update applies to the **new** criteria; the UPDATE commits first, so new settings are live regardless of retroactive apply.

### Plaid sync
Upsert-only — never insert-or-skip. For reviewed transactions, preserve user `category_id` and `is_reviewed`; overwrite only Plaid-sourced fields (`internal/database/queries/sync.sql`). Re-run auto-categorization only if not yet reviewed. Scheduling is cron-only: per-item `sync_cron`/`recurring_sync_cron` set the next due time; loops query due items from the DB each tick, so new items are picked up without restart. No credential-level stagger or jitter.

### DeBank sync
The supported chain list is hardcoded in `internal/clients/debank_chains.go`; the `RUN_SMOKE_TESTS=1` client smoke test compares it with the live `/chain/list` response and fails on drift. Wallet sync treats the wallet's stored `chain_ids` as authoritative, calls `BalanceList` only for those chains, filters project positions to them, and never calls `/user` for chain discovery.

### Wealth holding asset resolution
All balance-snapshot writes funnel through one sink: `wealthdb.ReplaceAccountBalanceSnapshot`. A `wealth.AssetDailyHolding` has two mutually exclusive shapes:

- **`Asset != nil` — the adapter *describes* an asset it discovered externally** (Plaid, SimpleFIN, DeBank). The external system is the source of truth; the sink resolves/upserts the description to an internal asset ID inside the snapshot transaction.
- **`Asset == nil` — the adapter *references* an asset born locally by `AssetID`** (manual, real estate). The DB row is the source of truth; the adapter's own records already hold the FK, and there is no external ID namespace.

The branch is structural — keyed on the holding's shape, never on adapter identity. Do not "unify" the flow by giving manual/real-estate synthetic source IDs: that inverts into a reverse-lookup special case and creates write-only rows (the old `assets.provider_id` pathology). The uniform contract is the holding struct itself.

### Wealth closed accounts
Closed accounts contribute 0 to net worth from their closure day. Snapshot writes stop at the shared sink (`wealthdb.ReplaceAccountBalanceSnapshot`), current `netWorth` latest-balance queries filter `is_closed = 0` because they have no date predicate, and historical series forward-fill gaps only while an account is open or before a closed account's last snapshot.

### Snapshot flagging
Shared anomaly checks live in `internal/wealth/sanity.go` (`HoldingPriceDeviates`) and the decision/emit plumbing in `internal/wealth/flagging.go` (`EmitClean`/`EmitFlagged`/`EmitApprovedCarryForward`, `BaseAdapter.ApprovedReviewMatches`). Adapters choose which checks and thresholds apply (100x per-holding for DeBank, Plaid investments, and SimpleFIN investments) - never re-implement the emit/review plumbing inside an adapter.

- A provider account view is either clean or anomalous. Holding-level comparison may produce a detailed human-readable reason, but asset identity and anomaly kind are not persisted as approval identity. Do not add an anomaly-identity table or kind/subject columns to provider state.
- `APPROVE_CHANGES` accepts the carried balance and holdings and remembers only the anomalous provider total. A later view must first be independently classified as anomalous, then it auto-carries only when its provider total is within the existing 5% tolerance (or within $0.01 of an approved zero). The holding that triggered the anomaly is deliberately irrelevant to approval matching.
- A clean provider view expires any prior carry-forward approval. If the old anomaly returns after a clean interval, it requires a new review. Clean-result review cleanup is independent of prior-snapshot range recovery because a clean view may have no recovery anchor.
- `account_balance_snapshot_provider_states` is pending-review restoration data only: one exact provider balance and holdings payload per flagged date for transactional `USE_PROVIDER`. It contains no anomaly identity and is deleted by `APPROVE_CHANGES`, `USE_PROVIDER`, clean recovery, or authoritative manual editing.
- An authoritative manual snapshot edit changes the trusted baseline and expires any prior carry-forward approval for that account.
- Keep the existing `APPROVE_CHANGES` GraphQL/UI action and `APPROVED_CHANGES` persisted decision. The terminology is less important than avoiding needless API and database migrations.

DeBank keeps the pre-flag retry/backoff loop for price deviations only; successful empty provider data is accepted, while request failures abort without persisting. Plaid's empty-holdings carry-forward path stays separate because it reprices carried holdings, which the shared emitters deliberately don't do.

### Categorizer
`internal/transactions/categorizer/`: rules first (case-insensitive substring + optional amount bounds, highest `priority` wins), then Plaid `personal_finance_category` static mapping, then category `0`. When LLM is enabled, unmatched transactions are staged for Ollama; low-confidence results are skipped. Rule/PFC/accepted-LLM matches set `is_reviewed = 1`. SimpleFIN transactions arrive uncategorized, so the LLM tier matters most there.

### Users
Removal is by stable `id`, not email (avoids removing a re-invited user with the same email). `addUser` sends an invitation magic link.

## Auth Pitfalls

- **Fosite session serialization**: persist concrete session DTOs; never marshal Fosite interface types directly. Round-trip in tests.
- **Redirect URI exact match**: Fosite requires exact string match (trailing slash = mismatch). `frontend_redirect_uris` must equal what the frontend sends.
- **Refresh rotation atomicity**: revoke old + insert new in one SQL transaction; replay of a revoked token revokes the whole chain.
- **PKCE S256 required** — `plain` rejected. The frontend stores `code_verifier`/`state` in `localStorage` (not `sessionStorage`) so a magic-link callback in a new tab can complete token exchange.
- **OTP logged in dev mode**: when `smtp_host` is unset, OTP codes and magic links print to the log. Never run dev mode in production.
- **Backups include secrets**: DB backups (incl. `--backup-plain-data` output) contain `signing_keys.private_key_pem`, Plaid access tokens, and SimpleFIN access URLs. Never expose via unauthenticated routes.
- **MCP clients get a consent screen**: dynamic clients (DCR via `POST /register`) go through `/consent`; granted scopes are the intersection of the request and the signed-in user's role.
- **Google `state` CSRF**: `crypto/rand`, stored in `login_sessions`, used as the callback lookup key.
- **Access-token revocation is not instant**: API auth verifies JWTs statelessly, so logout/user removal revokes refresh tokens immediately but existing access tokens remain valid until their short expiry.

## Database

Full schema snapshot: `internal/database/testdata/schema.sql`. Migrations (`internal/database/migrations/`) run on startup and must be idempotent (`CREATE TABLE IF NOT EXISTS`, additive columns with non-breaking defaults).

- `transactions.category_id` NOT NULL; ID `0` is the uncategorized sentinel, upserted on startup before category seeding.
- `transactions.amount`: positive = spent, negative = refund/credit (Plaid convention). Store as-is; never flip.
- `category_groups.kind` is authoritative for EXPENSE/INCOME/TRANSFER; all category SELECTs JOIN `category_groups`.
- Secrets never surface via GraphQL/logs/errors: `plaid_credentials.secret`, `plaid_items.access_token`, SimpleFIN access URLs, and `signing_keys.private_key_pem`.
- Upsert keys: `plaid_credentials.client_id` (UNIQUE), `plaid_items.id` (handles re-linking).
- `oauth_clients.id = 'tallyo-web'` is the pre-seeded frontend client (`is_preseeded = true`).

### Schema decisions

- Plain rowid primary keys deliberately avoid `AUTOINCREMENT`; do not add it without a concrete externally visible no-reuse requirement.
- Money totals are stored as `INTEGER` cents; unit prices, quantities, ratios, and percentages remain `REAL`. sqlc maps the `*_cents` table columns to `money.Cents` via per-column overrides in `sqlc.yaml` (new money columns need an entry there). Overrides never apply to expression/aggregate outputs — a `SUM(...) AS x_cents` field stays `int64` and its consumer converts with `money.Cents(...)` explicitly.
- GraphQL dollar-amount fields use the `Money` scalar (never `Float`), bound to `money.Cents` via `MarshalMoney`/`UnmarshalMoney` in `internal/graph/model/scalars.go`. Every JSON wire format — GraphQL, MCP tool args/results, pagination cursors — speaks dollars (`Cents.MarshalJSON` emits dollars); Go and the DB keep cents. Cents converts to `float64` dollars only at genuine float edges: LLM prompts, CSV cells, provider quantity×price math, persisted-JSON shapes, and ratio/percent computation.
- `accounts.external_id` remains globally unique because accounts have no source column; provider ID collisions are theoretical.
- Keep enum `CHECK`s only when SQL branches on the value and an invalid value could silently corrupt results: `category_groups.kind`, `account_balance_snapshot_reviews.decision`, and `assets.asset_type`. Go validates growth-prone provider and marker values instead.
- The polymorphic `connections(source_table, source_id)` association intentionally has no foreign key.

## Configuration

Env vars cover only pre-DB bootstrap (table in the [root README](../README.md#environment-variables)). Everything else lives in the `configurations` table (setup wizard / **Settings → Configuration** / `updateConfiguration`): authorization (issuer URL, redirect URIs, token lifetimes, dev CORS, master password), Google / email-OTP / WebAuthn providers, LLM (Ollama URL and model), MCP (enable + dynamic redirect hosts), security (trusted proxy CIDRs), general (disable transaction tracking hides transaction UI and skips background transaction + recurring sync polling; disable wealth tracking hides wealth UI and skips background wealth adapter + portfolio polling), locale (timezone). `MASTER_PASSWORD` and `DISABLE_ALL_AUTH` env vars override their DB values. Every section applies live through `runtimeconfig.Manager` callbacks — Authorization included: `auth.Service.PrepareAuthConfig` rebuilds the Fosite provider, issuer, frontend client, and dev CORS set in place, so nothing ever schedules a process restart.

Startup order: parse env → open SQLite/migrate → seed sentinel + categories + Plaid mappings → load config from DB → resolve effective config (env overrides) → validate (skipped before setup wizard completes) → load/generate signing key + upsert `tallyo-web` client → init Fosite → start sync/cleanup goroutines → HTTP server. CLI flags `--encrypt-db` and `--backup-plain-data[=PATH]` run one-shot maintenance and exit.

## GraphQL Implementation Notes

- **Spending vs cash flow exclusions**: `spendingByCategory` excludes INCOME and TRANSFER; `cashFlow` excludes only TRANSFER (keeps INCOME for the breakdown); both exclude hidden. Period bucketing honors `Granularity` (`transactions/db/spending_report.go`) and computes income/expenses/savings summaries.
- **`transactions` cursor** — Relay keyset pagination encoding `datetime + id`; supports `after`/`before` with `first`/`last`. Validated once in `transactionQueryFromInput` (shared by GraphQL and MCP through `Resolver.Transactions`): rejects `first` with `last`, `after` with `before`, and non-positive/above-`MaxTransactionLimit` page sizes as public errors instead of silently clamping. Cursor decoding (`transactions/db.DecodeCursor`) rejects structurally-decodable-but-invalid cursors (empty/invalid RFC3339 datetime, non-positive ID) with a stable public "invalid cursor" error. Backward (`last`) `PageInfo`: `hasNextPage` reflects a supplied `before` cursor, `hasPreviousPage` reflects the extra fetched row; forward stays `hasNextPage = hasMore`, `hasPreviousPage = after != nil`. Account-snapshot pagination (`wealth.AccountSnapshots`) follows the same non-positive/above-max-`first` rejection and public-cursor-error rules, keeping its own defaults (20 default, 100 max).
- **Don't add a flat per-hop complexity multiplier on `AccountList.items`/`ConnectionList.items`/`PlaidItem.accounts`/`SimpleFinConnection.accounts` to bound the `Account -> Connection -> provider -> PlaidItem/SimpleFinConnection -> accounts` cycle.** Tried once (briefly landed, reverted same day): a multiplier large enough to reject a two-hop cycle written with minimal fields (e.g. ×25, needs ≥~22 to exceed the fixed 500 limit at depth 2) already rejects a *single* legitimate hop through `PlaidItem.accounts`/`SimpleFinConnection.accounts` selecting real `Account` fields (childComplexity ~37, so ×25 = 925 > 500) — breaking the frontend's actual `connections`/`accounts`-with-snapshot queries. No single multiplier value satisfies both "allow one real hop" and "reject a two-hop cycle", because an attacker can always trade field count for hop count. `FixedComplexityLimit(500)` alone still bounds total query size. Same failure mode as the `Query.Transactions` page-size-multiplied complexity function removed in `08eee142` (over-rejected legitimate large single-page queries) — do not conflate the two or re-add either. `HistoricalNetWorth` caps sampled points at `wealth.MaxHistoricalNetWorthPoints` (400) and `BudgetReportHistory` caps distinct months at `budgets.maxBudgetReportHistoryMonths` (120), both returning a public error above the limit rather than truncating.
- **`plaidPFC2Codes: [String!]!`** (`Category`, `CategoryGroup`) is a deliberate scalar-list exception to the list-envelope (`items`) convention — it's a bare taxonomy field, not a paginated resource list. Do not wrap it in an envelope type; that would break the actively-used frontend query for no shape-consistency benefit.
- **`updateAccount` hidden toggle** — flipping `hidden` retroactively sets `is_hidden` on all existing transactions for that account (both directions).
- **Recurring flag is sync-owned** — `updateTransaction` can set `isRecurring`, but each Plaid recurring sync re-derives `is_recurring` from active charge associations (`MarkRecurringFromStreams`), overwriting manual edits. There is no per-transaction permanent suppression and no `dismissRecurring` mutation.
- **Owners** — stored in SQLite with stable IDs; every mutation accepting an owner must validate the ID against `owners`.
- **Wealth-owned Account extensions** — fields defined by `wealth.graphql` use explicit `accountWealth*` names and are resolved in graph/wealth code; keep `internal/accounts` ignorant of wealth asset details.
- **Custom scalars** — `Date` → Go `string` (`YYYY-MM-DD`); `DateTime` → `time.Time` (RFC 3339). Bare `YYYY-MM-DD` from Plaid/CSV normalizes to `YYYY-MM-DDT12:00:00Z` to avoid timezone day rollbacks.
- After editing `../schema/*.graphql`, run `make generate`. Never hand-edit `generated.go`, `models_gen.go`, or `dbgen/`. Resolvers are split per domain (`accounts.resolvers.go`, `resolver_*.go`).

## Coding Conventions

- Go files stay under ~300 lines (generated exempt); split by responsibility. `internal/` for all non-main packages; `cmd/**/main.go` stays minimal.
- Errors: `fmt.Errorf("operation: %w", err)`. Return GraphQL errors via gqlgen, not panics. **Loud failure beats silent** — return an error rather than swallowing it as nil/zero.
- Logging: `log/slog`. `Info` sync results, `Error` failures, `Debug` SQL/Plaid responses.
- SQL: all queries — static CRUD/upserts/reports and dynamic transaction-like reads alike — live in `internal/database/queries/*.sql` (sqlc, `make generate-sql`); dynamic reads use the `-- :if @param` dynamic-filter plugin for optional predicates, ORDER BY, and joins. Wrap multi-step mutations in a transaction (`database.BaseStore.WithTx`).
- Stored datetimes are RFC3339; never compare a stored datetime column to SQLite `datetime('now', ...)`. Use `strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ...)` so string comparisons use the same format.
- sqlc must generate concrete types, never `interface{}` — wrap bare aggregates in `CAST(... AS TEXT)` (`CAST(COALESCE(AGG(...), '') AS TEXT)` when nullable). Verify `dbgen/` signatures after editing.
- **Use sqlc dynamic omission for optional predicates.** Annotate a complete predicate or block with `-- :if @param` instead of a disabled-OR expression such as `(@filter_x = 0 OR indexed_column = @x)`. The omitted path does not bind the parameter, so SQLite can plan the active indexed lookup directly. Optional scalar params are pointers; optional `sqlc.slice` params are direct slices (nil **or empty** disables the filter — no `len > 0` coercion needed), never JSON strings or sentinels. Beware the flip side: an empty slice no longer means "match nothing", so keep `len == 0` early returns where empty input must not become an unfiltered query (e.g. `AssetsByIDs`, `ClearStagedForLLMByIDs`).
- **sqlc (pinned SQLite engine) does not parse `ON CONFLICT ... DO UPDATE SET ... [WHERE ...]` at all** — its SQLite AST converter never visits the upsert clause, so any `@param`/`sqlc.arg()` written inside a `DO UPDATE SET` assignment or its trailing `WHERE` guard is silently dropped from the generated `Params` struct (confirmed against `sqlc-dev/sqlc@v1.31.1`'s `internal/engine/sqlite/convert.go`, which has zero references to the upsert grammar node). `excluded.<col>` references inside `DO UPDATE SET` are fine (plain column refs, no binding needed) — only *new* bound parameters in that clause are invisible. A conditional upsert (insert-or-update-only-if-flag) needs two plain queries instead: an insert with a real conflict action (`DO NOTHING`/`DO UPDATE`) plus a separate ordinary `UPDATE ... WHERE` for the other branch, dispatched in Go on `sql.ErrNoRows` (see `transactions.sql`'s `InsertTransaction` / `UpdateTransactionBySourceExternalID`).
- All category SELECTs use the shared `categoryColumns` constant and JOIN `category_groups`.
- Thread `context.Context` through resolvers, DB, and API client calls.
- Prefer `lo.Ternary(cond, a, b)` over one-line if/else helpers; `lo.EmptyableToPtr(value)` for optional string pointers.
- **No manual `make` + `for` + append/assign collection loops** — use the matching `lo`/`u` helper: `u.Map` (`lo.FilterMap` when items can be skipped), `lo.Associate`, `lo.GroupByMap`, `lo.FilterSliceToMap`, `lo.MapValues`, `lo.MapToSlice`.
- Mapper funcs for `u.Map`/`lo.*`: shared across call sites → named function; used once → assign to a local variable first (`fromRow := func(row T) U {...}; return u.Map(rows, fromRow)`), never inline the literal.
- **One canonical row mapper per model** — when sqlc generates near-identical row structs, convert the variant to the canonical row struct by field name and delegate to the single `xFromRow` mapper.
- **Never hand-roll the sqlc result scaffold** — `internal/database/dbutil` owns it. A store method that queries and maps is two lines: `rows, err := s.q.X(ctx, params)` then `return dbutil.MapRows(rows, err, xFromRow)`. Use `MapRow` for single-row lookups (`sql.ErrNoRows` → zero value + nil error, the house "not found is not an error" convention), `AssociateRows`/`GroupRows` for map results. Do **not** convert sites that wrap the error, return a sentinel, or branch further — those keep their explicit form on purpose.
- Functions returning >3 values wrap them in a named `<Purpose>Result` struct; signature becomes `(ResultType, error)`.
- Type constraints over `any`: for a fixed set of concrete types, define a union constraint. Fix `interface{}` at the source.
- Default to exporting an interface over a struct unless a struct/pointer is genuinely needed.
- Test naming: DB-backed tests (open SQLite, run migrations/seeds, compose real stores) are `*_integration_test.go`; pure unit tests are `*_test.go`. No tests under `cmd/`.
- Test logging: `internal/utils/test.Logger` (or `internal/utils/nooplog.Logger` for packages that would import-cycle). No ad-hoc discard loggers, no production nil-logger fallbacks. A `slog.New(...)` in a test is only justified when the test asserts on captured log output.
- **Check `internal/utils/test` before writing a fake or fixture helper.** It already provides `PlaidClientStub` (function-field stub for the whole `clients.PlaidClient` surface — set only the methods your test needs), `AccountBase`, `DateTime`, `ScheduleFake` (embeddable balance-sync schedule fake), `CategoryIDByName`, `SeedPlaidAccount`/`SeedPlaidItem`, and `OwnerByName`. Five separate hand-rolled Plaid client fakes accumulated before this was centralized.
- **Collapse fixture scaffold, never assertions.** A repeated `call + if err != nil { t.Fatalf }` pair belongs in a local `mustX(t, …)` helper (`t.Helper()` required); a repeated status/decode check belongs in an `assertStatus`/`decodeJSON` helper. Calls that are the *operation under test* — especially error-path calls — stay inline.
- **A test must isolate the condition it names.** Assert a specific error only from a state where that error is the *only* possible cause. A test that asserted "invitations are not configured" while passing a nonexistent user ID passed for the wrong reason and pinned an incidental guard ordering.
- **Backend work is done only when `make check-codegen`, `make lint`, `make deadcode`, and `make coverage` pass** — `go test ./...` alone is not enough.

## Nil Checks & Invariants

A nil check is justified only when it (a) validates **untrusted input at a boundary** or (b) models a deliberate, documented **optional state**. A nil check that silently handles a "can't happen" state is a design smell.

- **Dependencies are construction-time invariants — never nil-check them in methods.** Collaborators are fixed when wired in `cmd/tallyo/main.go`. Fail fast at the init site, not three layers down.
- **Model "sometimes unavailable" with a Null Object, not propagated nil.** Use a no-op implementation when a collaborator is optional instead of spreading nil checks through callers. **Never type-assert on the null type** (`if _, off := s.X.(disabledX); off`) — that reintroduces the nil check it replaced and couples the caller to the null implementation. Callers invoke the method unconditionally; if the disabled case must error, the null object returns that error itself (`admin.disabledInviter`).
- **Loggers are always non-nil.** No `if log != nil`, no `slog.Default()` fallbacks. Inject a real logger in production and `test.Logger`/`nooplog.Logger` in tests.
- **Validate request-scoped data once at the transport boundary, then trust it.** Optional value fields backed by nullable columns (`*string`, `*float64`) are the legitimate exception.
- **Tests must establish the same invariants production does.** Provide every collaborator so production code can assume non-nil.

## Refactoring Boundaries

Repeated structural audits have converged on these. Re-flagging them wastes a pass.

- **Deliberate duplication, do not "fix":** the cross-domain twins `admin/db/users.go` ↔ `auth/authdb/auth.go` (`RevokeUserTokens`, `UserExists`) and `portfolio/db/analysis.go` ↔ `wealth/db/holdings.go` (Asset construction) — a little copying beats a new dependency edge between sibling domains; the gqlgen stub → `Resolver` delegation (`Resolver` is the shared surface `internal/mcpserver` consumes); the resolver payload-wrapper shape; per-request dataloader closures; sqlc **params**-struct construction (distinct generated types — only the *result* side is shared via `dbutil`); rebuild-by-name mapper variants; `mcpserver/tools.go`'s per-tool shape (a generic reply helper measures line-neutral once the no-inlined-closure rule is honored); `Crypto` vs `Cryptocurrency` label sets; Plaid's empty-holdings carry-forward path.
- **Extracting a helper is not free.** Judge it on total lines *including* the helper and the named mapper the conventions require. Several candidates here are line-neutral or worse.
- **Splitting a 300–400 line file that is already cohesive adds lines** (package header + imports) for no gain. The ~300-line guideline targets files doing several unrelated jobs, not long cohesive ones.
- **No positional booleans in a shared helper**, and never on a security path. Group them into a named-field struct (`auth.tokenSessionKind`) — a transposed `activeOnly` flag silently changes token validation and the compiler cannot catch it.
- **Behavior-preserving means byte-preserving** for error strings, expiries, token lengths, scope intersections, and validation order. Consolidating two near-identical functions is fine; letting their observable output drift is not.

## Common Pitfalls

- **Plaid transaction ID instability**: IDs can be retired/replaced — always upsert. A removed+added pair for the same charge may not arrive in the same cycle.
- **SQLite concurrent writes**: WAL, single `*sql.DB`, 30s busy timeout. One-off syncs (e.g. from `exchangePublicToken`) must not deadlock with the background loops.
- **Multiple Plaid clients**: created fresh per operation from the credential row (`internal/utils/plaidfactory/`). No global client at startup.
- **Link update mode**: `CompleteLinkUpdate` does NOT exchange a public token (update mode returns none); it re-syncs to verify health. `CreateUpdateLinkToken` omits `products` for login repair. `ExchangePublicToken` upserts on `item_id` (handles re-linking).
- **Hidden accounts**: new transactions auto-marked `is_hidden = 1`; on modify, the user's `is_hidden` is preserved. **Closed accounts** (`is_closed`) still sync transactions, but balance snapshots stop at closure.
- **`query_diagnostics.go`'s custom connector/`ExecContext` is load-bearing, not over-build**: the ncruces driver's Go trace callback fires only for Go-prepared statements (it resolves the stmt handle against `Conn.stmts`), so statements run via C-level `sqlite3_exec` — the driver's default zero-arg `ExecContext` path — are invisible to `TRACE_PROFILE`. The wrapper reroutes zero-arg execs through Go `Prepare` so full-scan warnings fire; deleting it in favor of the driver's plain init hook silently kills diagnostics for those paths (the integration test pins this).

## Development Commands

```bash
# From server/
make generate          # gqlgen + sqlc — after editing ../schema/*.graphql or queries/*.sql
make check-codegen    # fail if make generate changes generated output; required before "done"
make sync-web          # populate server/web/dist from ../web/dist (before go run / coverage)
go run ./cmd/tallyo    # run locally
make lint              # golangci-lint (make lint-fix to autofix)
make deadcode          # deadcode -test ./...; required before "done"
make coverage          # race-enabled tests + coverage gate — required before "done"
make test-all          # codegen + sqlc vet + deadcode + coverage gate

# From repo root
docker build -t tallyo .
```

Sandbox instance instructions are in [README.md](README.md#sandbox-instance). When the base URL changes (port, ngrok, LAN IP), three places must match exactly: `oauth_issuer_url` (drives the Google redirect URI and JWT `iss`/`aud`), `frontend_redirect_uris` (Fosite enforces exact match), and the Google Cloud Console authorized redirect URIs (must be a real domain, not a bare IP).
