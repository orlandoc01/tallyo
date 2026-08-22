-- Used by GraphQL mutation updateTransaction and bulkUpdateTransactions via transactions/db.Store.
-- name: UpdateTransactionFieldsByIDs :execrows
UPDATE transactions
SET merchant_name = CASE WHEN CAST(@set_merchant_name AS BOOLEAN) = 1 THEN sqlc.narg('merchant_name') ELSE merchant_name END,
    notes = CASE WHEN CAST(@set_notes AS BOOLEAN) = 1 THEN sqlc.narg('notes') ELSE notes END,
    is_recurring = CASE WHEN CAST(@set_recurring AS BOOLEAN) = 1 THEN @is_recurring ELSE is_recurring END,
    is_hidden = CASE WHEN CAST(@set_hidden AS BOOLEAN) = 1 THEN @is_hidden ELSE is_hidden END,
    category_id = CASE WHEN CAST(@set_category AS BOOLEAN) = 1 THEN @category_id ELSE category_id END,
    is_reviewed = CASE WHEN CAST(@set_category AS BOOLEAN) = 1 THEN 1 ELSE is_reviewed END,
    staged_for_llm = CASE WHEN CAST(@set_category AS BOOLEAN) = 1 THEN 0 ELSE staged_for_llm END,
    pfc2_categorized = CASE WHEN CAST(@set_category AS BOOLEAN) = 1 THEN 0 ELSE pfc2_categorized END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id IN (sqlc.slice('ids'));

-- Used by GraphQL mutation createTransaction to insert manually sourced
-- transactions, and by the CSV import flow as the first (insert) half of its
-- upsert. A (source, external_id) conflict does nothing and returns no row
-- (sql.ErrNoRows): manual creation reads that as "retry with a new synthetic
-- ID"; import reads it as "fall back to UpdateTransactionBySourceExternalID".
-- name: InsertTransaction :one
INSERT INTO transactions (
  source,
  external_id,
  account_id,
  amount_cents,
  datetime,
  posted_datetime,
  merchant_name,
  original_name,
  category_id,
  is_reviewed,
  is_recurring,
  is_hidden,
  pending,
  notes
)
VALUES (
  @source,
  @external_id,
  @account_id,
  @amount_cents,
  @datetime,
  @posted_datetime,
  @merchant_name,
  @original_name,
  @category_id,
  @is_reviewed,
  @is_recurring,
  @is_hidden,
  0,
  @notes
)
ON CONFLICT(source, external_id) DO NOTHING
RETURNING id;

-- Used by the CSV import flow when InsertTransaction found an existing row
-- for (source, external_id); mirrors the fields InsertTransaction sets on a
-- fresh insert.
-- name: UpdateTransactionBySourceExternalID :one
UPDATE transactions
SET account_id = @account_id,
    amount_cents = @amount_cents,
    datetime = @datetime,
    posted_datetime = @posted_datetime,
    merchant_name = @merchant_name,
    original_name = @original_name,
    category_id = @category_id,
    is_reviewed = @is_reviewed,
    is_recurring = @is_recurring,
    is_hidden = @is_hidden,
    notes = @notes,
    staged_for_llm = 0,
    pfc2_categorized = 0,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE source = @source AND external_id = @external_id
RETURNING id;

-- Used by GraphQL query transactions / MCP (transactions/db.Store.Transactions), the CSV
-- export page (ExportTransactionPage), Transaction-by-id, and the node batch loader.
-- name: TransactionRecords :many
SELECT
  t.id, t.source, t.external_id, t.amount_cents,
  t.datetime, t.posted_datetime, t.merchant_name, t.original_name, t.logo_url,
  t.plaid_category, t.is_recurring, t.is_reviewed, t.is_hidden, t.pending,
  t.notes, t.created_at, t.updated_at,
  sqlc.embed(a),
  o.name AS owner_name,
  sqlc.embed(cr)
FROM transactions t
JOIN accounts a ON a.id = t.account_id
JOIN owners o ON o.id = a.owner_id
JOIN category_rows cr ON cr.cat_id = t.category_id
WHERE TRUE
  AND t.staged_for_llm = 0
  AND t.id IN (sqlc.slice('ids')) -- :if @ids
  AND t.id IN (SELECT rowid FROM transactions_fts WHERE transactions_fts MATCH @search_match) -- :if @search_match
  AND t.datetime >= @datetime_from -- :if @datetime_from
  AND t.datetime <  @datetime_to -- :if @datetime_to
  AND t.category_id IN (sqlc.slice('category_ids')) -- :if @category_ids
  AND t.id IN (SELECT transaction_id FROM transaction_tags WHERE transaction_tags.tag_id IN (sqlc.slice('tag_ids'))) -- :if @tag_ids
  AND t.id NOT IN (SELECT transaction_id FROM transaction_tags) -- :if @untagged
  AND t.account_id IN (sqlc.slice('account_ids')) -- :if @account_ids
  AND a.owner_id IN (sqlc.slice('owner_ids')) -- :if @owner_ids
  AND t.is_reviewed = @is_reviewed -- :if @is_reviewed
  AND t.is_recurring = @is_recurring -- :if @is_recurring
  AND t.pending = @is_pending -- :if @is_pending
  AND t.is_hidden = @is_hidden -- :if @is_hidden
  AND instr(lower(coalesce(t.merchant_name, t.original_name, '')), @merchant_prefix) > 0 -- :if @merchant_prefix
  AND instr(lower(coalesce(t.original_name, '')), @original_prefix) > 0 -- :if @original_prefix
  AND t.amount_cents =  @exact_amount -- :if @exact_amount
  AND t.amount_cents >= @amount_min -- :if @amount_min
  AND t.amount_cents <= @amount_max -- :if @amount_max
  AND cr.group_kind != 'TRANSFER' -- :if @exclude_transfers
  AND cr.group_kind != 'INCOME' -- :if @exclude_income
  AND (t.datetime > @cursor_datetime OR (t.datetime = @cursor_datetime AND t.id > @cursor_id)) -- :if @cursor_datetime_gt
  AND (t.datetime < @cursor_datetime OR (t.datetime = @cursor_datetime AND t.id < @cursor_id)) -- :if @cursor_datetime_lt
  AND (t.amount_cents > @cursor_amount OR (t.amount_cents = @cursor_amount AND t.id > @cursor_id)) -- :if @cursor_amount_gt
  AND (t.amount_cents < @cursor_amount OR (t.amount_cents = @cursor_amount AND t.id < @cursor_id)) -- :if @cursor_amount_lt
ORDER BY
  t.amount_cents ASC,  -- :if @order_amount_asc
  t.amount_cents DESC, -- :if @order_amount_desc
  t.datetime ASC,      -- :if @order_datetime_asc
  t.datetime DESC,     -- :if @order_datetime_desc
  t.id ASC,            -- :if @order_id_asc
  t.id DESC,           -- :if @order_id_desc
  -- Trailing unconditional tiebreaker: t.id is unique, so this never actually
  -- breaks a tie -- it exists only so the ORDER BY always has at least one
  -- unconditional column. Without it, whichever `:if` line ends up last
  -- (varies by which toggle is set) sits right before the always-present
  -- LIMIT clause, and the dynamic-filter plugin's dangling-comma/orphaned-
  -- keyword cleanup only inspects the query's true trailing edge, so it never
  -- reaches an inactive last ORDER BY line or a comma left by an inactive one.
  t.id ASC
LIMIT @row_limit;

-- Used by transactions/db.Store.Transactions for the total count of a filtered list.
-- name: CountTransactionRecords :one
SELECT COUNT(t.id) AS total_count
FROM transactions t
JOIN accounts a ON a.id = t.account_id -- :if @owner_ids
JOIN category_rows cr ON cr.cat_id = t.category_id -- :if @excluded_kinds
WHERE TRUE
  AND t.staged_for_llm = 0
  AND t.id IN (sqlc.slice('ids')) -- :if @ids
  AND t.id IN (SELECT rowid FROM transactions_fts WHERE transactions_fts MATCH @search_match) -- :if @search_match
  AND t.datetime >= @datetime_from -- :if @datetime_from
  AND t.datetime <  @datetime_to -- :if @datetime_to
  AND t.category_id IN (sqlc.slice('category_ids')) -- :if @category_ids
  AND t.id IN (SELECT transaction_id FROM transaction_tags WHERE transaction_tags.tag_id IN (sqlc.slice('tag_ids'))) -- :if @tag_ids
  AND t.id NOT IN (SELECT transaction_id FROM transaction_tags) -- :if @untagged
  AND t.account_id IN (sqlc.slice('account_ids')) -- :if @account_ids
  AND a.owner_id IN (sqlc.slice('owner_ids')) -- :if @owner_ids
  AND t.is_reviewed = @is_reviewed -- :if @is_reviewed
  AND t.is_recurring = @is_recurring -- :if @is_recurring
  AND t.pending = @is_pending -- :if @is_pending
  AND t.is_hidden = @is_hidden -- :if @is_hidden
  AND instr(lower(coalesce(t.merchant_name, t.original_name, '')), @merchant_prefix) > 0 -- :if @merchant_prefix
  AND instr(lower(coalesce(t.original_name, '')), @original_prefix) > 0 -- :if @original_prefix
  AND t.amount_cents =  @exact_amount -- :if @exact_amount
  AND t.amount_cents >= @amount_min -- :if @amount_min
  AND t.amount_cents <= @amount_max -- :if @amount_max
  AND cr.group_kind NOT IN (sqlc.slice('excluded_kinds')) -- :if @excluded_kinds
  AND TRUE;

-- Used by GraphQL query transactionsSummary (transactions/db.Store.TransactionsSummary).
-- name: TransactionRecordsSummary :one
SELECT
  COUNT(t.id) AS total_count,
  CAST(COALESCE(SUM(t.amount_cents), 0) AS INTEGER) AS total_amount_cents,
  AVG(t.amount_cents) AS average_amount,
  CAST(COALESCE(MAX(t.amount_cents), 0) AS INTEGER) AS largest_amount_cents,
  CAST(COALESCE(MIN(substr(t.datetime, 1, 10)), '') AS TEXT) AS first_date,
  CAST(COALESCE(MAX(substr(t.datetime, 1, 10)), '') AS TEXT) AS last_date
FROM transactions t
JOIN accounts a ON a.id = t.account_id -- :if @owner_ids
JOIN category_rows cr ON cr.cat_id = t.category_id -- :if @excluded_kinds
WHERE TRUE
  AND t.id IN (sqlc.slice('ids')) -- :if @ids
  AND t.id IN (SELECT rowid FROM transactions_fts WHERE transactions_fts MATCH @search_match) -- :if @search_match
  AND t.datetime >= @datetime_from -- :if @datetime_from
  AND t.datetime <  @datetime_to -- :if @datetime_to
  AND t.category_id IN (sqlc.slice('category_ids')) -- :if @category_ids
  AND t.id IN (SELECT transaction_id FROM transaction_tags WHERE transaction_tags.tag_id IN (sqlc.slice('tag_ids'))) -- :if @tag_ids
  AND t.id NOT IN (SELECT transaction_id FROM transaction_tags) -- :if @untagged
  AND t.account_id IN (sqlc.slice('account_ids')) -- :if @account_ids
  AND a.owner_id IN (sqlc.slice('owner_ids')) -- :if @owner_ids
  AND t.is_reviewed = @is_reviewed -- :if @is_reviewed
  AND t.is_recurring = @is_recurring -- :if @is_recurring
  AND t.pending = @is_pending -- :if @is_pending
  AND t.is_hidden = @is_hidden -- :if @is_hidden
  AND instr(lower(coalesce(t.merchant_name, t.original_name, '')), @merchant_prefix) > 0 -- :if @merchant_prefix
  AND instr(lower(coalesce(t.original_name, '')), @original_prefix) > 0 -- :if @original_prefix
  AND t.amount_cents =  @exact_amount -- :if @exact_amount
  AND t.amount_cents >= @amount_min -- :if @amount_min
  AND t.amount_cents <= @amount_max -- :if @amount_max
  AND cr.group_kind NOT IN (sqlc.slice('excluded_kinds')) -- :if @excluded_kinds
  AND t.staged_for_llm = 0;

-- Used by transactions/db.Store bulk update/delete to resolve target ids from a filter.
-- name: TransactionIDsByFilter :many
SELECT t.id
FROM transactions t
JOIN accounts a ON a.id = t.account_id
JOIN category_rows cr ON cr.cat_id = t.category_id
WHERE TRUE
  AND t.staged_for_llm = 0
  AND t.id IN (sqlc.slice('ids')) -- :if @ids
  AND t.id IN (SELECT rowid FROM transactions_fts WHERE transactions_fts MATCH @search_match) -- :if @search_match
  AND t.datetime >= @datetime_from -- :if @datetime_from
  AND t.datetime <  @datetime_to -- :if @datetime_to
  AND t.category_id IN (sqlc.slice('category_ids')) -- :if @category_ids
  AND t.id IN (SELECT transaction_id FROM transaction_tags WHERE transaction_tags.tag_id IN (sqlc.slice('tag_ids'))) -- :if @tag_ids
  AND t.id NOT IN (SELECT transaction_id FROM transaction_tags) -- :if @untagged
  AND t.account_id IN (sqlc.slice('account_ids')) -- :if @account_ids
  AND a.owner_id IN (sqlc.slice('owner_ids')) -- :if @owner_ids
  AND t.is_reviewed = @is_reviewed -- :if @is_reviewed
  AND t.is_recurring = @is_recurring -- :if @is_recurring
  AND t.pending = @is_pending -- :if @is_pending
  AND t.is_hidden = @is_hidden -- :if @is_hidden
  AND instr(lower(coalesce(t.merchant_name, t.original_name, '')), @merchant_prefix) > 0 -- :if @merchant_prefix
  AND instr(lower(coalesce(t.original_name, '')), @original_prefix) > 0 -- :if @original_prefix
  AND t.amount_cents =  @exact_amount -- :if @exact_amount
  AND t.amount_cents >= @amount_min -- :if @amount_min
  AND t.amount_cents <= @amount_max -- :if @amount_max
  AND cr.group_kind != 'TRANSFER' -- :if @exclude_transfers
  AND cr.group_kind != 'INCOME' -- :if @exclude_income
  AND TRUE;
