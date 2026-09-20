-- Used by internal/wealth's service layer to batch-fetch last balance-sync timestamps for multiple accounts.
-- name: AccountLastBalanceSyncedAtForAccounts :many
SELECT account_id, last_balance_synced_at
FROM account_sync_state
WHERE account_id IN (sqlc.slice('account_ids'));

-- Used by every wealth adapter's persister (Plaid, SimpleFIN, DeBank, real estate, manual) to record that an account's balance was just synced.
-- name: MarkAccountBalanceSynced :exec
INSERT INTO account_sync_state (account_id, last_balance_synced_at)
VALUES (@account_id, @last_balance_synced_at)
ON CONFLICT(account_id) DO UPDATE SET
  last_balance_synced_at = excluded.last_balance_synced_at;
