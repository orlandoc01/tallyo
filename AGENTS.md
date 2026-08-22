# AGENTS.md

This repository contains two independently documented subsystems:

- **`server/`** — Go `tallyo` binary: GraphQL API, OAuth 2.1, Plaid/SimpleFIN/crypto sync loops, MCP, embedded SPA.
  See [server/AGENTS.md](server/AGENTS.md) (invariants, decisions, pitfalls) and [server/README.md](server/README.md) (stack, layout, commands).
- **`web/`** — React/TypeScript SPA + PWA frontend.
  See [web/AGENTS.md](web/AGENTS.md) and [web/README.md](web/README.md).

**`schema/`** at the repository root houses the shared GraphQL schema — the API contract source of truth, split by domain:

- base.graphql — scalars, directives, `Node` interface, shared primitives
- transactions.graphql — transactions, categories, rules, tags, spending, cash flow, recurring
- accounts.graphql — accounts, connections (Plaid / SimpleFIN / EVM wallets), owners, link flow
- wealth.graphql — assets, holdings, snapshots, net worth, manual holdings/liabilities, wealth-owned Account extensions
- budgets.graphql — budgets and budget reports
- portfolio.graphql — portfolio analysis views (composition, Morningstar category/group, sectors)
- admin.graphql — users, roles, runtime configuration

**`Dockerfile`** at the repository root builds the release image from GoReleaser-built binaries.

Runtime general settings for disabling transaction or wealth tracking affect both subsystems: the web app hides matching routes, and the server skips the matching background pollers.

## Code Comments

Don't write doc comments that restate what a function's name or body already
says — a private helper with a self-explanatory name (`normalizeEmail`) needs
none. Comment only non-obvious constraints the code can't express.

## Environment Setup

Each subsystem may pin a specific Node.js version. Before running `web/` commands, verify `node --version` matches `web/.nvmrc`. If it doesn't, prefix all `web/` commands with `mise exec --` (e.g. `mise exec -- npm run test:coverage`) so mise picks up the pinned version from `web/mise.toml` without requiring shell re-activation.

Server tests should live under `server/internal/` packages. Do not add tests under `server/cmd/`.
`server/cmd/**/main.go` files should stay minimal: bootstrap configuration, wire dependencies, and run the application. Move application logic into `server/internal/` packages.
