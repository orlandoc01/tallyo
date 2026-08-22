-- Used by GraphQL connection queries and provider source lookups.
-- name: Connections :many
SELECT c.id, c.source_table, c.source_id, c.name, c.owner_id, o.name AS owner_name, c.is_active
FROM connections c
JOIN owners o ON o.id = c.owner_id
WHERE TRUE
  AND c.source_table IN ('plaid_items', 'evm_wallets', 'simplefin_connections') -- :if @supported_providers_only
  AND c.is_active = 1 -- :if @active_only
  AND c.id IN (sqlc.slice('ids')) -- :if @ids
  AND c.source_table = @source_table -- :if @source_lookup
  AND c.source_id = @source_id -- :if @source_lookup
ORDER BY c.id;

-- Used by Plaid, SimpleFIN, EVM wallet, and real estate link flows to create or reactivate a polymorphic connection row.
-- name: UpsertConnection :one
INSERT INTO connections (source_table, source_id, name, owner_id, is_active)
VALUES (@source_table, @source_id, sqlc.narg('name'), @owner_id, 1)
ON CONFLICT(source_table, source_id) DO UPDATE SET
  is_active = 1,
  name = COALESCE(excluded.name, connections.name),
  owner_id = excluded.owner_id,
  updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
RETURNING id;

-- Used by GraphQL mutation updateConnection via accounts/db.Store to toggle a connection's active state.
-- name: UpdateConnectionActive :exec
UPDATE connections
SET is_active = @is_active,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by GraphQL mutation updateConnection via accounts/db.Store to update a Plaid item's sync/recurring-sync cron schedule.
-- name: UpdatePlaidConnectionSyncSettings :exec
UPDATE plaid_items
SET sync_cron = @sync_cron,
    recurring_sync_cron = @recurring_sync_cron,
    next_sync_at = @next_sync_at,
    next_recurring_sync_at = @next_recurring_sync_at,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by accounts/db.Store.DeleteConnection to remove all accounts owned by a connection.
-- name: DeleteAccountsByConnection :exec
DELETE FROM accounts
WHERE connection_id = @connection_id;

-- Used by accounts/db.Store.DeleteConnection to remove the underlying plaid_items row.
-- name: DeletePlaidItem :exec
DELETE FROM plaid_items
WHERE id = @id;

-- Used by accounts/db.Store.DeleteConnection to remove the underlying evm_wallets row.
-- name: DeleteEVMWallet :exec
DELETE FROM evm_wallets
WHERE id = @id;

-- Used by GraphQL mutation deleteConnection via accounts/db.Store.DeleteConnection.
-- name: DeleteConnectionByID :exec
DELETE FROM connections
WHERE id = @id;
