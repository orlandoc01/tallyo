-- Used by internal/transactions' background LLM categorizer to list expense categories as prompt context.
-- name: CategoriesForLLM :many
SELECT c.id, c.name, cg.name AS group_name
FROM categories c
JOIN category_groups cg ON cg.id = c.group_id
WHERE cg.kind = 'EXPENSE'
ORDER BY c.sort_order;

-- Used by internal/transactions' background LLM categorizer to fetch transactions staged for categorization.
-- name: UncategorizedForLLM :many
SELECT id, merchant_name, original_name, amount_cents, plaid_category, pfc2_categorized
FROM transactions
WHERE staged_for_llm = 1
ORDER BY datetime DESC
LIMIT @row_limit;

-- Used by transactionsStagedForCategorization to report background categorization progress.
-- name: CountStagedForLLM :one
SELECT COUNT(*)
FROM transactions
WHERE staged_for_llm = 1;

-- Used by reprocessUncategorizedTransactions to stage the review queue for the background LLM categorizer.
-- name: StageUncategorizedForLLM :execrows
UPDATE transactions
SET staged_for_llm = 1
WHERE is_reviewed = 0
  AND staged_for_llm = 0;

-- Used by internal/transactions' background LLM categorizer to fetch already-reviewed examples per merchant as few-shot prompt context.
-- name: TopMerchantExamples :many
SELECT
  CAST(MIN(t.merchant_name) AS TEXT) AS merchant_name,
  c.name AS category_name,
  c.id AS category_id
FROM transactions t
JOIN categories c ON t.category_id = c.id
JOIN category_groups cg ON cg.id = c.group_id
WHERE t.merchant_name IS NOT NULL
  AND t.is_reviewed = 1
  AND cg.kind = 'EXPENSE'
  AND t.datetime < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')
GROUP BY LOWER(t.merchant_name), c.id
ORDER BY COUNT(*) DESC
LIMIT @row_limit;

-- SimilarCategorizedByMerchants lives in transactions/db/llm.go because sqlc
-- cannot analyze SQLite filters on window-function aliases.

-- Used by internal/transactions' background LLM categorizer to apply an accepted categorization result.
-- name: ApplyLLMCategory :exec
UPDATE transactions
SET category_id = @category_id,
    is_reviewed = 1,
    staged_for_llm = 0,
    pfc2_categorized = 0,
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE id = @id
  AND (category_id = @uncategorized_category_id OR pfc2_categorized = 1);

-- Used by internal/transactions' sync loop and LLM worker to clear all or selected staged-for-LLM flags.
-- name: ClearStagedForLLM :exec
UPDATE transactions
SET staged_for_llm = 0
WHERE TRUE
  AND id IN (sqlc.slice('ids')) -- :if @ids
  AND staged_for_llm = 1;
