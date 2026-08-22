-- ============================================================
-- simplefin_access_tokens
-- ============================================================

-- Used by GraphQL mutation createSimpleFinAccessToken (accounts.graphql) to persist the access URL claimed from a SimpleFIN setup token.
-- name: CreateSimpleFinAccessToken :one
INSERT INTO simplefin_access_tokens (access_url, label, owner_id, sync_cron, next_sync_at)
VALUES (@access_url, sqlc.narg('label'), @owner_id, @sync_cron, @next_sync_at)
RETURNING id, label, owner_id, last_synced_at, sync_cron, next_sync_at, created_at;

-- Used by GraphQL query simpleFinAccessTokens (accounts.graphql) to list all configured SimpleFIN access tokens, optionally scoped by id.
-- name: SimpleFinAccessTokens :many
SELECT sat.id, sat.label, sat.owner_id, o.name AS owner_name,
       sat.last_synced_at, sat.sync_cron, sat.next_sync_at, sat.created_at
FROM simplefin_access_tokens sat
JOIN owners o ON o.id = sat.owner_id
WHERE TRUE
  AND sat.id = @id -- :if @id
ORDER BY sat.id;

-- Used by SimpleFIN sync loops to select due token secrets. Balance work also
-- excludes tokens whose linked accounts exist and are all closed: the shared
-- snapshot sink rejects closed-account writes, so fetching from the provider
-- would discard every result. A token with no linked accounts yet (before
-- the first transaction sync creates them) stays due. Transaction sync keeps
-- syncing a token's open accounts regardless of a sibling closed one, so
-- this filter applies only to the balance kind.
-- name: SimpleFinTokenSecrets :many
SELECT id, access_url, owner_id, sync_cron, last_synced_at, next_sync_at, next_balance_sync_at
FROM simplefin_access_tokens sat
WHERE COALESCE(
    CASE CAST(@kind AS TEXT) WHEN 'sync' THEN next_sync_at ELSE next_balance_sync_at END,
    @now
  ) <= @now
  AND (
    CAST(@kind AS TEXT) != 'balance'
    OR NOT EXISTS (
      SELECT 1
      FROM simplefin_connections sc
      JOIN connections c ON c.source_table = 'simplefin_connections' AND c.source_id = sc.id
      JOIN accounts a ON a.connection_id = c.id
      WHERE sc.access_token_id = sat.id
        AND a.manual = 0
    )
    OR EXISTS (
      SELECT 1
      FROM simplefin_connections sc
      JOIN connections c ON c.source_table = 'simplefin_connections' AND c.source_id = sc.id
      JOIN accounts a ON a.connection_id = c.id
      WHERE sc.access_token_id = sat.id
        AND a.manual = 0
        AND a.is_closed = 0
    )
  )
ORDER BY id;

-- Used by internal/transactions' background SimpleFIN sync loop to record a completed pass and schedule the next one.
-- name: SetSimpleFinTokenSynced :exec
UPDATE simplefin_access_tokens
SET last_synced_at = @last_synced_at,
    next_sync_at   = @next_sync_at,
    updated_at     = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by internal/wealth's background SimpleFIN balance-sync loop to record a completed pass and schedule the next one.
-- name: SetSimpleFinTokenBalanceSynced :exec
UPDATE simplefin_access_tokens
SET next_balance_sync_at = @next_balance_sync_at,
    updated_at           = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by GraphQL mutation deleteSimpleFinAccessToken (accounts.graphql) to remove a SimpleFIN credential.
-- name: DeleteSimpleFinAccessToken :exec
DELETE FROM simplefin_access_tokens WHERE id = @id;

-- ============================================================
-- simplefin_connections
-- ============================================================

-- Used by internal/transactions' and internal/wealth's SimpleFIN sync loops to discover and upsert connections (orgs) reported by the SimpleFIN API.
-- name: UpsertSimpleFinConnection :one
INSERT INTO simplefin_connections (external_id, access_token_id, org_id, org_domain, org_url, sfin_url, logo_url)
VALUES (@external_id, @access_token_id, sqlc.narg('org_id'), sqlc.narg('org_domain'), sqlc.narg('org_url'), sqlc.narg('sfin_url'), sqlc.narg('logo_url'))
ON CONFLICT(external_id) DO UPDATE SET
    access_token_id = excluded.access_token_id,
    org_id          = excluded.org_id,
    org_domain      = excluded.org_domain,
    org_url         = excluded.org_url,
    sfin_url        = excluded.sfin_url,
    logo_url        = excluded.logo_url,
    updated_at      = strftime('%Y-%m-%dT%H:%M:%SZ','now')
RETURNING id;

-- Used by SimpleFIN token, deletion, and dataloader paths with optional token and connection ID filters.
-- name: SimpleFinConnections :many
SELECT sc.id, sc.external_id, sc.access_token_id, sc.org_domain, sc.org_url,
       sc.last_synced_at, sc.created_at, sc.updated_at, c.id AS connection_id
FROM simplefin_connections sc
JOIN connections c ON c.source_table = 'simplefin_connections' AND c.source_id = sc.id
WHERE TRUE
  AND sc.access_token_id IN (sqlc.slice('access_token_ids')) -- :if @access_token_ids
  AND sc.id IN (sqlc.slice('ids')) -- :if @ids
  AND sc.external_id IN (sqlc.slice('external_ids')) -- :if @external_ids
ORDER BY sc.access_token_id, sc.id;

-- Used by internal/transactions' SimpleFIN sync loop to record connection-level health/error state after each sync cycle.
-- name: SetSimpleFinConnectionHealth :exec
UPDATE simplefin_connections
SET health_state         = @health_state,
    health_error_message = sqlc.narg('health_error_message'),
    health_updated_at    = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
    last_synced_at       = @last_synced_at,
    updated_at           = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by accounts/db.Store.DeleteConnection and DeleteSimpleFinAccessToken to remove SimpleFIN connection rows.
-- name: DeleteSimpleFinConnection :exec
DELETE FROM simplefin_connections WHERE id = @id;

-- ============================================================
-- simplefin_sync_log
-- ============================================================

-- Used by internal/transactions' SimpleFIN sync loop to log per-batch added/modified/pending-removed counts after each sync.
-- name: LogSimpleFinSyncBatch :exec
INSERT INTO simplefin_sync_log (access_token_id, start_date, added, modified, pending_removed, error)
VALUES (@access_token_id, sqlc.narg('start_date'), @added, @modified, @pending_removed, sqlc.narg('error'));

-- Used by internal/transactions' SimpleFIN sync loop at the start of each sync to detect which pending transactions the provider has since resolved (posted or removed).
-- Provider-first join order: EXPLAIN QUERY PLAN confirms this walks
-- idx_simplefin_connections_access_token -> idx_connections_source ->
-- idx_accounts_connection -> idx_transactions_account instead of scanning
-- every pending SimpleFIN transaction across all tokens.
-- name: PendingSimpleFinTransactionIDs :many
SELECT t.external_id
FROM simplefin_connections sc
CROSS JOIN connections c ON c.source_id = sc.id AND c.source_table = 'simplefin_connections'
CROSS JOIN accounts a ON a.connection_id = c.id
CROSS JOIN transactions t ON t.account_id = a.id
WHERE sc.access_token_id = @access_token_id
  AND t.source = 'simplefin'
  AND t.pending = 1;

-- Used by GraphQL mutation resetSimpleFinSync (accounts.graphql) via accounts/simplefin.go to force a token's next sync to run immediately.
-- name: ResetSimpleFinTokenSyncedAt :exec
UPDATE simplefin_access_tokens
SET last_synced_at = NULL,
    next_sync_at   = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
    updated_at     = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by internal/transactions/db's SimpleFIN sync to fetch the access URL and schedule for a token, looked up by connection ID.
-- name: SimpleFinTokenSecretByConnID :one
SELECT sat.id, sat.access_url, sat.owner_id, sat.sync_cron,
       sat.last_synced_at, sat.next_sync_at, sat.next_balance_sync_at
FROM simplefin_access_tokens sat
JOIN simplefin_connections sc ON sc.access_token_id = sat.id
WHERE sc.id = @conn_id;
