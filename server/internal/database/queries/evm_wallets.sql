-- Used by accounts/db.Store.CreateEVMWallet (EVM wallet link flow) to create the wallet row.
-- name: InsertEVMWallet :one
INSERT INTO evm_wallets (address, label, chain_ids)
VALUES (@address, @label, @chain_ids)
RETURNING id;

-- Used by the EVM wallet dataloader and DeBank background sync loop.
-- name: EVMWallets :many
SELECT c.id AS connection_id, w.id, w.address, w.chain_ids, c.owner_id, w.label, w.created_at,
       w.next_balance_sync_at
FROM evm_wallets w
JOIN connections c ON c.source_table = 'evm_wallets' AND c.source_id = w.id
WHERE TRUE
  AND c.id IN (sqlc.slice('connection_ids')) -- :if @connection_ids
  AND c.is_active = 1 -- :if @due_only
  AND (w.next_balance_sync_at IS NULL OR w.next_balance_sync_at <= @now) -- :if @due_only
  AND EXISTS (SELECT 1 FROM accounts a WHERE a.connection_id = c.id AND a.manual = 0 AND a.type = 'CRYPTO_WALLET' AND a.is_closed = 0) -- :if @due_only
ORDER BY
  w.created_at, -- :if @due_only
  c.id;

-- Used by internal/wealth's DeBank sync loop to record a completed balance sync and schedule the next one.
-- name: SetEVMWalletBalanceSynced :exec
UPDATE evm_wallets
SET next_balance_sync_at = @next_balance_sync_at,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id;

-- Used by GraphQL mutation updateConnection via accounts/db.Store to change a wallet's tracked chain list.
-- name: UpdateEVMWalletChainIDs :exec
UPDATE evm_wallets
SET chain_ids = @chain_ids,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = (
    SELECT source_id
    FROM connections
    WHERE connections.id = @connection_id
      AND connections.source_table = 'evm_wallets'
);

-- Used by accounts/db.Store.DeleteEVMWallet to find the wallet's account before deleting it.
-- name: EVMWalletAccountID :one
SELECT a.id
FROM accounts a
JOIN connections c ON c.id = a.connection_id
WHERE c.source_table = 'evm_wallets'
  AND c.source_id = @wallet_id
  AND a.manual = 0
  AND a.type = 'CRYPTO_WALLET';
