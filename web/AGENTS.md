# AGENTS.md — tallyo-web

Agent/contributor reference for `web/`: routing, caching rules, and UI gotchas that aren't obvious from the code. Tech stack, setup, environment variables, and commands live in [README.md](README.md) — read that first.

React SPA + PWA for a self-hosted household finance tracker; compiled to static files and embedded into the Go `tallyo` binary (`../server/`, see `server/AGENTS.md`). The shared GraphQL schema is `../schema/*.graphql`. Auth is OAuth authorization-code + PKCE against the server's built-in provider. Owners, sign-in methods, and feature toggles are configured on the backend and fetched at runtime — never hardcoded.

## Directory Layout

```
src/
├── main.tsx, App.tsx     # entry + all routes (authenticated routes render under AppShell)
├── routes.ts             # route path groups, shared by App.tsx and the page tests
├── graphql/              # urql client + graphcache (cache/ = update helpers by domain),
│                         #   queries.ts, mutations.ts, schema.json (generated)
├── types/                # graphql.ts (GENERATED — never edit) + domain.ts (frontend-only)
├── auth/                 # AuthContext, oauth.ts (PKCE), tokenStore.ts (in-mem access +
│                         #   localStorage refresh, authorizedFetch), emailAuth, webauthn,
│                         #   permissions.ts (parseScopesFromToken)
├── hooks/                # data hooks over urql (useTransactions, useNetWorth, useBudgets, …)
│                         #   built on useListQuery; useEntityQueries holds the simple list
│                         #   hooks (accounts, owners, tags, categories, connections, …);
│                         #   URL param state (urlParams codecs + useQueryParamState +
│                         #   use*FilterParams over useReportFilterParamCore);
│                         #   useMobileHeaderActions, useNormalizeTabParam;
│                         #   NavLayout/SectionHistory providers, useIdleTimeout, useIsMobile
├── components/           # by domain: layout, reports, transactions (incl. rules + tags),
│                         #   categories, institutions, budgets, portfolio, wealth, settings, common
│                         #   common/FormControls.tsx holds the shared form/display primitives
├── pages/                # route-level pages + setup/ (first-run wizard steps)
├── mocks/                # MSW: server.ts (tests), browser.ts (dev:stub), handlers, fixtures
├── test/                 # renderWithProviders + location probes (test-only, coverage-excluded)
├── styles/
└── utils/                # currency, amount, dates, colors/chart styles, accountGroups,
                          #   apiUrl (getApiBaseUrl), export (CSV via REST)
```

## Pages and Routes

All authenticated routes render under `AppShell`. The landing route `/` and unknown paths redirect to a default derived from the user's scopes plus the backend `disableTransactionTracking`/`disableWealthTracking` toggles; those toggles also gate whole route groups (transaction pages vs. wealth pages). They are server-backed tracking controls too, not UI-only flags: the backend pauses transaction/recurring and wealth background pollers when enabled.

| Route | Page |
|---|---|
| `/expenses` → `/expenses/:tab` | ReportsPage (`tab`: `breakdown`, `trends`, `comparison`) |
| `/net-worth[/accounts/:account_id[/:account_tab]]`, `/net-worth/assets/:asset_id[/:asset_tab]` | NetWorthPage |
| `/portfolio[/assets/:asset_id[/:asset_tab]]` | PortfolioPage |
| `/cash-flow` | CashFlowPage |
| `/budgets` → `/budgets/:month` | BudgetPage (`month`: `YYYY-MM`) |
| `/transactions[/:transaction_id]` | TransactionsPage |
| `/review` → `/review/:tab`, `/review/assets/:asset_id[/:asset_tab]` | ReviewPage (`tab`: `transactions`, `accounts`, `balances`, `assets`; default = first tab the user's write scopes allow) |
| `/recurring` | RecurringPage |
| `/accounts[/:account_id[/:account_tab]]` | AccountsPage |
| `/settings[/:tab]`, `/settings/rules/:rule_id`, `/settings/assets/:asset_id[/:asset_tab]` | SettingsPage (tabs: `general`, `access`, `configuration`, `ai-integration`, `tags`, `connections`, `security`, `categories`, `rules`, `assets`) |
| `/rules`, `/categories`, `/access` | → redirect into the matching `/settings/*` tab |

Outside `AppShell`: the bootstrap paths `/auth/callback`, `/auth/email-challenge`, `/auth/login`, and the first-run wizard `/setup/{welcome,security,password-setup,oauth-setup,register,owners,connections,complete}`.

## Key Gotchas and Decisions

- **Amount sign:** positive = spent, negative = refund/credit (Plaid convention, kept by the backend). Display positive → `$123.45`, negative → `+$52.12` (green). Never flip signs in the frontend.
- **`Transaction.category` is never null** (`Category!`); unclassified = ID `0`. Don't null-check it. ID `0` is editable in the Categories UI but deletion stays disabled.
- **Date parsing:** backend returns `YYYY-MM-DD` (no tz). Parse as local: `new Date(year, month - 1, day)`. `new Date("2026-05-14")` is UTC midnight and shows as the previous day in US timezones.
- **Transfer/income exclusion is server-enforced:** `spendingByCategory` excludes both (Reports); `cashFlow` excludes transfers, keeps income (Cash Flow); `transactions` excludes nothing. Use the right query per page; don't re-filter by `kind` in rendering.
- **Cursor pagination:** `transactions` uses Relay cursors (`endCursor`, `hasNextPage`), forward-only — not offset/limit.
- **Access control = JWT scopes, not `role`:** gate everything via `canRead`/`canWrite` from `usePermissions()`. `User.role` is used **only** in the Access tab (badge + invite dropdown). Keep gates narrow: `read:spending` gates only the Reports nav, `read:cashflow` only Cash Flow, `read:wealth` Net Worth, `read:portfolio` `/portfolio`, `read:budgets` Budgets; `write:wealth`/`write:assets` gate the Review balances/assets tabs. A SPEND_TRACKER sees charts but not the raw transaction list (`read:transactions` gates that independently).
- **Cache updates over refetching:** graphcache update/invalidation helpers live in `src/graphql/cache/` split by domain (shared, transactions, accounts, categories, rules, budgets). Extend those after adding a mutation rather than sprinkling manual refetches. Invalidate through the **named groups** in `cache/shared.ts` (`invalidateRoots(cache, ...TRANSACTION_ROOTS)`) rather than listing root fields per mutation — a new derived query then gets picked up everywhere instead of at ten separate call sites.
- **Mobile dual-view tests:** `TransactionList` renders desktop table + mobile div list simultaneously (CSS hides one; JSDOM ignores CSS). Use `getAllBy*` for shared text/roles and adjust `toHaveLength`.
- **Closed vs hidden accounts:** Closed (`account.closed`) appears everywhere greyed with `(CLOSED)`. Hidden (`account.hidden`) shows only on the Institutions page; the backend filters its transactions out of other queries — no client filtering needed.
- **Plaid Link:** never reuse a `linkToken`; call `createLinkToken` on each Add Account. If `plaidCredentials` returns exactly one credential, auto-select and skip the picker.
- **Import/Export is REST:** `POST /transactions/import`, `GET /transactions/export` — always through `authorizedFetch` (`src/auth/tokenStore.ts`), like every other REST call (WebAuthn credential management included).
- **Rule creation prompt:** after a successful categorization of a transaction with a `merchantName`, `CreateRuleModal` offers "Always categorize [merchant] as [category]?" — confirm calls `createRule` with `merchantPattern` = merchant name and `applyRetroactively: true`. In `EditRuleModal`, `applyRetroactively` defaults to `false` (opt-in).
- **Two-step delete confirmation:** first click shows "Confirm delete", second executes (category/rule modals).
- **No orphan UI:** the backend no longer detects orphans — no orphan sections/filters/warnings anywhere. Review shows only unreviewed transactions.
- **Free-text search is never debounced:** results narrow and the URL updates on every keystroke. The keystroke that takes a param from empty to non-empty pushes one history entry; later edits use `replace` (`useQueryParamState`), so Back returns to the pre-search URL. Timer-based URL commits caused races with filter clicks — do not reintroduce them. Other filters (category, account, owner) persist immediately as pushes. This holds on **every** page including Rules; a 2 s debounce there was removed for violating it.
- **URL params go through the codec:** declare each param once in `src/hooks/urlParams.ts` (`listParam`, `enumParam`, `stringParam`, `numberParam`, `boolParam`) and let the getters, setters, `setMany` and `clear` derive from that record. Do not hand-roll a parse/serialise pair, and do not add a `VALID_X.has(...) ? ... : 'DEFAULT'` cast — `enumParam` returns the narrow type. The transaction filter schema used to be spelled out in six places, which is how the `untagged` filter silently shipped broken.
- **Sticky nav section history:** `section-history-v1` in `localStorage` remembers the last full URL per sticky section (`sectionHistory.ts`). Like `tallyo-last-email`, it is preserved across logout (logout removes only targeted auth keys).
- **Drag-and-drop:** `@dnd-kit` handles category reorder within a group, with optimistic local state that resets to server state on error.
- **Idle logout:** the app signs out after 15 min of inactivity (warning at 14 — `useIdleTimeout.ts`).
- **Never add password fields to `AuthGate`** — sign-in methods come from the backend's `/auth/config` (Google, email OTP/magic link, passkeys, master-password API key).
- **PKCE state lives in `localStorage`** (not `sessionStorage`) so a magic-link callback opened in a new tab can complete the token exchange.
- **Vite env vars are build-time:** only `VITE_`-prefixed vars reach the client (rebuild to change).

## Testing

- **Always `npm run test:coverage`** — never bare `vitest`/`npx vitest` (watch mode hangs non-interactive shells). The coverage gate fails below the threshold.
- **Render through `renderWithProviders`** (`src/test/`) — it owns the provider nesting (urql `Provider` → `MemoryRouter` → `AuthContext` → `MobileHeaderProvider`) plus the `LocationDisplay`/`LocationSearch`/`LocationPathname` probes. Opt in per test with `withGraphql`, `withMobileHeader`, `auth`, `initialEntries`, `probes`. Every test file previously hand-rolled this stack; don't start a new one. `src/test/**` is coverage-excluded.
- **Route paths come from `src/routes.ts`** — page tests import the same path groups `App.tsx` renders, so a route added in one place cannot drift from the other.
- Component tests use MSW request interception (`src/mocks/`) rather than mocking urql; the same fixtures power `npm run dev:stub`. A handful of older tests still mock `urql` directly — they share one shape via `src/test/urql.ts`; prefer MSW for new tests rather than adding to that set.
- **Shared test mocks live in `src/test/`** — `permissions.ts` (the allow-everything `usePermissions` stub, used by ~20 files) and `urql.ts`. Note that Vitest hoists `vi.mock` above imports, so these are lazy-imported *inside* the factory; a directly imported factory throws a TDZ error. `fallow dead-code` can't trace that indirection, so both are listed in `.fallowrc.json`'s `ignoreExports`.
- **`fallow dupes` skips `*.test.*` files by default** — that hid ~30% of `web/src` (the whole test layer) from every earlier audit, where the largest duplication seams actually lived. Run `fallow dupes --explain-skipped` before concluding the repo is duplication-clean.
- `npm run test:e2e` runs the Playwright smoke test (`npx playwright install chromium` first if needed).
- Schema changes: `npm run generate` reruns automatically via pre-scripts on `dev`/`build`/`typecheck`/`test:coverage`.

## Coding Conventions

- **TypeScript strict** — no `any` unless genuinely unavoidable.
- **Functional components only** — hooks, no classes; named exports preferred.
- **Tailwind utilities in JSX** — no separate CSS files, but reach for the shared primitive before writing a class string. `common/FormControls.tsx` owns `TextField`, `SelectField`, `CheckboxField`, `FieldLabel`, `FormError`, `FormSuccess`, `SectionLabel` and `Card`; `common/Button.tsx` owns the button variants. Hand-rolling one more `rounded-xl border border-neutral-300 px-3 py-2 …` input is how this codebase ended up with ~62 copies of the same field and twenty different red banners. If a primitive is genuinely missing a case, add the variant there rather than a one-off at the call site.
- **No inline GraphQL** — all documents in `src/graphql/`.
- **Union fields** — include `__typename` and inline fragments; wealth-owned account property details come from `accountWealthProperty`.
- **Split components at ~300 lines** (enforced by ESLint `max-lines`).
- **Every query/mutation hook handles loading, error, and empty states** — render them with `<QueryGate>` (`src/components/common/`), which owns the retry closure, rather than re-writing the `fetching`/`error`/empty branch chain per component.
- **List queries go through `useListQuery`** (`src/hooks/`) — it returns one consistent shape and a stable empty array. Never default with an inline `?? []`; a fresh array identity each render defeats downstream `useMemo`/`useEffect` deps and `React.memo`.
- **Derive, don't sync.** State computable from props or other state is derived during render (wrap in `useMemo` only when identity must stay stable), never mirrored into a second `useState` and hand-synced with a `useEffect`. To reset a child's internal state when its input changes, remount it with `key={id}` rather than an effect that rewrites the initial values. The structural audits pulled out ~15 of these effect-synced blocks (owners, filters, snapshot editors, form drafts); each was a stale-state bug waiting to fire.
- **Accessibility** — semantic HTML, all interactive elements keyboard-accessible.
