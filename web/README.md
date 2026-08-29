# Tallyo Web

React single-page app for [Tallyo](../README.md). In production it is compiled to static files and embedded into the Go `tallyo` binary — there is no separate web container. It's also a full PWA: installable on desktop and mobile, auto-updating via a service worker, with financial data always fetched live (never cached offline).

## Table of Contents

- [Tech Stack](#tech-stack)
- [Setup](#setup)
  - [Environment variables](#environment-variables)
- [GraphQL Types Are Generated](#graphql-types-are-generated)
- [Project Structure](#project-structure)
- [Permissions in the UI](#permissions-in-the-ui)
- [Testing](#testing)
- [Quality Checks](#quality-checks)
- [Contributing](#contributing)

## Tech Stack

- **Framework:** React 19 + Vite + TypeScript (strict)
- **GraphQL client:** urql with graphcache
- **Routing:** React Router v8
- **Charts:** Recharts
- **Styling:** Tailwind CSS
- **PWA:** vite-plugin-pwa (auto-update service worker, web manifest)
- **Tests:** Vitest, React Testing Library, MSW, Playwright

Authentication is OAuth authorization-code + PKCE against the Go server's built-in OAuth provider. Access tokens stay in memory; refresh tokens in `localStorage`. Sign-in methods (Google, email OTP/magic link, passkeys, API key) are discovered at runtime from the backend's `/auth/config`.

## Setup

Use Node.js 24 with npm 11 (pinned in `.nvmrc`, `.node-version`, and `package.json` `engines`; `mise` picks it up from `mise.toml`).

```bash
npm ci
npm run dev
```

The dev server proxies all API paths (`/query`, `/auth`, `/authorize`, `/token`, `/transactions/*`, …) to a locally running Go server at `http://localhost:8082` — override with `VITE_DEV_API_TARGET`. See [../server/README.md](../server/README.md) for running the backend.

To iterate on UI without a backend at all:

```bash
npm run dev:stub
```

Stub mode serves fixture data through MSW browser handlers (`src/mocks/`) and seeds an all-scopes token so every authenticated route is reachable.

### Demo build

```bash
npm run build:demo
```

Builds the same stub-mode app as a static site for GitHub Pages (`.github/workflows/pages.yml` deploys it to [orlandoc01.github.io/tallyo](https://orlandoc01.github.io/tallyo/) on every published release). Differences from `npm run build`: `--mode demo` (a richer, generated demo dataset in `src/mocks/` and a persistent demo banner), Vite `base` from `BASE_PATH` (default `/tallyo/`), still installable via its own manifest but without the workbox service worker (MSW's `mockServiceWorker.js` owns the scope instead, so there is no offline precache), and `dist/404.html` + `dist/.nojekyll` for SPA deep links. Preview it locally with `BASE_PATH=/tallyo/ npx vite preview` and open `http://localhost:4173/tallyo/`.

### Environment variables

Vite env vars are baked in at build time; only `VITE_`-prefixed vars reach the client.

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_API_URL` | `/query` | GraphQL endpoint. The default is correct for the embedded production build and the dev proxy; set it only when pointing at a remote API |
| `VITE_DEV_API_TARGET` | `http://localhost:8082` | Dev-server proxy target |
| `VITE_APP_VERSION` | *(unset)* | Optional semver shown on the login screen and Settings page; set by the release workflow |
| `BASE_PATH` | `/` | Vite `base` for hosting under a sub-path; `build:demo` defaults it to `/tallyo/` |

## GraphQL Types Are Generated

[`../schema/*.graphql`](../schema) is the single source of truth. `npm run generate` produces `schema.json` and `src/types/graphql.ts` — never edit that file by hand. `dev`, `build`, `typecheck`, and `test:coverage` all regenerate automatically via pre-scripts, so after a schema change you just rerun whatever you were doing. Frontend-only types live in `src/types/domain.ts`.

Contract conventions the UI relies on:

- List queries return envelope types (`{ items: [...] }`), never bare arrays.
- Multi-argument operations take a single `input` object.
- Union fields need inline fragments; account wealth property data is queried through `accountWealthProperty { __typename ... }`.
- `transactions` uses Relay-style cursor pagination (forward-only).
- Amount signs follow Plaid: positive = spent (`$123.45`), negative = refund/credit (`+$52.12`, green). Never flip signs client-side.
- Bare `YYYY-MM-DD` dates are parsed as local time (`new Date(y, m - 1, d)`) to avoid off-by-one-day rendering.

CSV import/export are REST (`POST /transactions/import`, `GET /transactions/export`) — always called through `authorizedFetch` from `src/auth/tokenStore.ts`, like every other REST call.

## Project Structure

```
src/
├── main.tsx, App.tsx     # entry + routes (authenticated routes render under AppShell)
├── graphql/              # urql client + graphcache config, all query/mutation documents
├── types/                # graphql.ts (GENERATED) + domain.ts (frontend-only)
├── auth/                 # PKCE flow, token store, email/webauthn helpers, scope parsing
├── hooks/                # data hooks over urql; usePermissions (canRead/canWrite)
├── components/           # by domain: layout, reports, transactions, categories,
│                         #   institutions, budgets, portfolio, wealth, settings, common
├── pages/                # route-level pages (Reports, Net Worth, Portfolio, Cash Flow,
│                         #   Budgets, Transactions, Review, Recurring, Accounts, Settings)
├── mocks/                # MSW handlers + fixtures (stub mode and tests)
└── utils/                # currency, dates, colors, api base URL, CSV export
```

## Permissions in the UI

The JWT's `scope` claim (`read:<resource>` / `write:<resource>`, derived from the user's role) drives what renders:

```tsx
const { canRead, canWrite } = usePermissions()

{canWrite('transactions') && <EditButton />}
{canRead('cashflow') && <NavLink to="/cash-flow">Cash Flow</NavLink>}
```

The frontend only decodes the JWT payload to hide controls — the backend re-enforces scopes on every request. `User.role` appears solely in the Access tab (badge + invite dropdown); all other gating uses scopes.

Backend `disableTransactionTracking` and `disableWealthTracking` runtime toggles also hide matching route groups. They are not UI-only preferences: the server uses the same settings to pause transaction/recurring and wealth background pollers.

## Testing

```bash
npm run test:coverage   # ALWAYS use this — enforces coverage thresholds (~81%)
npm run test:e2e        # Playwright smoke test
npm run test:watch      # explicit watch mode while developing
```

Never run bare `vitest`/`npx vitest` — it starts watch mode and hangs non-interactive shells. Component tests use MSW request interception rather than mocking urql. One JSDOM gotcha: `TransactionList` renders its desktop table and mobile list simultaneously (CSS hides one, JSDOM doesn't), so shared text needs `getAllBy*` queries.

If Playwright's browser isn't installed yet: `npx playwright install chromium`.

## Quality Checks

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint
npm run build       # production build (typecheck + vite build + PWA assets)
npm run preview     # serve the production build locally
```

## Contributing

- Strict TypeScript — no `any` unless genuinely unavoidable.
- Functional components and hooks only; prefer named exports.
- Tailwind utilities in JSX; no separate CSS files.
- No inline GraphQL — all documents live in `src/graphql/`.
- Split components around ~200 lines; every data hook handles loading, error, and empty states.
- Accessibility: semantic HTML, keyboard-reachable interactive elements.

CI runs `typecheck`, `lint`, and `test:coverage` on every PR; the coverage gate fails the build below the thresholds. `AGENTS.md` in this directory is the exhaustive contributor/agent reference (routing table, caching rules, UI gotchas) — read it before larger changes.
