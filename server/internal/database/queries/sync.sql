-- Used by internal/transactions/plaid's background sync loop to record per-batch added/modified/removed counts after each /transactions/sync call.
-- name: LogSyncBatch :exec
INSERT INTO plaid_sync_log (item_id, api, added, modified, removed)
VALUES (@item_id, @api, @added, @modified, @removed);

-- Used by internal/transactions/plaid's sync persister to check whether a transaction already exists and preserve its user-set review state/category before upserting.
-- name: SyncedTransactionState :one
SELECT is_reviewed, category_id
FROM transactions
WHERE external_id = @external_id
  AND source = @source;

-- Used by internal/transactions/plaid's (and SimpleFIN's) background sync loop to upsert transactions returned by the provider, overwriting only provider-sourced fields when the transaction has already been reviewed.
-- name: UpsertSyncedTransaction :one
INSERT INTO transactions (
  external_id,
  account_id,
  amount_cents,
  datetime,
  posted_datetime,
  merchant_name,
  original_name,
  logo_url,
  category_id,
  is_reviewed,
  plaid_category,
  raw_provider_json,
  source,
  pending,
  is_recurring,
  is_hidden,
  staged_for_llm,
  pfc2_categorized
) VALUES (
  @external_id,
  @account_id,
  @amount_cents,
  @datetime,
  @posted_datetime,
  @merchant_name,
  @original_name,
  @logo_url,
  @category_id,
  @is_reviewed,
  @plaid_category,
  @raw_provider_json,
  @source,
  @pending,
  @is_recurring,
  @is_hidden,
  @staged_for_llm,
  @pfc2_categorized
)
ON CONFLICT(source, external_id) DO UPDATE SET
  account_id = excluded.account_id,
  amount_cents = excluded.amount_cents,
  datetime = excluded.datetime,
  posted_datetime = excluded.posted_datetime,
  merchant_name = excluded.merchant_name,
  original_name = excluded.original_name,
  logo_url = excluded.logo_url,
  category_id = CASE
    WHEN transactions.is_reviewed = 1 THEN transactions.category_id
    ELSE excluded.category_id
  END,
  is_reviewed = CASE
    WHEN transactions.is_reviewed = 1 THEN transactions.is_reviewed
    ELSE excluded.is_reviewed
  END,
  staged_for_llm = CASE
    WHEN transactions.is_reviewed = 1 THEN transactions.staged_for_llm
    ELSE excluded.staged_for_llm
  END,
  pfc2_categorized = CASE
    WHEN transactions.is_reviewed = 1 THEN transactions.pfc2_categorized
    ELSE excluded.pfc2_categorized
  END,
  plaid_category = excluded.plaid_category,
  raw_provider_json = excluded.raw_provider_json,
  pending = excluded.pending,
  updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
RETURNING id;
