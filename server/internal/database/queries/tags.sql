-- Used by GraphQL tag list and node lookup paths with an optional ID filter.
-- name: ListTags :many
SELECT id, name, color, transaction_count
FROM tags
WHERE TRUE
  AND id = @id -- :if @id
ORDER BY name, id;

-- Used by GraphQL mutation createTag via transactions/db.Store.CreateTag.
-- name: CreateTag :one
INSERT INTO tags (name, color) VALUES (@name, @color) RETURNING id, name, color, transaction_count;

-- Used by GraphQL mutation updateTag via transactions/db.Store.UpdateTag.
-- name: UpdateTag :one
UPDATE tags
SET name = @name,
    color = @color,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id
RETURNING id, name, color, transaction_count;

-- Used by GraphQL mutation deleteTag via transactions/db.Store.DeleteTag.
-- name: DeleteTag :execrows
DELETE FROM tags WHERE id = @id;

-- Used by the Transaction.tags dataloader (internal/graph/loaders.go) to batch-load tags for a list of transactions.
-- name: TagsByTransactionIDs :many
SELECT tt.transaction_id, t.id, t.name, t.color, t.transaction_count
FROM transaction_tags tt
JOIN tags t ON t.id = tt.tag_id
WHERE tt.transaction_id IN (sqlc.slice('transaction_ids'))
ORDER BY tt.transaction_id, t.name, t.id;

-- Used when applying a rule retroactively (createRule/updateRule with applyRetroactively=true) to add the rule's tags to every matching transaction in bulk.
-- name: AddTransactionTagsByTransactionIDs :exec
INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
SELECT tx.id, tags.id
FROM transactions tx
JOIN tags ON tags.id IN (sqlc.slice('tag_ids'))
WHERE tx.id IN (sqlc.slice('transaction_ids'));

-- Used by transaction update mutations to clear existing tags before re-applying the updated set.
-- name: DeleteTransactionTagsByTransactionIDs :exec
DELETE FROM transaction_tags WHERE transaction_id IN (sqlc.slice('transaction_ids'));
