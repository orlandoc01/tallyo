-- Used by internal/transactions/categorizer during sync to find the highest-priority rule matching a transaction's merchant/original name, amount, and account.
-- name: AutoRuleResult :one
SELECT
  r.category_id,
  r.merchant_name,
  r.should_hide,
  r.should_be_recurring,
  CAST(COALESCE((
    SELECT group_concat(rt.tag_id, ',')
    FROM rule_tags rt
    WHERE rt.rule_id = r.id
  ), '') AS TEXT) AS tag_ids
FROM rules r
LEFT JOIN rule_accounts ra ON ra.rule_id = r.id
WHERE (
    (r.merchant_pattern != '' AND instr(lower(@merchant), lower(r.merchant_pattern)) > 0)
    OR (r.original_pattern != '' AND instr(lower(@original_name), lower(r.original_pattern)) > 0)
  )
  AND (r.amount_min_cents IS NULL OR @amount_cents >= r.amount_min_cents)
  AND (r.amount_max_cents IS NULL OR @amount_cents <= r.amount_max_cents)
  AND (ra.account_id IS NULL OR ra.account_id = @account_id)
ORDER BY r.priority DESC, r.id DESC
LIMIT 1;

-- Used by internal/transactions/categorizer as the fallback tier after rules: maps a Plaid personal_finance_category to an internal category.
-- name: PlaidCategoryIDByDetailed :one
SELECT category_id
FROM plaid_category_mappings
WHERE plaid_detailed = @plaid_detailed;
