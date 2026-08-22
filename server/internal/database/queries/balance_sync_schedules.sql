-- Used by wealth adapters (Plaid, SimpleFIN, DeBank, real estate, manual) to check whether an account's balance sync schedule is due.
-- name: BalanceSyncScheduleDue :one
SELECT balance_sync_cron
FROM balance_sync_schedules
WHERE TRUE
  AND (next_balance_sync_at IS NULL OR next_balance_sync_at <= @now) -- :if @due_only
  AND id = @id;

-- Used by wealth adapters to record a completed balance sync and schedule the next one.
-- name: SetBalanceSyncScheduleSynced :exec
UPDATE balance_sync_schedules
SET next_balance_sync_at = @next_balance_sync_at
WHERE id = @id;
