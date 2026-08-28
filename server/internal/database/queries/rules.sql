-- Used by GraphQL rule list/node resolvers and internally by transactions/db.Store.CreateRule/UpdateRule to return rules after mutations.
-- name: ListRules :many
SELECT
  sqlc.embed(r),
  cr.cat_id,
  cr.cat_name,
  cr.cat_emoji,
  cr.group_name,
  cr.group_emoji,
  cr.group_kind,
  cr.sort_order,
  cr.plaid_pfc2_codes
FROM rules r
LEFT JOIN category_rows cr ON cr.cat_id = r.category_id
WHERE TRUE
  AND r.id = @id -- :if @id
  AND instr(lower(r.merchant_pattern), @merchant_pattern) > 0 -- :if @merchant_pattern
  AND instr(lower(r.original_pattern), @original_pattern) > 0 -- :if @original_pattern
  AND (r.amount_max_cents IS NULL OR r.amount_max_cents >= @amount_min_cents) -- :if @amount_min_cents
  AND (r.amount_min_cents IS NULL OR r.amount_min_cents <= @amount_max_cents) -- :if @amount_max_cents
  AND EXISTS (SELECT 1 FROM rule_accounts filter_ra WHERE filter_ra.rule_id = r.id AND filter_ra.account_id IN (sqlc.slice('account_ids'))) -- :if @account_ids
ORDER BY r.priority DESC, r.id DESC;

-- Used by GraphQL mutation createRule via transactions/db.Store.CreateRule.
-- name: CreateRule :one
INSERT INTO rules (merchant_pattern, original_pattern, merchant_name, category_id, should_hide, should_be_recurring, amount_min_cents, amount_max_cents, priority)
VALUES (@merchant_pattern, @original_pattern, sqlc.narg('merchant_name'), @category_id, @should_hide, @should_be_recurring, @amount_min_cents, @amount_max_cents, @priority)
RETURNING id;

-- Used by GraphQL mutation updateRule via transactions/db.Store.UpdateRule.
-- name: UpdateRule :execrows
UPDATE rules
SET merchant_pattern = @merchant_pattern,
    original_pattern = @original_pattern,
    merchant_name = sqlc.narg('merchant_name'),
    category_id = @category_id,
    should_hide = @should_hide,
    should_be_recurring = @should_be_recurring,
    amount_min_cents = @amount_min_cents,
    amount_max_cents = @amount_max_cents,
    priority = @priority
WHERE id = @id;

-- Used by GraphQL mutation deleteRule via transactions/db.Store.DeleteRule.
-- name: DeleteRule :execrows
DELETE FROM rules
WHERE id = @id;

-- Used by transactions/db.Store.UpdateRule to clear a rule's account associations before re-inserting the updated set, in the same transaction as the rule UPDATE.
-- name: DeleteRuleAccounts :exec
DELETE FROM rule_accounts
WHERE rule_id = @rule_id;

-- Used by transactions/db.Store.CreateRule/UpdateRule to associate a rule with a specific account.
-- name: InsertRuleAccount :exec
INSERT INTO rule_accounts (rule_id, account_id)
VALUES (@rule_id, @account_id);

-- Used by transactions/db.Store.UpdateRule to clear a rule's tag associations before re-inserting the updated set.
-- name: DeleteRuleTags :exec
DELETE FROM rule_tags
WHERE rule_id = @rule_id;

-- Used by transactions/db.Store.CreateRule/UpdateRule to associate a tag with a rule.
-- name: InsertRuleTag :exec
INSERT OR IGNORE INTO rule_tags (rule_id, tag_id)
VALUES (@rule_id, @tag_id);

-- Used by transactions/db.Store to batch-populate rule tags when returning rules via GraphQL.
-- name: TagsByRuleIDs :many
SELECT
  rt.rule_id,
  sqlc.embed(t)
FROM tags t
JOIN rule_tags rt ON rt.tag_id = t.id
WHERE rt.rule_id IN (sqlc.slice('rule_ids'))
ORDER BY rt.rule_id, t.name, t.id;

-- Used by the Rule.accounts GraphQL field's dataloader (internal/graph/loaders.go) to batch-load accounts scoped to each rule.
-- name: AccountsByRuleIDs :many
SELECT
  ra.rule_id,
  sqlc.embed(a),
  o.name AS owner_name
FROM accounts a
JOIN owners o ON o.id = a.owner_id
JOIN rule_accounts ra ON ra.account_id = a.id
WHERE ra.rule_id IN (sqlc.slice('rule_ids'))
ORDER BY ra.rule_id, o.name, a.name;

-- Used by transactions/db rule create/update to collect transaction ids for retroactive
-- application; mirrors AutoRuleResult's instr()-based matching.
-- name: RetroactiveRuleTransactionIDs :many
SELECT t.id
FROM transactions t
WHERE TRUE
  AND (
        FALSE
        OR instr(lower(coalesce(t.merchant_name, t.original_name, '')), @merchant_pattern) > 0 -- :if @merchant_pattern
        OR instr(lower(coalesce(t.original_name, '')), @original_pattern) > 0 -- :if @original_pattern
      )
  AND t.amount_cents >= @amount_min -- :if @amount_min
  AND t.amount_cents <= @amount_max -- :if @amount_max
  AND t.account_id IN (sqlc.slice('account_ids')) -- :if @account_ids
  -- Trailing unconditional guard: the dynamic-filter plugin drops the ":if"
  -- annotation on a query's final physical WHERE line, silently making that
  -- predicate unconditional (confirmed against the pinned sqlc-gen-go build).
  -- Keeping a real, always-true predicate last avoids that.
  AND TRUE;
