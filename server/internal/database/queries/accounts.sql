-- Used by GraphQL query accounts (accounts.graphql) via accounts/db.Store, filterable by id, Plaid item, or an id list (for the Account dataloader).
-- name: AccountRecords :many
SELECT
  sqlc.embed(a),
  o.name AS owner_name
FROM accounts a
JOIN owners o ON o.id = a.owner_id
WHERE TRUE
  AND a.id = @id -- :if @id
  AND EXISTS (SELECT 1 FROM connections c WHERE c.id = a.connection_id AND c.source_id = @item_id AND c.source_table = 'plaid_items') -- :if @item_id
  AND a.id IN (sqlc.slice('ids')) -- :if @ids
  AND a.external_id IN (sqlc.slice('external_ids')) -- :if @external_ids
ORDER BY o.name, a.name;

-- Used by source-backed GraphQL dataloaders to batch-load accounts per connection source.
-- name: AccountsByConnectionSources :many
SELECT
  c.source_id,
  sqlc.embed(a),
  o.name AS owner_name
FROM accounts a
JOIN owners o ON o.id = a.owner_id
JOIN connections c ON c.id = a.connection_id
WHERE c.source_table = @source_table
  AND c.source_id IN (sqlc.slice('source_ids'))
ORDER BY c.source_id, o.name, a.name;

-- Used by the Plaid and SimpleFIN sync adapters (via accounts/db.Store.UpsertAccountWithExternalID) to upsert an externally-discovered account, preserving the stored/user-corrected subtype on re-sync.
-- name: UpsertAccount :one
INSERT INTO accounts (external_id, connection_id, owner_id, name, type, subtype, mask, notes, is_closed, is_hidden, needs_review, review_reason, manual)
VALUES (@external_id, @connection_id, @owner_id, @name, @type, @subtype, @mask, @notes, @is_closed, @is_hidden, @needs_review, CASE WHEN @needs_review = 1 THEN 'TYPE' ELSE NULL END, 0)
ON CONFLICT(external_id) DO UPDATE SET
  connection_id = excluded.connection_id,
  owner_id = excluded.owner_id,
  name = excluded.name,
  -- type is classified once on insert and preserved on conflict so provider
  -- re-syncs never clobber the stored (or user-corrected) account type.
  -- needs_review/review_reason follow the same insert-only semantics and are
  -- cleared only by updateAccount when the user confirms the type.
  subtype = COALESCE(accounts.subtype, excluded.subtype),
  mask = excluded.mask,
  updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
RETURNING id;

-- Used by GraphQL mutation createManualAccount via accounts/db.Store.
-- name: InsertManualAccount :one
INSERT INTO accounts (external_id, connection_id, owner_id, name, type, subtype, mask, notes, is_closed, is_hidden, manual)
VALUES (@external_id, @connection_id, @owner_id, @name, @type, NULL, NULL, @notes, @is_closed, @is_hidden, 1)
ON CONFLICT(external_id) DO NOTHING
RETURNING id;

-- Used by EVM wallet and real estate link flows to create their generated account rows.
-- name: InsertLinkedAccount :one
INSERT INTO accounts (external_id, connection_id, owner_id, name, type, is_closed, is_hidden, manual)
VALUES (@external_id, @connection_id, @owner_id, @name, @type, 0, 0, 0)
RETURNING id;

-- Used by GraphQL mutation updateAccount via accounts/db.Store.UpdateAccount.
-- name: UpdateAccountFields :execrows
UPDATE accounts
SET name = CASE WHEN CAST(@set_name AS BOOLEAN) = 1 THEN @name ELSE name END,
    owner_id = CASE WHEN CAST(@set_owner AS BOOLEAN) = 1 THEN sqlc.narg('owner_id') ELSE owner_id END,
    type = CASE WHEN CAST(@set_type AS BOOLEAN) = 1 THEN @type ELSE type END,
    subtype = CASE WHEN CAST(@set_subtype AS BOOLEAN) = 1 THEN sqlc.narg('subtype') ELSE subtype END,
    notes = CASE WHEN CAST(@set_notes AS BOOLEAN) = 1 THEN sqlc.narg('notes') ELSE notes END,
    is_closed = CASE WHEN CAST(@set_closed AS BOOLEAN) = 1 THEN @is_closed ELSE is_closed END,
    is_hidden = CASE WHEN CAST(@set_hidden AS BOOLEAN) = 1 THEN @is_hidden ELSE is_hidden END,
    needs_review = CASE WHEN CAST(@set_type AS BOOLEAN) = 1 THEN 0 ELSE needs_review END,
    review_reason = CASE WHEN CAST(@set_type AS BOOLEAN) = 1 THEN NULL ELSE review_reason END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by accounts/db.Store.UpdateAccount when the hidden toggle flips, to retroactively set is_hidden on all of the account's existing transactions.
-- name: UpdateTransactionsHiddenByAccount :exec
UPDATE transactions
SET is_hidden = @is_hidden,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE account_id = @account_id
  AND is_hidden <> @is_hidden;

-- Used by GraphQL mutation removeManualAccount via accounts/db.Store.
-- name: DeleteManualAccountByID :execrows
DELETE FROM accounts
WHERE id = @id
  AND manual = 1;

-- Used by accounts/db.Store.DeleteConnection to preserve which accounts were user-hidden before removing them.
-- name: HiddenAccountIDsByConnection :many
SELECT external_id
FROM accounts
WHERE connection_id = @connection_id
  AND is_hidden = 1;
