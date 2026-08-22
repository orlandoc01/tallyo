# Crypto Tracking

Tallyo tracks crypto by public wallet address on EVM-compatible chains only. Supported addresses are `0x` followed by 40 hex characters. Non-EVM chains such as Bitcoin, Solana, Cardano, XRP, and others are not supported, and exchange or custodial accounts are not covered by this feature. Crypto wallet tracking is optional; Plaid, SimpleFIN, manual accounts, and CSV workflows do not require it.

Read [Installing Tallyo](install.md), [Configuration](configuration.md), and [Security and Deployment Notes](security.md) before storing live financial credentials.

## Read-only wallet tracking

Tallyo uses only the public wallet address. It never asks for private keys, seed phrases, or transaction signing permissions.

Balances come from DeBank. Tallyo sends the public address to DeBank to obtain wallet balances and DeFi positions. A DeBank account or API key is not required at this time.

DeBank's coverage, supported chains, token metadata, service availability, and terms can change independently of Tallyo. Confirm current DeBank behavior before relying on wallet data for production net worth tracking.

## Link a crypto wallet

1. Create the household owner who should own the wallet. The setup wizard requires at least one owner, and authorized users can also create one from the Link form.
2. Open Accounts > Link Connection.
3. Choose Crypto wallet.
4. Enter the EVM address.
5. Enter an optional label.
6. Choose the owner.
7. Select chains and choose Link wallet.

New wallet links default to Ethereum only. The supported chain list is a fixed list maintained in Tallyo. It includes major EVM chains such as Ethereum, Base, Polygon, Arbitrum, OP, BNB Chain, Avalanche, and many others; the picker shows the full list, and you can add more chains before or after linking.

The wallet's selected chains are authoritative. Tokens on unselected chains are never fetched. You can change the chain selection later in the wallet's account detail form. Wallets can be unlinked.

## What syncs

EVM wallets sync wallet token balances per selected chain plus DeFi project and protocol positions, such as staked, liquidity-pool, and lending positions, when DeBank supplies them.

This is balance and net-worth tracking only. EVM wallets produce no transaction history in Tallyo, so they do not appear in spending or cash-flow reports.

Previously unknown DeBank assets are discovered only when their total value is at least `$0.05`. Known assets remain in snapshots below that threshold, including explicit zero-value holdings. Persisted wallet-token holdings keep quantity; project-position quantities are not stored because DeBank position rows are value-oriented.

## Sync schedules

New EVM wallets use this five-field cron schedule:

| Data | Default schedule | Meaning |
|---|---|---|
| Balances and DeFi positions | `30 16 * * *` | Daily at 16:30 America/New_York. |

The balance worker checks for due work hourly. Snapshot run dates are recorded in UTC.

`SYNC_OFF=true` prevents all background sync loops from starting. The database-managed wealth tracking switch separately pauses the wallet balance poller.

## Anomaly protection

Tallyo applies per-holding 100x price-deviation checks for DeBank wallet snapshots. When a suspect wallet snapshot is detected, Tallyo retries with backoff for up to about two hours. If the value still looks suspect, the snapshot is flagged, the last good balance is carried forward, and the change is routed to the balance review queue instead of silently changing net worth.

Successful empty DeBank data is accepted as the current wallet state. If a selected-chain balance request or the project-position request fails, the sync aborts without persisting a new snapshot.

If a token balance is missing, confirm that outbound network access works and that the token's chain is selected in the wallet's account detail form. See [Troubleshooting](troubleshooting.md#reports-categories-and-wealth).

## Portfolio analysis limitation

Crypto assets are classified as cryptocurrency or stablecoin. They count fully in net worth and holdings views.

Portfolio analysis reports, including Morningstar category/group and sectors, cover public securities only. Crypto assets do not receive those reports and appear as Unclassified in portfolio analysis views.

## Non-EVM chains and custodial accounts

For chains Tallyo cannot sync, such as Bitcoin or Solana, create a manual account with a manual holding.

A manual asset can set `trackingTicker`, such as `BTC-USD`, so Yahoo Finance prices it live. `trackingMultiplier` adjusts the quote when one ticker unit does not equal one held unit. For assets without a ticker, `forcedUsdPrice` sets a fixed USD price per unit.

A brokerage or other financial institution that supports crypto may still arrive through Plaid or SimpleFIN if that provider supplies the account data. Exchange and custodial wallet balances are not read through the EVM wallet feature.
