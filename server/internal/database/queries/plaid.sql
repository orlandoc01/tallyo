-- Used by GraphQL mutation createPlaidCredential (admin.graphql) via admin/db.Store.CreatePlaidCredential.
-- name: CreatePlaidCredential :one
INSERT INTO plaid_credentials (client_id, secret, environment, label)
VALUES (@client_id, @secret, @environment, @label)
RETURNING id;

-- Used by GraphQL mutation updatePlaidCredential (admin.graphql) via admin/db.Store.UpdatePlaidCredential.
-- name: UpdatePlaidCredential :execrows
UPDATE plaid_credentials
SET secret = @secret,
    environment = @environment
WHERE id = @id;

-- Used by GraphQL mutation deletePlaidCredential (admin.graphql) via admin/db.Store.DeletePlaidCredential.
-- name: DeletePlaidCredential :execrows
DELETE FROM plaid_credentials
WHERE id = @id;

-- Used by GraphQL query plaidCredentials and PlaidCredential dataloaders via
-- admin/db.Store. Secret never leaves this projection; Plaid-client-only
-- PlaidCredentialSecretByID carries the secret instead.
-- name: ListPlaidCredentials :many
SELECT pc.id, pc.client_id, pc.environment, pc.label, pc.created_at,
       CAST(COUNT(c.id) AS INTEGER) AS item_count
FROM plaid_credentials pc
LEFT JOIN plaid_items pi ON pi.credential_id = pc.id
LEFT JOIN connections c ON c.source_table = 'plaid_items' AND c.source_id = pi.id AND c.is_active = 1
WHERE TRUE
  AND pc.id IN (sqlc.slice('ids')) -- :if @ids
GROUP BY pc.id
ORDER BY pc.id;

-- Used only by admin/db.Store.CredentialByID, the one place the secret is read back out for Plaid client construction.
-- name: PlaidCredentialSecretByID :one
SELECT id, client_id, secret, environment, label
FROM plaid_credentials
WHERE id = @id;

-- Used by accounts/db.Store.UpsertPlaidItem during the Plaid link flow (exchangePublicToken mutation) and link-update handling to upsert the plaid_items row.
-- name: UpsertPlaidItem :one
INSERT INTO plaid_items (
  external_id, credential_id, access_token, institution_id,
  logo_url,
  next_sync_at, next_recurring_sync_at, next_balance_sync_at,
  plaid_investments_enabled, plaid_liabilities_enabled, health_state, health_updated_at
) VALUES (
  @external_id, @credential_id, @access_token, @institution_id,
  @logo_url,
  @next_sync_at, @next_recurring_sync_at, @next_balance_sync_at,
  @plaid_investments_enabled, @plaid_liabilities_enabled, 'HEALTHY', strftime('%Y-%m-%dT%H:%M:%SZ','now')
)
ON CONFLICT(external_id) DO UPDATE SET
  credential_id = excluded.credential_id,
  access_token = excluded.access_token,
  institution_id = excluded.institution_id,
  logo_url = COALESCE(excluded.logo_url, plaid_items.logo_url),
  plaid_investments_enabled = excluded.plaid_investments_enabled,
  plaid_liabilities_enabled = excluded.plaid_liabilities_enabled,
  updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
RETURNING id;

-- Used by GraphQL query plaidItems and Plaid item dataloaders via accounts/db and transactions/db.
-- name: ListPlaidItems :many
SELECT
  pi.id AS item_id,
  pi.credential_id,
  pi.institution_id,
  pi.last_synced_at,
  pi.health_state,
  pi.health_error_code,
  pi.health_error_message,
  pi.health_updated_at,
  pi.sync_cron,
  pi.recurring_sync_cron,
  pi.next_sync_at,
  pi.next_recurring_sync_at,
  c.is_active AS connection_is_active,
  pi.created_at,
  pi.updated_at
FROM plaid_items pi
JOIN connections c ON c.source_table = 'plaid_items' AND c.source_id = pi.id
JOIN owners o ON o.id = c.owner_id
WHERE TRUE
  AND c.is_active = 1 -- :if @active_only
  AND pi.id IN (sqlc.slice('ids')) -- :if @ids
ORDER BY
  o.name,
  COALESCE(c.name, pi.external_id),
  pi.id;

-- Used by ExchangePublicToken on item re-link to clear the stored cursor, forcing a full re-sync.
-- name: ResetItemSync :exec
UPDATE plaid_items
SET cursor = NULL,
    last_synced_at = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by a background maintenance loop that backfills missing Plaid institution logos.
-- name: PlaidItemsMissingLogoURL :many
SELECT
  pi.id,
  pi.external_id,
  pi.credential_id,
  pi.institution_id
FROM plaid_items pi
WHERE pi.logo_url IS NULL
  AND pi.institution_id IS NOT NULL
  AND pi.institution_id <> ''
ORDER BY pi.id;

-- Used by the same institution-logo backfill loop to persist a fetched logo URL.
-- name: SetPlaidItemLogoURL :exec
UPDATE plaid_items
SET logo_url = @logo_url,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by internal/transactions/plaid's background /transactions/sync loop to read the stored cursor before polling.
-- name: SyncCursor :one
SELECT cursor
FROM plaid_items
WHERE id = @id;

-- Used by internal/transactions/plaid's background /transactions/sync loop to persist the new cursor and schedule the next sync.
-- name: SetSyncCursor :exec
UPDATE plaid_items
SET cursor = CASE WHEN CAST(@set_cursor AS BOOLEAN) = 1 THEN @cursor ELSE cursor END,
    next_sync_at = @next_sync_at,
    last_synced_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by internal/wealth's Plaid balance-sync adapter to schedule an item's next balance sync.
-- name: SetItemBalanceSynced :exec
UPDATE plaid_items
SET next_balance_sync_at = @next_balance_sync_at,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by internal/transactions/plaid's health monitor to record Plaid API health/error state changes for an item.
-- name: SetPlaidItemHealth :exec
UPDATE plaid_items
SET health_state = @health_state,
    health_error_code = @health_error_code,
    health_error_message = @health_error_message,
    health_updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by the Plaid link/link-update flow to toggle product availability for an item.
-- name: SetPlaidProductFlags :exec
UPDATE plaid_items
SET plaid_investments_enabled = @plaid_investments_enabled,
    plaid_liabilities_enabled = @plaid_liabilities_enabled,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by internal/transactions/plaid's background recurring-charge sync loop to record a completed pass and schedule the next one.
-- last_recurring_synced_at is intentionally write-only audit metadata; scheduling uses next_recurring_sync_at.
-- name: SetItemRecurringSynced :exec
UPDATE plaid_items
SET last_recurring_synced_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
    next_recurring_sync_at = @next_recurring_sync_at,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by Plaid sync loops to select due active items, and by one-off item sync to fetch a single item secret.
-- name: PlaidItemsDue :many
SELECT
  sqlc.embed(pi),
  c.owner_id,
  o.name AS owner,
  c.name AS institution_name
FROM plaid_items pi
JOIN connections c ON c.source_id = pi.id AND c.source_table = 'plaid_items'
JOIN owners o ON o.id = c.owner_id
WHERE TRUE
  AND c.is_active = 1 -- :if @due_only
  AND pi.id = @id -- :if @id
  AND COALESCE(CASE CAST(@kind AS TEXT) WHEN 'sync' THEN pi.next_sync_at WHEN 'recurring' THEN pi.next_recurring_sync_at ELSE pi.next_balance_sync_at END, @now) <= @now -- :if @due_only
  AND (
    CAST(@kind AS TEXT) != 'balance'
    OR NOT EXISTS (
      SELECT 1
      FROM accounts a
      WHERE a.connection_id = c.id
        AND a.manual = 0
    )
    OR EXISTS (
      SELECT 1
      FROM accounts a
      WHERE a.connection_id = c.id
        AND a.manual = 0
        AND a.is_closed = 0
    )
  )
ORDER BY pi.id;
