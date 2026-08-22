-- Used by wealth/db.Store.UpsertAsset (Plaid/SimpleFIN/DeBank adapter syncs, and GraphQL mutations createAsset/updateAsset) to insert or update an asset while preserving user-edited fields.
-- name: UpsertAssetRow :one
INSERT INTO assets (
  asset_type,
  identifier,
  name,
  classifier,
  forced_usd_price,
  tracking_ticker,
  tracking_multiplier,
  additional,
  user_edited,
  user_created,
  last_price,
  last_price_at
)
VALUES (
  @asset_type,
  @identifier,
  @name,
  @classifier,
  @forced_usd_price,
  @tracking_ticker,
  @tracking_multiplier,
  @additional,
  @user_edited,
  @user_created,
  @last_price,
  @last_price_at
)
ON CONFLICT(asset_type, identifier) DO UPDATE SET
  name = COALESCE(excluded.name, assets.name),
  classifier = CASE WHEN assets.user_edited = 1 THEN assets.classifier ELSE excluded.classifier END,
  forced_usd_price = COALESCE(excluded.forced_usd_price, assets.forced_usd_price),
  tracking_ticker = COALESCE(assets.tracking_ticker, excluded.tracking_ticker),
  tracking_multiplier = CASE
    WHEN assets.tracking_ticker IS NOT NULL THEN assets.tracking_multiplier
    WHEN excluded.last_price IS NOT NULL
     AND (assets.last_price_at IS NULL OR excluded.last_price_at >= assets.last_price_at)
    THEN excluded.tracking_multiplier
    ELSE assets.tracking_multiplier
  END,
  additional = COALESCE(assets.additional, excluded.additional),
  user_edited = assets.user_edited OR excluded.user_edited,
  user_created = assets.user_created OR excluded.user_created,
  last_price = CASE
    WHEN excluded.last_price IS NOT NULL
     AND (assets.last_price_at IS NULL OR excluded.last_price_at >= assets.last_price_at)
    THEN excluded.last_price
    ELSE assets.last_price
  END,
  last_price_at = CASE
    WHEN excluded.last_price IS NOT NULL
     AND (assets.last_price_at IS NULL OR excluded.last_price_at >= assets.last_price_at)
    THEN COALESCE(excluded.last_price_at, assets.last_price_at)
    ELSE assets.last_price_at
  END,
  updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
RETURNING id, asset_type, identifier, name, classifier,
  additional, last_price, last_price_at, forced_usd_price,
  tracking_ticker, tracking_multiplier,
  price_connectivity, investment_connectivity;

-- Used by wealth/db.Store.UpsertAsset and manual updateAsset handling to persist merged type-specific metadata.
-- name: UpdateAssetAdditional :exec
UPDATE assets
SET additional = @additional,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by wealth adapters' persister (Plaid/SimpleFIN/DeBank balance syncs) and Yahoo Finance price polling to record an asset's latest price.
-- name: UpdateAssetPrice :execrows
UPDATE assets
SET last_price = @last_price,
    last_price_at = @last_price_at,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id
  AND @last_price IS NOT NULL
  AND (last_price_at IS NULL OR @last_price_at >= last_price_at);

-- Used by wealth adapters' persister and snapshot revaluation to sync a tracked asset's price multiplier from provider data.
-- name: UpdateAssetTrackingMultiplier :exec
UPDATE assets
SET tracking_multiplier = @tracking_multiplier,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id
  AND tracking_ticker IS NOT NULL;

-- Used by wealth/db.Store.UpsertAsset to identify an existing asset by its externally-discovered provider ID (asset_adapter_sources), and by MergeAsset to look up adapter sources during a merge.
-- name: AssetAdapterSourceAssetID :one
SELECT asset_id
FROM asset_adapter_sources
WHERE source_adapter = @source_adapter
  AND source_id = @source_id;

-- Used by wealth/db.Store.UpsertAsset to associate an externally-discovered provider ID (Plaid, SimpleFIN, DeBank) with an internal asset row.
-- name: InsertAssetAdapterSource :exec
INSERT INTO asset_adapter_sources (asset_id, source_adapter, source_id)
VALUES (@asset_id, @source_adapter, @source_id)
ON CONFLICT(source_adapter, source_id) DO NOTHING;

-- Used by the Asset.adapterSources GraphQL field's dataloader (internal/graph/loaders.go) to batch-load provider sources per asset.
-- name: AssetAdapterSourcesByAssetIDs :many
SELECT asset_id, source_adapter, source_id
FROM asset_adapter_sources
WHERE asset_id IN (sqlc.slice('asset_ids'))
ORDER BY source_adapter, source_id;

-- Used by GraphQL mutation mergeAsset to detect a holding collision (same snapshot or same account+date) before merging two assets.
-- name: AssetMergeCollisionExists :one
SELECT EXISTS(
  SELECT 1
  FROM asset_daily_holdings duplicate
  JOIN asset_daily_holdings target ON target.snapshot_id = duplicate.snapshot_id
  WHERE duplicate.asset_id = @duplicate_asset_id
    AND target.asset_id = @target_asset_id
  UNION ALL
  SELECT 1
  FROM asset_daily_holdings duplicate
  JOIN asset_daily_holdings target ON target.account_id = duplicate.account_id
    AND target.date = duplicate.date
  WHERE duplicate.asset_id = @duplicate_asset_id
    AND target.asset_id = @target_asset_id
) AS has_collision;

-- Used by GraphQL mutation mergeAsset to move all historical holdings from the duplicate asset onto the target asset.
-- name: UpdateAssetDailyHoldingsAssetID :exec
UPDATE asset_daily_holdings
SET asset_id = @target_asset_id
WHERE asset_id = @duplicate_asset_id;

-- Used by GraphQL mutation mergeAsset to reassign portfolio analysis classification from the duplicate asset to the target asset.
-- name: MoveAssetAnalysisReport :exec
UPDATE OR IGNORE asset_analysis_reports
SET asset_id = @target_asset_id
WHERE asset_id = @duplicate_asset_id;

-- Used by wealth/db.Store.UpdateAsset to invalidate a stale portfolio analysis report when a user edit changes the asset's effective portfolio ticker (identifier or tracking ticker).
-- name: DeleteAssetAnalysisReportByAssetID :exec
DELETE FROM asset_analysis_reports
WHERE asset_id = @asset_id;

-- Used by GraphQL mutation mergeAsset to reassign external provider associations from the duplicate asset to the target asset.
-- name: MoveAssetAdapterSources :exec
UPDATE asset_adapter_sources
SET asset_id = @target_asset_id
WHERE asset_id = @duplicate_asset_id;

-- Used by GraphQL mutation mergeAsset to delete the duplicate asset once its holdings and metadata have been moved to the target.
-- name: DeleteAssetByID :exec
DELETE FROM assets
WHERE id = @id;

-- Used by Yahoo Finance price polling and portfolio analysis sync to record asset fetch health.
-- name: UpdateAssetConnectivity :exec
UPDATE assets
SET price_connectivity = COALESCE(sqlc.narg('price_connectivity'), price_connectivity),
    investment_connectivity = COALESCE(sqlc.narg('investment_connectivity'), investment_connectivity),
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by wealth/db.Store to fetch asset rows by ID, IDs, type+identifier, or filter for updateAsset and other asset lookups.
-- name: Assets :many
SELECT sqlc.embed(a)
FROM assets a
WHERE TRUE
  AND a.id = @id -- :if @id
  AND a.id IN (sqlc.slice('ids')) -- :if @ids
  AND a.asset_type = @asset_type -- :if @asset_type
  AND a.identifier = @identifier -- :if @identifier
  AND TRUE;

-- Used by GraphQL mutation updateAsset via wealth/db.Store to update user-editable fields (name, identifier, classifier, forced price, tracking ticker).
-- name: UpdateAssetBase :exec
UPDATE assets
SET name = COALESCE(sqlc.narg('name'), name),
    identifier = COALESCE(sqlc.narg('identifier'), identifier),
    classifier = COALESCE(sqlc.narg('classifier'), classifier),
    forced_usd_price = CASE
      WHEN CAST(@forced_price_set AS BOOLEAN) = 1 THEN sqlc.narg('forced_price_value')
      WHEN CAST(@forced_price_clear AS BOOLEAN) = 1 THEN NULL
      ELSE forced_usd_price
    END,
    tracking_ticker = CASE
      WHEN CAST(sqlc.narg('tracking_ticker') AS TEXT) IS NOT NULL THEN NULLIF(CAST(sqlc.narg('tracking_ticker') AS TEXT), '')
      ELSE tracking_ticker
    END,
    tracking_multiplier = COALESCE(sqlc.narg('tracking_multiplier'), tracking_multiplier),
    user_edited = 1,
    last_price = CASE WHEN CAST(@clear_market_price AS BOOLEAN) = 1 OR CAST(sqlc.narg('tracking_ticker') AS TEXT) IS NOT NULL OR sqlc.narg('tracking_multiplier') IS NOT NULL THEN NULL ELSE last_price END,
    last_price_at = CASE WHEN CAST(@clear_market_price AS BOOLEAN) = 1 OR CAST(sqlc.narg('tracking_ticker') AS TEXT) IS NOT NULL OR sqlc.narg('tracking_multiplier') IS NOT NULL THEN NULL ELSE last_price_at END,
    price_connectivity = CASE
      WHEN sqlc.narg('identifier') IS NOT NULL OR CAST(sqlc.narg('tracking_ticker') AS TEXT) IS NOT NULL THEN 'HEALTHY'
      ELSE COALESCE(sqlc.narg('price_connectivity'), price_connectivity)
    END,
    investment_connectivity = CASE
      WHEN CAST(@effective_ticker_changed AS BOOLEAN) = 1 THEN 'HEALTHY'
      ELSE COALESCE(sqlc.narg('investment_connectivity'), investment_connectivity)
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by wealth/db.Store's asset price-update path to find the current snapshot rows affected by an asset price change.
-- name: LatestSnapshotIDsForAsset :many
SELECT h.snapshot_id
FROM asset_daily_holdings h
JOIN account_balance_daily_snapshots s ON s.id = h.snapshot_id
JOIN accounts a ON a.id = s.account_id
WHERE h.asset_id = CAST(@asset_id AS INTEGER)
  AND a.is_closed = 0
  AND s.date = (
    SELECT MAX(s2.date)
    FROM account_balance_daily_snapshots s2
    WHERE s2.account_id = s.account_id
  );

-- Used by wealth/db.Store's asset price-update path to reprice selected holdings when an asset price changes.
-- name: RevalueAssetHoldingsBySnapshotIDs :exec
UPDATE asset_daily_holdings
SET price = @price,
    value_usd_cents = CASE
      WHEN quantity IS NULL THEN value_usd_cents
      ELSE CAST(ROUND(quantity * @price * 100) AS INTEGER)
    END
WHERE asset_id = CAST(@asset_id AS INTEGER)
  AND snapshot_id IN (sqlc.slice('snapshot_ids'));

-- Used after RevalueAssetHoldingsBySnapshotIDs to rebuild exactly the account-level balances affected by repricing.
-- name: RecalculateSnapshotBalancesByIDs :exec
UPDATE account_balance_daily_snapshots
SET balance_usd_cents = (
  SELECT COALESCE(SUM(value_usd_cents), 0)
  FROM asset_daily_holdings
  WHERE snapshot_id = account_balance_daily_snapshots.id
    AND counts_toward_value = 1
)
WHERE account_balance_daily_snapshots.id IN (sqlc.slice('snapshot_ids'));

-- Used by GraphQL query assets (wealth/db.Store.AllAssets).
-- name: AssetRecords :many
WITH latest_holdings AS (
  SELECT h.asset_id
  FROM asset_daily_holdings h
  JOIN account_balance_daily_snapshots s ON s.id = h.snapshot_id
  JOIN accounts ha ON ha.id = h.account_id
  WHERE ha.is_hidden = 0
    AND ha.is_closed = 0
    AND h.counts_toward_value = 1
    AND s.date = (SELECT MAX(s2.date) FROM account_balance_daily_snapshots s2 WHERE s2.account_id = s.account_id)
  GROUP BY h.asset_id
)
SELECT sqlc.embed(a)
FROM assets a
LEFT JOIN latest_holdings lh ON lh.asset_id = a.id
JOIN assets_fts ON assets_fts.rowid = a.id AND assets_fts MATCH @fts_match -- :if @fts_match
WHERE TRUE
  AND (lh.asset_id IS NOT NULL OR a.user_created = 1) -- :if @exclude_historical
  AND a.asset_type = @asset_type -- :if @asset_type
  AND a.price_connectivity = @price_connectivity -- :if @price_connectivity
  AND a.investment_connectivity = @investment_connectivity -- :if @investment_connectivity
  AND (instr(lower(coalesce(a.name, '')), @like_name) > 0 OR instr(lower(a.identifier), @like_identifier) > 0) -- :if @like_search
ORDER BY
  bm25(assets_fts) ASC, -- :if @order_fts_rank
  lower(coalesce(a.name, '')) ASC, -- :if @order_name
  a.identifier ASC, -- :if @order_name
  -- Trailing unconditional tiebreaker: the dynamic-filter plugin drops the
  -- ":if" annotation on a query's final physical ORDER BY/WHERE line, so a
  -- real (harmless, always-applied) clause has to be last. Also gives the
  -- name-ordered branch a stable sort.
  a.id ASC;

-- Used by wealth's SweepUnreferencedAssets (run after balance syncs) to garbage-collect provider-discovered asset rows with no holdings or analysis.
-- name: DeleteUnreferencedAssets :execrows
-- Garbage-collect catalog rows that nothing references and the user never
-- edited. Type-agnostic: any asset with no daily holding (current or
-- historical) and no analysis report is junk left behind by a provider sync.
-- Held, manually tracked, analyzed, and user-edited assets are preserved.
-- CURRENCY assets (the seeded USD denomination every cash balance references)
-- are reference data, not sync-discovered holdings, and are never swept even
-- when unreferenced.
DELETE FROM assets
WHERE user_edited = 0
  AND asset_type <> 'CURRENCY'
  AND NOT EXISTS (
    SELECT 1
    FROM asset_daily_holdings h
    WHERE h.asset_id = assets.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM asset_analysis_reports r
    WHERE r.asset_id = assets.id
  );
