# Frequently Asked Questions

## What is Tallyo?

Tallyo is a self-hosted household finance tracker. One server process serves the web/PWA, GraphQL and REST APIs, built-in OAuth provider, optional MCP endpoint, and background synchronization. It uses SQLite and does not require a separate database, cache, or queue.

## Where is my data stored?

The default Docker database is `/data/tallyo.db`; bare-metal installations should set `DB_PATH` to a persistent writable location. SQLite may create `-wal` and `-shm` sidecar files while running.

The database includes financial records and operational secrets such as provider access tokens, OAuth refresh tokens, and the JWT signing key. Protect the database, its volume, encryption key, and every backup. See [Security And Deployment Notes](security.md).

## Does all data stay on my server?

The primary database and application run on your server, but enabled integrations make outbound requests:

- Plaid and SimpleFIN supply account, transaction, balance, and holding data.
- Yahoo Finance receives ticker/quote and classification requests.
- DeBank receives a public EVM wallet address to obtain balances.
- A configured Ollama endpoint receives uncategorized transaction context and examples for categorization.
- An MCP client can receive financial data allowed by the user's granted scopes.
- The browser may request merchant or institution favicons from DuckDuckGo's icon service, disclosing the requested domain to that service.

Only enable providers and clients you trust. Tallyo does not need bank credentials for manual wealth tracking, but provider-backed synchronization necessarily communicates with that provider.

## Is Plaid required?

No. Plaid is optional and its credentials are configured in **Settings > Connections**. Tallyo can also use SimpleFIN for accounts and transactions, manual accounts and liabilities for wealth, real estate, and public-address EVM wallet tracking.

CSV transaction import exists for manual transaction files. It is not a full synchronization replacement for Plaid or SimpleFIN. See [CSV Transaction Import](csv-import.md).

## Is setting up a Plaid account free?

Plaid now documents a free Production [Trial plan](https://support.plaid.com/hc/en-us/articles/39994173227159-What-is-the-Plaid-Trial-plan) for eligible developers. The trial supports up to 10 live Production Items, which Tallyo treats as Plaid connections, per credential. That is enough for many households to set up their app without a paid Plaid plan.

Tallyo also supports multiple Plaid credentials, so other household members can sign up for their own eligible trial accounts and add those credentials under **Settings > Connections** if one credential's 10 connections are not enough.

## What can SimpleFIN do?

Tallyo claims a one-time SimpleFIN setup token and stores the resulting access URL as a write-only secret. It can sync accounts, balances, transactions, and limited holdings. SimpleFIN does not supply transaction categories, so rules, manual review, MCP use, or optional Ollama categorization are more important than with Plaid. See [SimpleFIN Setup](simplefin-setup.md).

Account type is inferred from account name, holdings, and balance sign. Review accounts that Tallyo flags as ambiguous. See [Troubleshooting](troubleshooting.md#simplefin-sync) for reset and sync behavior.

## Can I track accounts manually?

Yes. Tallyo supports manual holdings/liabilities and real-estate values, with periodic snapshots and Yahoo-backed pricing where configured. [EVM wallets](crypto-tracking.md) are read-only and require only a public address.

Manual wealth tracking is distinct from CSV transaction import. CSV imports can target accounts by the GraphQL/global account IDs returned by the API and CSV export.

## Can I export, edit, and re-import transactions?

Yes, with stable transaction IDs. Export writes the transaction's source namespace and stable external identifier in the `source` and `external_id` columns. Re-importing a row with a matching source and external ID updates that transaction instead of creating a duplicate.

Export also writes GraphQL/global account IDs in the `account_id` column, and import accepts those IDs. Legacy provider/external account IDs are still accepted, but raw local numeric database IDs are not. Import still has no preview or all-or-nothing transaction, so partial success is possible. Provider sync can later overwrite provider-owned fields on Plaid or SimpleFIN transactions. Read [CSV Transaction Import](csv-import.md) before using the endpoint.

## Can the SQLite database be encrypted?

Yes. Set a 64-hex-character key through `DB_ENCRYPTION_KEY_FILE` (preferred) or `DB_ENCRYPTION_KEY`. The key file takes precedence. Existing plaintext databases require the explicit one-shot `--encrypt-db` conversion; merely setting a key does not convert them.

The conversion leaves the original plaintext database at `<database-path>.bak`. Protect it. Losing the encryption key means losing access to the encrypted database. See [Troubleshooting](troubleshooting.md#database-encryption) for commands and failure modes.

## How should I back up Tallyo?

Use the built-in SQLite snapshot command instead of copying the live file:

```bash
docker compose exec -T tallyo /tallyo --backup-plain-data=/data/tallyo-backup.db
```

The result is plaintext even if the live database is encrypted and contains the same secrets as production. Move it to restricted encrypted storage and test restores with the matching application configuration. A Docker volume is persistence, not a complete backup strategy.

## How often does synchronization run?

Transaction synchronization is schedule-driven per connection:

- Plaid transaction default: `0 6,18 * * *`.
- SimpleFIN transaction default: `0 6,18 * * *`.
- Plaid recurring default: `0 12 * * 0`.

Those transaction cron expressions are evaluated in UTC. A scheduler checks due connections at startup and at minute 1 of every hour, so work runs on the next check after it becomes due rather than at exact cron precision. Plaid schedules can be edited for a connection, subject to server validation.

Default wealth balance schedules are evaluated in America/New_York: Plaid and SimpleFIN at `16:30` on weekdays, and manual accounts, real estate, and EVM wallets daily at `16:30`. The balance worker also checks hourly. Snapshot run dates are recorded in UTC.

`SYNC_OFF=true` prevents background workers from starting. Runtime transaction/wealth tracking toggles independently pause the corresponding due-work. See [Troubleshooting](troubleshooting.md#tracking-toggles-and-sync_off).

## Why are spending signs opposite from my bank statement?

Tallyo keeps Plaid's transaction convention:

- Positive means money spent.
- Negative means refund, credit, or money flowing in.

The UI formats negative refunds/credits as positive-looking green credits, but stored/API/CSV amounts keep the original sign.

## What do categories change in reports?

Every category belongs to a category group whose kind is `EXPENSE`, `INCOME`, or `TRANSFER`.

- Expense reports exclude income and transfers.
- Cash Flow excludes transfers but includes income, presenting income as positive for its summary.
- Raw transaction lists do not automatically exclude category kinds.
- Hidden transactions are excluded from normal reports.

Rules are evaluated before Plaid's category mapping for synced transactions. The highest-priority matching rule can assign a category/tags and change hidden or recurring state. Unmatched transactions use the built-in `uncategorized` category; optional Ollama processing can later categorize staged synced transactions.

## Why are reports or net worth missing data?

Check the selected date range, owner/account filters, category group kind, hidden state, instance timezone, provider last-sync state, `SYNC_OFF`, tracking toggles, and the user's scopes. Hidden accounts are excluded from wealth views, and their transactions are hidden from normal reports. Transactions currently staged for Ollama are excluded from spending/cash-flow calculations.

Net worth requires balance snapshots. Portfolio analysis additionally requires supported holdings plus successful quote/classification data. Follow [Troubleshooting](troubleshooting.md#reports-categories-and-wealth).

## Can I turn off transaction or wealth tracking?

Yes. **Settings > General** has independent runtime toggles:

- Disable transaction tracking hides transaction-related routes and pauses scheduled transaction/recurring due-work.
- Disable wealth tracking hides wealth routes and pauses scheduled balance/portfolio due-work.

These are server-backed controls, not only navigation preferences. `SYNC_OFF` is a separate startup-wide switch for all background sync workers. These controls do not describe or promise data deletion.

## What is the difference between owners and users?

Owners are household members to whom accounts and financial data are attributed. Users are identities allowed to sign in. They are separate concepts: a household can track an owner who does not have a login, and a user role controls access rather than ownership of records.

Admins manage users under **Settings > Access**. Invitations use email magic-link infrastructure. Each provider-backed connection is assigned an owner so reports can filter household finances by person.

## What do roles allow?

Authorization is based on scopes carried by the access token and enforced again by the server:

| Role | Intended access |
|---|---|
| `admin` | All data, users, and configuration. |
| `writer` | Read/write transactions, accounts, rules, categories, tags, budgets, assets, and wealth; read owners and reports; no user/configuration management. |
| `readonly` | Read transactions, accounts, reports, wealth, budgets, and portfolio. |
| `spend_tracker` | Spending reports without raw transaction access. |
| `cashflow_tracker` | Spending/cash-flow reports and budget editing without raw transactions. |
| `net_worth_tracker` | Net worth, assets, and manual wealth data. |
| `portfolio_tracker` | Portfolio analysis. |

The master password is different: it acts as `X-API-Key` and grants every scope. It is not a restricted household role.

## Which sign-in methods are supported?

Tallyo supports a standalone master password plus optional Google, email OTP/magic links, and passkeys. OAuth methods use Tallyo's built-in authorization-code flow with PKCE. Multiple methods can be enabled together.

OAuth users must exist in Tallyo. Google does not grant access to an arbitrary Google account, and email send responses deliberately do not reveal whether an address is registered. Passkeys require a matching relying-party ID/origin and a browser secure context.

Saving Authorization settings intentionally restarts the process. The environment `MASTER_PASSWORD` overrides the database setting. See [Troubleshooting](troubleshooting.md#sign-in-methods).

## Where does the browser store authentication state?

OAuth access tokens stay in memory. Rotating refresh tokens are stored in browser local storage. Master-password sessions, PKCE state, and several UI preferences also use local storage. The app signs out after 15 minutes of inactivity, with a warning after 14 minutes, unless all authentication is disabled for local development.

Use a trusted browser profile. Clearing Tallyo site data signs the browser out and removes local preferences/state, but does not alter the server database.

## Is Tallyo a PWA, and does it work offline?

Yes, it is and its service worker auto-updates static assets. It does not provide offline financial data. GraphQL and transaction REST requests are network-only, so an offline app shell may open while reports and accounts remain unavailable.

Use HTTPS for normal PWA installation and passkeys. The app expects to be served at the root of its origin, not under an arbitrary path prefix. See [Troubleshooting](troubleshooting.md#pwa-and-browser-cache) for stale-worker recovery.

## Is there an API?

Yes. The main API is GraphQL at `/query`; an authenticated playground is at `/playground`. Requests use OAuth bearer tokens or `X-API-Key: <master-password>`. GraphQL has a 1 MiB request-body limit and fixed complexity limit, and production introspection is disabled.

CSV import/export are REST exceptions at `/transactions/import` and `/transactions/export`. All endpoints enforce their required scopes server-side even when the UI hides an unavailable control.

## How does MCP support work?

An admin can enable the MCP endpoint at `/mcp` under **Settings > Configuration**. It returns 404 while disabled. MCP tools delegate to the same GraphQL operations and scope checks as the normal API.

With OAuth enabled, dynamic MCP clients register through `/register`, use an explicit consent screen, and receive only the intersection of requested scopes and the signed-in user's role. Configure allowed HTTPS redirect hosts narrowly. A master-password-only client can use the `X-API-Key` header, but that grants all scopes; do not put the key in a query string or share it with an untrusted client.

An MCP client may send returned finance data onward to its model/provider. That privacy boundary is outside Tallyo, so review the client and model service before granting access.

## Do I need a reverse proxy?

For anything beyond localhost or a trusted private network, use a TLS reverse proxy, VPN, or identity-aware proxy. Proxy the entire origin because the UI, OAuth, API, PWA, and MCP use several root paths.

The public issuer, frontend callback, and Google callback must match the external origin exactly. Configure only the proxy's direct IP/CIDR as trusted so authentication rate limits use the correct client address. Do not expose Tallyo directly to the public internet as the primary security boundary. See [Security And Deployment Notes](security.md) and [Troubleshooting](troubleshooting.md#reverse-proxy-and-external-url).

## What does `/healthz` verify?

Only that the HTTP router is alive enough to return `204 No Content`. It does not query SQLite and does not check providers, sync workers, authentication, reports, or outbound connectivity. Use it for shallow liveness, then inspect logs and feature-specific status for deeper diagnosis.
