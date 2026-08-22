# Contributing to Tallyo

Tallyo is a self-hosted personal finance tracker built first for one household and shared as-is for people with similar needs. Contributions are welcome, but this is a solo-maintained project and review time is best-effort.

## Before You Start

- Use issues for bug reports, feature requests, and design discussion.
- Open an issue before starting a large change, schema change, new integration, or broad refactor.
- Keep pull requests focused. Small, reviewable changes are much more likely to be merged.
- Do not include secrets, access tokens, Plaid credentials, account numbers, real transaction data, emails, or other private financial details in issues, logs, screenshots, fixtures, or tests.

Unsolicited large pull requests may not be reviewed or merged, even when the code works, if they do not fit the maintainer's current goals or capacity.

## Development Setup

Read the subsystem notes before making changes:

- `AGENTS.md` for repository layout and shared GraphQL schema notes.
- `server/AGENTS.md` for backend architecture, invariants, and Go commands.
- `web/AGENTS.md` for frontend architecture, routes, and React/TypeScript commands.

Install dependencies from the repository root:

```bash
go mod download
cd web && npm ci
```

The frontend pins Node.js 24 and npm 11 in `web/.nvmrc`, `web/.node-version`, and `web/package.json`. If your shell is not using that version, switch before running web commands.

## Running Locally

Run the backend from `server/`:

```bash
go run ./cmd/tallyo
```

Run the frontend from `web/` during UI development:

```bash
npm run dev
```

The production image builds the frontend first, then embeds `web/dist` into the Go `tallyo` binary.

## Testing and Quality Gates

Run the checks relevant to the files you touched.

For backend or schema work from `server/`:

```bash
make coverage
```

For frontend work from `web/`:

```bash
npm run test:coverage
npm run lint
npm run typecheck
```

For full container validation from the repository root:

```bash
docker build -t tallyo .
```

If you cannot run a relevant check, say so in the pull request and explain why.

## GraphQL Workflow

The shared GraphQL schema lives in `schema/*.graphql` and is the source of truth for both the Go server and React client.

- Update schema files first when changing the API contract.
- Run `go generate ./...` from `server/` after schema changes.
- Run `npm run generate` from `web/` to refresh frontend schema artifacts.
- Do not hand-edit generated files such as `server/internal/graph/generated.go`, `server/internal/graph/model/models_gen.go`, or `web/src/types/graphql.ts`.

Every GraphQL query and mutation takes exactly one argument, either a scalar or an input object. List queries return envelope objects such as `{ items: [...] }` for forward compatibility.

## Code Style

Follow the conventions documented in `server/AGENTS.md` and `web/AGENTS.md`. A few high-level expectations:

- Keep changes small and cohesive.
- Prefer clear, direct code over broad abstractions.
- Preserve the existing schema-first GraphQL patterns.
- Keep secrets and personally identifiable financial data out of tests and docs.
- Add or update tests when behavior changes.
- Update documentation when setup, configuration, commands, or user-visible behavior changes.

## Pull Request Checklist

Before opening a pull request, confirm that:

- The change is scoped to one concern.
- Tests or checks relevant to the change pass.
- Generated files are refreshed when schema or code generation inputs changed.
- Documentation is updated when needed.
- No secrets, credentials, private URLs, LAN addresses, real financial data, or personally identifiable data are included.

By contributing, you agree that your contribution is licensed under the [Apache License, Version 2.0](LICENSE), the license of this repository.
