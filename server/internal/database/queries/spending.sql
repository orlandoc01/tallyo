-- Used by transactions/db.Store spending reports (spendingByCategory / cashFlow).
-- name: SpendingTransactions :many
SELECT t.amount_cents, t.datetime, sqlc.embed(cr)
FROM transactions t
JOIN category_rows cr ON cr.cat_id = t.category_id
JOIN accounts a ON a.id = t.account_id -- :if @owner_ids
WHERE TRUE
  AND t.datetime >= @datetime_from
  AND t.datetime <  @datetime_to
  AND t.staged_for_llm = 0
  AND t.is_hidden = @is_hidden
  AND cr.group_kind != 'TRANSFER'
  AND cr.group_kind != 'INCOME' -- :if @exclude_income
  AND t.category_id IN (sqlc.slice('category_ids')) -- :if @category_ids
  AND t.id IN (SELECT transaction_id FROM transaction_tags WHERE transaction_tags.tag_id IN (sqlc.slice('tag_ids'))) -- :if @tag_ids
  AND t.id NOT IN (SELECT transaction_id FROM transaction_tags) -- :if @untagged
  AND a.owner_id IN (sqlc.slice('owner_ids')) -- :if @owner_ids
  AND t.account_id IN (sqlc.slice('account_ids')) -- :if @account_ids
ORDER BY t.datetime ASC;
