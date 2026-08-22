# SimpleFIN Setup

Tallyo uses SimpleFIN to connect bank and brokerage data through a SimpleFIN Access URL, then polls for accounts, balances, transactions, and holdings. SimpleFIN is optional; Plaid, manual accounts, CSV workflows, and crypto wallets do not require SimpleFIN.

Read [Installing Tallyo](install.md), [Configuration](configuration.md), and [Security and Deployment Notes](security.md) before storing live financial credentials.

## Create a SimpleFIN Bridge account

SimpleFIN is a protocol. The hosted aggregator most users interact with is [SimpleFIN Bridge](https://bridge.simplefin.org).

1. Create and verify a SimpleFIN Bridge account.
2. Connect the institutions you want Bridge to aggregate on Bridge's platform.
3. Generate a one-time Setup Token.
4. Copy the Setup Token before leaving the Bridge flow.

SimpleFIN Bridge is a paid service, currently $1.50/month. Bridge's terms, institution coverage, limits, and pricing can change independently of Tallyo, so confirm the current terms with Bridge before relying on it for production use.

## Link a SimpleFIN token

Tallyo claims the Setup Token on the server. The token is a base64-encoded claim URL; claiming it returns the Access URL Tallyo uses for sync. Setup Tokens are one-time tokens. Reusing an already claimed token fails with HTTP 403.

1. Create the household owner who should own the accounts behind the connections. The setup wizard requires at least one owner, and authorized users can also create one from the Link form.
2. Open Accounts > Link Connection.
3. Choose Bank / brokerage, then SimpleFIN.
4. Paste the Setup Token from SimpleFIN Bridge.
5. Enter an optional label.
6. Choose the owner and select Link.

The Access URL is stored in SQLite as a write-only secret. Tallyo never returns it through the UI or API.

Existing SimpleFIN connections are managed under Settings > Connections. Delete removes the token and its dependent connections and accounts.

## What syncs

SimpleFIN syncs accounts, balances, transactions, and holdings. Holdings arrive only for investment accounts and only when the institution and Bridge supply them.

Account type is inferred from account name, holdings, and balance sign. Ambiguous accounts are flagged for review. SimpleFIN reports liability balances as negative; Tallyo flips the sign using the persisted account type so net worth subtracts liabilities correctly.

SimpleFIN does not supply transaction categories. See [Categorization](#categorization) before relying on spending or cash-flow reports from SimpleFIN data.

## Sync schedules

New SimpleFIN tokens use these five-field cron schedules:

| Data | Default schedule | Meaning |
|---|---|---|
| Transactions | `0 6,18 * * *` | Twice daily at 06:00 and 18:00 UTC. |
| Balances and holdings | `30 16 * * 1-5` | Weekdays at 16:30 America/New_York. |

Background workers check for due work hourly. Transaction schedules are stored per SimpleFIN token, and balance scheduling is shared by the provider; neither is currently editable in the SimpleFIN UI.

`SYNC_OFF=true` prevents all background sync loops from starting. The database-managed transaction and wealth tracking switches separately pause their corresponding pollers.

For operational checks and reset behavior, see [Troubleshooting](troubleshooting.md#simplefin-sync).

## Net worth and portfolio analysis limitations

Non-investment accounts contribute a single whole-account balance as one cash line. Tallyo does not receive a holdings breakdown for those accounts.

SimpleFIN holdings are treated as USD-only. Tallyo takes `market_value` verbatim as USD and performs no FX conversion. A non-USD holding would contribute its native value as if it were USD.

Holding metadata is limited to symbol, description, shares, market value, and cost basis. Holdings with a ticker symbol become public securities tracked through Yahoo Finance. They receive live price updates and portfolio analysis reports, including Morningstar category/group and sectors, refreshed roughly every 14 days.

Holdings without a ticker symbol are keyed on the SimpleFIN holding ID. Their price updates only when SimpleFIN syncs, and they do not receive portfolio analysis reports, so they appear as Unclassified in portfolio analysis views.

Money-market funds matched by name, plus symbols such as `SPAXX`, `FDRXX`, and `FFLDX`, are classified as cash.

If the account balance exceeds the sum of holdings, Tallyo adds the positive residual as an uninvested-cash line.

Tallyo applies the same per-holding 100x price-deviation checks used for Plaid investment accounts and DeBank wallets. A flagged snapshot carries the last good balance forward and is routed to the balance review queue. Balance-only non-investment accounts receive no anomaly check, matching Plaid.

## Categorization

SimpleFIN supplies no transaction categories. Synced transactions arrive uncategorized unless a transaction rule matches, so rules, manual review, and the optional integrations below matter more than with Plaid.

Option 1 is transaction rules. Rules use case-insensitive substring matching against merchant or original name, with optional amount bounds. The highest-priority matching rule wins and can assign a category and tags.

Option 2 is a local Ollama model under Settings > Configuration > LLM categorization. Enable it, set the Ollama URL, and set the model name. Settings seeds the field with `qwen2.5:7b-instruct` as the default. Changes apply live, but Tallyo does not pull the model and does not check connectivity when saved. Unmatched synced transactions are staged for a background worker that classifies small batches against the household's category list and historical examples. Low-confidence results are skipped and left uncategorized. While staged, transactions are excluded from spending and cash-flow reports. Accepted results are marked reviewed. CSV-imported rows are not staged for Ollama.

Option 3 is the MCP API under Settings > Configuration > MCP. Enable the MCP server, then connect an MCP client, such as Claude. OAuth clients register dynamically, go through a consent screen, and receive scopes capped by the signed-in user's role. The client can categorize backlogs with tools such as `list_transactions`, `list_categories`, and `bulk_update_transactions`, then codify recurring merchants with `create_rule`.

