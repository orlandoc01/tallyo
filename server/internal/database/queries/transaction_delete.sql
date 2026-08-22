-- Used by internal/transactions/plaid's sync persister to remove a transaction when the provider reports it as removed.
-- name: DeleteSyncedTransaction :execrows
DELETE FROM transactions
WHERE source = @source
  AND external_id = @external_id;

-- Used by GraphQL mutation bulkDeleteTransactions via transactions/db.Store.BulkDeleteTransactions.
-- name: DeleteTransactionsByIDs :execrows
DELETE FROM transactions
WHERE id IN (sqlc.slice('ids'));
