-- Used by internal/wealth's shared snapshot sink (ReplaceAccountBalanceSnapshot) to replace a daily balance row for any adapter (Plaid, SimpleFIN, DeBank, Yahoo Finance, real estate, manual).
-- name: InsertAccountBalanceSnapshot :one
INSERT OR REPLACE INTO account_balance_daily_snapshots (account_id, source, date, synced_at, balance_usd_cents, raw_payload, flagged, flag_reason)
VALUES (@account_id, @source, @date, @synced_at, @balance_usd_cents, @raw_payload, @flagged, @flag_reason)
RETURNING id;

-- Used by internal/wealth's shared snapshot sink to skip snapshot writes for closed accounts.
-- name: AccountIsClosed :one
SELECT is_closed
FROM accounts
WHERE id = @id;

-- Used by internal/wealth's persister and review approval flow to unflag previously-flagged snapshots.
-- name: UnflagSnapshotsBetweenDates :exec
UPDATE account_balance_daily_snapshots
SET flagged = 0, flag_reason = NULL
WHERE account_id = @account_id
  AND date >= CASE WHEN CAST(@inclusive AS BOOLEAN) = 1 THEN @after_date ELSE date(@after_date, '+1 day') END
  AND date <= CASE WHEN CAST(@inclusive AS BOOLEAN) = 1 THEN @before_date ELSE date(@before_date, '-1 day') END
  AND flagged = 1;

-- Used by internal/wealth's balance-review approval flow to verify the review still has flagged snapshots.
-- name: HasFlaggedSnapshotForAccountBetweenDates :one
SELECT CAST(EXISTS(
  SELECT 1
  FROM account_balance_daily_snapshots
  WHERE account_id = @account_id
    AND flagged = 1
    AND date >= @start_date
    AND date <= @end_date
) AS INTEGER) AS has_flagged_snapshot;

-- Used by internal/wealth's balance-review approval flow and manual snapshot editor to restore the provider-reported balance and clear the flag.
-- name: UpdateSnapshotBalanceAndUnflag :exec
UPDATE account_balance_daily_snapshots
SET balance_usd_cents = @balance_usd_cents,
    flagged = 0,
    flag_reason = NULL
WHERE id = @id;

-- Used by internal/wealth's manual snapshot editor (GraphQL mutation changeAccountSnapshot) to fetch a snapshot before editing it.
-- name: GetAccountBalanceSnapshotByID :one
SELECT s.id, s.account_id, s.source, s.date, s.synced_at, s.balance_usd_cents, s.flagged, a.type AS account_type
FROM account_balance_daily_snapshots s
JOIN accounts a ON a.id = s.account_id
WHERE s.id = @id;

-- Used by internal/wealth's snapshot editor and the manual/real-estate adapters to fetch the latest snapshot, optionally scoped to a sync-time window.
-- name: LatestAccountBalanceSnapshotInWindow :one
SELECT s.id, s.account_id, s.source, s.date, s.synced_at, s.balance_usd_cents, s.flagged, a.type AS account_type
FROM account_balance_daily_snapshots s
JOIN accounts a ON a.id = s.account_id
WHERE TRUE
  AND (s.synced_at >= @start_time AND s.synced_at < @end_time) -- :if @start_time @end_time
  AND s.account_id = @account_id
ORDER BY s.date DESC, s.id DESC
LIMIT 1;

-- Used by internal/wealth/manual to discover open manual accounts for periodic carry-forward.
-- name: ManualSnapshotAccountIDs :many
SELECT id
FROM accounts
WHERE manual = 1
  AND is_closed = 0
ORDER BY id;

-- Used by internal/wealth's snapshot editor to find snapshots newer than an edited date, so later balances can be reconciled.
-- name: NewerAccountBalanceSnapshotsForAccount :many
SELECT s.id, s.account_id, s.source, s.date, s.synced_at, s.balance_usd_cents, s.flagged, a.type AS account_type
FROM account_balance_daily_snapshots s
JOIN accounts a ON a.id = s.account_id
WHERE s.account_id = @account_id
  AND s.date > @date
ORDER BY s.date, s.id;

-- Used by internal/wealth to batch-load each account's latest snapshot for the Account.latestSnapshot GraphQL field.
-- name: LatestAccountBalanceSnapshotsForAccounts :many
SELECT
  s.id,
  s.account_id,
  s.source,
  s.date,
  s.synced_at,
  s.balance_usd_cents,
  s.flagged,
  a.type AS account_type
FROM account_balance_daily_snapshots s
JOIN accounts a ON a.id = s.account_id
WHERE s.account_id IN (sqlc.slice('account_ids'))
  AND s.date = (
    SELECT MAX(s2.date)
    FROM account_balance_daily_snapshots s2
    WHERE s2.account_id = s.account_id
  );

-- Used by GraphQL query accountSnapshots (wealth.graphql) via internal/wealth's snapshot editor for cursor-paginated snapshot history.
-- name: AccountBalanceSnapshotsPage :many
SELECT s.id, s.account_id, s.source, s.date, s.synced_at, s.balance_usd_cents, s.flagged, a.type AS account_type
FROM account_balance_daily_snapshots s
JOIN accounts a ON a.id = s.account_id
WHERE TRUE
  AND s.date < @after_date -- :if @after_date
  AND s.account_id = @account_id
ORDER BY s.date DESC
LIMIT @row_limit;

-- Used by GraphQL query accountSnapshots (wealth.graphql) to compute the total day count for pagination.
-- name: AccountBalanceSnapshotDayCount :one
SELECT CAST(COUNT(*) AS INTEGER) AS count
FROM account_balance_daily_snapshots
WHERE account_id = @account_id;

-- Used by internal/wealth to load holdings for one or more snapshots, including the AccountSnapshot.holdings GraphQL field's dataloader.
-- name: SnapshotHoldingsBySnapshotIDs :many
SELECT
  h.snapshot_id,
  sqlc.embed(assets),
  h.quantity,
  h.price,
  h.value_usd_cents,
  h.counts_toward_value,
  h.manual
FROM asset_daily_holdings h
JOIN assets ON assets.id = h.asset_id
WHERE h.snapshot_id IN (sqlc.slice('snapshot_ids'))
ORDER BY h.snapshot_id, h.value_usd_cents DESC;

-- Used by internal/wealth's flagging flow to find the prior unflagged snapshot and holdings as a carry-forward anchor when a new snapshot looks anomalous.
-- name: LatestUnflaggedSnapshotHoldings :many
WITH latest AS (
  SELECT s0.id, s0.source, s0.date, s0.balance_usd_cents
  FROM account_balance_daily_snapshots s0
  WHERE s0.account_id = @account_id
    AND s0.date < @date
    AND s0.flagged = 0
  ORDER BY s0.date DESC
  LIMIT 1
)
SELECT latest.date,
       latest.balance_usd_cents,
       h.asset_id AS asset_id,
       a.identifier,
       aas.source_adapter,
       aas.source_id,
       h.quantity, h.price,
       COALESCE(h.value_usd_cents, 0) AS value_usd_cents,
       COALESCE(h.counts_toward_value, 0) AS counts_toward_value,
       COALESCE(h.manual, 0) AS manual
FROM latest
LEFT JOIN asset_daily_holdings h ON h.snapshot_id = latest.id
LEFT JOIN assets a ON a.id = h.asset_id
LEFT JOIN asset_adapter_sources aas ON aas.asset_id = h.asset_id
  AND aas.source_adapter = latest.source
ORDER BY h.value_usd_cents DESC;

-- Used by internal/wealth's shared snapshot sink (ReplaceAccountBalanceSnapshot) to insert each asset holding row for a balance snapshot.
-- name: InsertAssetDailyHolding :exec
-- Multiple provider holdings can resolve to the same asset within one snapshot
-- (e.g. a wallet balance and a DeFi-project position on the same token). Fold
-- duplicates into a single row by summing value/quantity so the holding total
-- stays consistent with the snapshot balance, instead of failing the whole
-- transaction on the (account_id, date, asset_id) unique index.
INSERT INTO asset_daily_holdings (snapshot_id, account_id, date, asset_id, quantity, price, value_usd_cents, counts_toward_value, manual)
VALUES (@snapshot_id, @account_id, @date, @asset_id, @quantity, @price, @value_usd_cents, @counts_toward_value, @manual)
ON CONFLICT(account_id, date, asset_id) DO UPDATE SET
  value_usd_cents = asset_daily_holdings.value_usd_cents + excluded.value_usd_cents,
  quantity = CASE
    WHEN asset_daily_holdings.quantity IS NULL OR excluded.quantity IS NULL THEN NULL
    ELSE asset_daily_holdings.quantity + excluded.quantity
  END,
  price = COALESCE(excluded.price, asset_daily_holdings.price),
  counts_toward_value = asset_daily_holdings.counts_toward_value OR excluded.counts_toward_value,
  manual = asset_daily_holdings.manual OR excluded.manual;

-- Used by internal/wealth to clean up holdings during balance-review approval and manual snapshot edits.
-- name: DeleteAssetDailyHoldingsBySnapshotID :exec
DELETE FROM asset_daily_holdings
WHERE snapshot_id = @snapshot_id;

-- Used by GraphQL query netWorth (wealth.graphql) via internal/wealth's service to fetch each open liability account's latest balance for the net-worth calculation.
-- name: ListLatestLiabilityAccountBalances :many
-- Closed accounts are filtered here because this current-net-worth query has no date predicate; otherwise a closed account's last row would remain current forever.
SELECT
  sqlc.embed(a),
  o.name AS owner_name,
  s.balance_usd_cents
FROM accounts a
JOIN owners o ON o.id = a.owner_id
JOIN account_balance_daily_snapshots s ON s.account_id = a.id
  AND s.date = (
    SELECT MAX(s2.date)
    FROM account_balance_daily_snapshots s2
    WHERE s2.account_id = a.id
  )
WHERE TRUE
  AND a.owner_id IN (sqlc.slice('owner_ids')) -- :if @owner_ids
  AND a.id IN (sqlc.slice('account_ids')) -- :if @account_ids
  AND a.is_hidden = 0
  AND a.is_closed = 0
  AND a.type IN ('CREDIT', 'LOAN')
ORDER BY a.name;

-- name: ListCurrentAccountHoldings :many
-- Closed accounts are filtered here because this current-holdings query has no date predicate; otherwise a closed account's last row would remain current forever.
SELECT
  sqlc.embed(a),
  o.name AS owner_name,
  sqlc.embed(assets),
  h.quantity,
  h.value_usd_cents,
  h.manual,
  s.date
FROM accounts a
JOIN owners o ON o.id = a.owner_id
JOIN account_balance_daily_snapshots s ON s.account_id = a.id
  AND s.date = (
    SELECT MAX(s2.date)
    FROM account_balance_daily_snapshots s2
    WHERE s2.account_id = a.id
  )
JOIN asset_daily_holdings h ON h.snapshot_id = s.id
JOIN assets ON assets.id = h.asset_id
LEFT JOIN asset_analysis_reports r ON r.asset_id = assets.id -- :if @classified_only
WHERE TRUE
  AND a.type NOT IN ('CREDIT', 'LOAN') -- :if @exclude_liabilities
  AND a.owner_id IN (sqlc.slice('owner_ids')) -- :if @owner_ids
  AND a.id IN (sqlc.slice('account_ids')) -- :if @account_ids
  AND a.subtype IN (sqlc.slice('account_subtypes')) -- :if @account_subtypes
  AND assets.classifier = @classifier -- :if @classifier
  AND r.asset_id IS NOT NULL -- :if @classified_only
  AND assets.id IN (sqlc.slice('asset_ids')) -- :if @asset_ids
  AND a.is_hidden = 0
  AND a.is_closed = 0
  AND h.counts_toward_value = 1
ORDER BY a.name, h.value_usd_cents DESC;

-- Used by internal/wealth's historical net-worth series to aggregate account balance values across a time range.
-- name: AccountBalanceSnapshotValues :many
SELECT
  s.account_id,
  a.type AS account_type,
  a.manual AS account_manual,
  a.subtype AS account_subtype,
  a.is_closed AS account_is_closed,
  s.synced_at,
  s.balance_usd_cents
FROM account_balance_daily_snapshots s
JOIN accounts a ON a.id = s.account_id
WHERE TRUE
  AND a.owner_id IN (sqlc.slice('owner_ids')) -- :if @owner_ids
  AND a.id IN (sqlc.slice('account_ids')) -- :if @account_ids
  AND s.synced_at >= @start_time
  AND s.synced_at < @end_time
  AND a.is_hidden = 0
ORDER BY s.account_id, s.synced_at;

-- Used by GraphQL query historicalNetWorth (wealth.graphql) via internal/wealth's service to compute the asset classifier breakdown over time.
-- name: ClassifierSnapshotValues :many
SELECT
  h.account_id,
  a.is_closed AS account_is_closed,
  s.synced_at,
  assets.classifier,
  CAST(SUM(h.value_usd_cents) AS INTEGER) AS value_usd_cents
FROM asset_daily_holdings h
JOIN account_balance_daily_snapshots s ON s.id = h.snapshot_id
JOIN accounts a ON a.id = h.account_id
JOIN assets ON assets.id = h.asset_id
WHERE TRUE
  AND a.owner_id IN (sqlc.slice('owner_ids')) -- :if @owner_ids
  AND a.id IN (sqlc.slice('account_ids')) -- :if @account_ids
  AND s.synced_at >= @start_time
  AND s.synced_at < @end_time
  AND h.counts_toward_value = 1
  AND a.is_hidden = 0
GROUP BY h.account_id, a.is_closed, s.synced_at, assets.classifier
ORDER BY h.account_id, s.synced_at, assets.classifier;

-- Used by GraphQL net-worth queries to determine historical range start and current report as-of date.
-- name: AccountBalanceSnapshotTimestampRange :one
SELECT
  CAST(COALESCE(MIN(s.synced_at), '') AS TEXT) AS earliest_synced_at,
  CAST(COALESCE(MAX(CASE WHEN a.is_closed = 0 THEN s.synced_at END), '') AS TEXT) AS latest_synced_at
FROM account_balance_daily_snapshots s
JOIN accounts a ON a.id = s.account_id
WHERE TRUE
  AND a.owner_id IN (sqlc.slice('owner_ids')) -- :if @owner_ids
  AND a.id IN (sqlc.slice('account_ids')) -- :if @account_ids
  AND a.is_hidden = 0;
