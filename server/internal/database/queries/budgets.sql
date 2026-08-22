-- Used by GraphQL mutation setBudget via budgets/db.Store.
-- name: UpsertBudget :one
INSERT INTO budgets (month, category_id, amount_cents)
VALUES (@month, @category_id, @amount_cents)
ON CONFLICT(category_id, month) DO UPDATE SET
  amount_cents = excluded.amount_cents,
  updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
RETURNING id;

-- Used by GraphQL mutation deleteBudget via budgets/db.Store.
-- name: DeleteBudget :execrows
DELETE FROM budgets
WHERE id = @id;

-- Used by the GraphQL node resolver and internally after setBudget to return the budget with its category details.
-- name: BudgetByID :one
SELECT
  b.id,
  b.month,
  b.amount_cents,
  sqlc.embed(cr)
FROM budgets b
JOIN category_rows cr ON cr.cat_id = b.category_id
WHERE b.id = @id;

-- Used by GraphQL mutation copyBudgets via budgets/db.Store to duplicate a month's budgets onto another month.
-- name: CopyBudgets :execrows
INSERT INTO budgets (month, category_id, amount_cents)
SELECT @to_month, b.category_id, b.amount_cents
FROM budgets b
WHERE b.month = @from_month
ON CONFLICT(category_id, month) DO NOTHING;

-- Used by budgetReport and budgetReportHistory to load budgeted lines across
-- a half-open month range; callers group by month and category in Go.
-- name: BudgetsInRange :many
SELECT id, month, category_id, amount_cents
FROM budgets
WHERE TRUE
  AND month >= @start_month -- :if @start_month
  AND month < @end_month -- :if @end_month
LIMIT -1;
