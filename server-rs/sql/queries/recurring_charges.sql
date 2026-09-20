-- Used by internal/transactions/plaid's background recurring-charge sync loop to upsert detected recurring charges.
-- name: UpsertRecurringCharge :one
INSERT INTO recurring_charges (
  external_id, account_id, description, merchant_name, frequency, status, is_active,
  average_amount_cents, last_amount_cents, first_date, last_date, is_user_modified, updated_at
) VALUES (
  @external_id, @account_id, @description, @merchant_name, @frequency, @status, @is_active,
  @average_amount_cents, @last_amount_cents, @first_date, @last_date, @is_user_modified,
  strftime('%Y-%m-%dT%H:%M:%SZ','now')
)
ON CONFLICT(external_id) DO UPDATE SET
  account_id = excluded.account_id,
  description = excluded.description,
  merchant_name = excluded.merchant_name,
  frequency = excluded.frequency,
  status = excluded.status,
  is_active = excluded.is_active,
  average_amount_cents = excluded.average_amount_cents,
  last_amount_cents = excluded.last_amount_cents,
  first_date = excluded.first_date,
  last_date = excluded.last_date,
  is_user_modified = excluded.is_user_modified,
  updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
RETURNING id;

-- Used by transactions/db's recurring-charge sync to clear a charge's transaction associations before re-linking the current set.
-- name: DeleteRecurringChargeTransactions :exec
DELETE FROM recurring_charge_transactions
WHERE charge_id = @charge_id;

-- Used by transactions/db's recurring-charge sync to associate Plaid transactions with a recurring charge.
-- name: InsertRecurringChargeTransactions :exec
INSERT OR IGNORE INTO recurring_charge_transactions (charge_id, transaction_id)
SELECT @charge_id, id
FROM transactions
WHERE source = 'plaid'
  AND external_id IN (sqlc.slice('plaid_txn_ids'));

-- Used by transactions/db's recurring-charge sync to refresh recurring flags for a Plaid item.
-- name: UpdateRecurringTransactionsForPlaidItem :exec
UPDATE transactions
SET is_recurring = EXISTS (
  SELECT 1 FROM recurring_charge_transactions rct
  JOIN recurring_charges rc ON rc.id = rct.charge_id
  WHERE rc.is_active = 1
    AND rct.transaction_id = transactions.id
    AND rc.account_id IN (
      SELECT a.id FROM accounts a JOIN connections c ON c.id = a.connection_id
      WHERE c.source_id = sqlc.arg(item_id) AND c.source_table = 'plaid_items'
    )
)
WHERE account_id IN (
    SELECT a.id FROM accounts a JOIN connections c ON c.id = a.connection_id
    WHERE c.source_id = sqlc.arg(item_id) AND c.source_table = 'plaid_items'
  )
  AND is_recurring <> EXISTS (
    SELECT 1 FROM recurring_charge_transactions rct
    JOIN recurring_charges rc ON rc.id = rct.charge_id
    WHERE rc.is_active = 1
      AND rct.transaction_id = transactions.id
      AND rc.account_id IN (
        SELECT a.id FROM accounts a JOIN connections c ON c.id = a.connection_id
        WHERE c.source_id = sqlc.arg(item_id) AND c.source_table = 'plaid_items'
      )
  );

-- Used by GraphQL query recurringCharges (transactions.graphql) via transactions/db.Store.
-- name: ListRecurringCharges :many
SELECT rc.*
FROM recurring_charges rc
JOIN accounts ON accounts.id = rc.account_id
WHERE
  rc.id = @id -- :if @id
  AND rc.status != 'TOMBSTONED'
  AND accounts.is_hidden = 0
ORDER BY rc.last_date DESC;

-- Used by the RecurringCharge.transactions GraphQL field's dataloader (internal/graph/loaders.go) to batch-load associated transaction IDs.
-- name: RecurringChargeTransactionIDsByChargeIDs :many
SELECT rct.charge_id, rct.transaction_id
FROM recurring_charge_transactions rct
WHERE rct.charge_id IN (sqlc.slice('charge_ids'))
ORDER BY rct.charge_id;

-- Used by the RecurringCharge.category GraphQL field's dataloader (internal/graph/loaders.go) to compute each charge's most-common transaction category.
-- name: MajorityCategoriesForRecurringCharges :many
WITH ranked AS (
  SELECT
    rct.charge_id,
    cr.cat_id,
    ROW_NUMBER() OVER (
      PARTITION BY rct.charge_id
      ORDER BY COUNT(*) DESC, MAX(t.datetime) DESC
    ) AS rn
  FROM recurring_charge_transactions rct
  JOIN transactions t ON t.id = rct.transaction_id
  JOIN category_rows cr ON cr.cat_id = t.category_id
  WHERE rct.charge_id IN (sqlc.slice('charge_ids'))
  GROUP BY rct.charge_id, cr.cat_id
)
SELECT ranked.charge_id, sqlc.embed(cr)
FROM ranked
JOIN category_rows cr ON cr.cat_id = ranked.cat_id
WHERE ranked.rn = 1
ORDER BY ranked.charge_id;
