-- Used by the shared wealth snapshot sink to persist the provider state for one flagged snapshot.
-- name: InsertSnapshotProviderState :exec
INSERT OR REPLACE INTO account_balance_snapshot_provider_states (
  snapshot_id,
  provider_balance_usd_cents,
  provider_holdings_json
) VALUES (
  @snapshot_id,
  @provider_balance_usd_cents,
  @provider_holdings_json
);

-- Used when a clean snapshot recovers a review range, a review resolution consumes provider restoration state, or (with no date bounds) clean snapshots or manual edits make all provider restoration state unreachable for an account.
-- name: DeleteSnapshotProviderStatesBetweenDates :exec
DELETE FROM account_balance_snapshot_provider_states
WHERE snapshot_id IN (
  SELECT id
  FROM account_balance_daily_snapshots
  WHERE TRUE
    AND date >= CASE WHEN CAST(@inclusive AS BOOLEAN) = 1 THEN @after_date ELSE date(@after_date, '+1 day') END -- :if @after_date
    AND date <= CASE WHEN CAST(@inclusive AS BOOLEAN) = 1 THEN @before_date ELSE date(@before_date, '-1 day') END -- :if @before_date
    AND account_id = @account_id
);

-- Used by USE_PROVIDER to restore each flagged snapshot from that date's provider state.
-- name: FlaggedSnapshotsWithProviderStatesForReview :many
SELECT
  s.id,
  s.date,
  ps.snapshot_id IS NULL AS missing_provider_state,
  COALESCE(ps.provider_balance_usd_cents, 0) AS provider_balance_usd_cents,
  CAST(COALESCE(ps.provider_holdings_json, '') AS TEXT) AS provider_holdings_json
FROM account_balance_daily_snapshots s
LEFT JOIN account_balance_snapshot_provider_states ps ON ps.snapshot_id = s.id
WHERE s.account_id = @account_id
  AND s.flagged = 1
  AND s.date >= @start_date
  AND s.date <= @end_date
ORDER BY s.date, s.id;

-- Used after snapshot replacement to keep the review's displayed count distinct by persisted row.
-- name: RecountBalanceReviewFlaggedSnapshots :exec
UPDATE account_balance_snapshot_reviews
SET flagged_snapshot_count = (
  SELECT COUNT(DISTINCT s.id)
  FROM account_balance_daily_snapshots s
  WHERE s.account_id = account_balance_snapshot_reviews.account_id
    AND s.date BETWEEN account_balance_snapshot_reviews.first_flagged_date
                   AND account_balance_snapshot_reviews.latest_flagged_date
    AND s.flagged = 1
),
updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE account_balance_snapshot_reviews.id = @id;
