-- Used by GraphQL query balanceSnapshotReviews (wealth.graphql) to list flagged snapshots awaiting a human decision.
-- name: ListInReviewBalanceReviews :many
SELECT
  r.id,
  r.account_id,
  r.decision,
  r.first_flagged_date,
  r.latest_flagged_date,
  r.flagged_snapshot_count,
  r.provider_balance_usd_cents,
  r.carry_forward_balance_usd_cents,
  r.flag_reason,
  r.created_at,
  r.updated_at,
  sqlc.embed(a),
  o.name AS owner_name
FROM account_balance_snapshot_reviews r
JOIN accounts a ON a.id = r.account_id
JOIN owners o ON o.id = a.owner_id
WHERE TRUE
  AND r.id = @id -- :if @id
  AND r.decision = 'IN_REVIEW' -- :if @in_review_only
ORDER BY r.latest_flagged_date DESC;

-- Used by wealth adapters (via BaseAdapter.ApprovedReviewMatches) to check whether an already-approved review covers the current provider balance, so they carry it forward instead of re-flagging.
-- name: GetApprovedBalanceReviewByAccount :one
SELECT r.provider_balance_usd_cents
FROM account_balance_snapshot_reviews r
WHERE r.account_id = @account_id
  AND r.decision = 'APPROVED_CHANGES';

-- Used by internal/wealth's flagging flow (EmitFlagged) to create or update a balance review when a snapshot is flagged with anomaly reasons.
-- name: UpsertBalanceReview :one
INSERT INTO account_balance_snapshot_reviews (
  account_id, decision, first_flagged_date, latest_flagged_date,
  flagged_snapshot_count, provider_balance_usd_cents, carry_forward_balance_usd_cents,
  flag_reason
) VALUES (
  @account_id, 'IN_REVIEW', @first_flagged_date, @latest_flagged_date,
  @flagged_snapshot_count, @provider_balance_usd_cents, @carry_forward_balance_usd_cents,
  @flag_reason
)
ON CONFLICT(account_id) DO UPDATE SET
  decision = 'IN_REVIEW',
  first_flagged_date = CASE
    WHEN account_balance_snapshot_reviews.decision = 'APPROVED_CHANGES'
    THEN excluded.first_flagged_date
    ELSE MIN(excluded.first_flagged_date, account_balance_snapshot_reviews.first_flagged_date)
  END,
  latest_flagged_date = CASE
    WHEN account_balance_snapshot_reviews.decision = 'APPROVED_CHANGES'
    THEN excluded.latest_flagged_date
    ELSE MAX(excluded.latest_flagged_date, account_balance_snapshot_reviews.latest_flagged_date)
  END,
  flagged_snapshot_count = CASE
    WHEN account_balance_snapshot_reviews.decision = 'APPROVED_CHANGES'
    THEN excluded.flagged_snapshot_count
    ELSE account_balance_snapshot_reviews.flagged_snapshot_count + excluded.flagged_snapshot_count
  END,
  provider_balance_usd_cents = excluded.provider_balance_usd_cents,
  carry_forward_balance_usd_cents = excluded.carry_forward_balance_usd_cents,
  flag_reason = excluded.flag_reason,
  updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
RETURNING id;

-- Used by GraphQL mutation resolveBalanceReview (wealth.graphql) to mark a review approved when the user accepts the provider's change.
-- name: ApproveInReviewBalanceReview :execrows
UPDATE account_balance_snapshot_reviews
SET decision = 'APPROVED_CHANGES',
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id
  AND decision = 'IN_REVIEW';

-- Used by review resolution to delete one balance review by ID.
-- name: DeleteBalanceReviewByID :exec
DELETE FROM account_balance_snapshot_reviews
WHERE id = @id;

-- Used by clean provider snapshots, recovery, and manual edits to delete an account's reviews, optionally scoped to a decision.
-- name: DeleteBalanceReviewsByAccountID :exec
DELETE FROM account_balance_snapshot_reviews
WHERE TRUE
  AND decision = @decision -- :if @decision
  AND account_id = @account_id;

-- Used by manual snapshot edits to reject changes while a review is pending.
-- name: InReviewBalanceReviewExists :one
SELECT EXISTS(
  SELECT 1
  FROM account_balance_snapshot_reviews
  WHERE account_id = @account_id
    AND decision = 'IN_REVIEW'
) AS found;
