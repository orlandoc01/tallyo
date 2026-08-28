-- Used by category list, lookup, spending report, and category-group display paths with optional filters and ordering.
-- name: ListCategories :many
SELECT cr.*
FROM category_rows cr
WHERE TRUE
  AND cr.group_kind = 'EXPENSE' -- :if @expense_only
  AND cr.cat_id IN (sqlc.slice('category_ids')) -- :if @category_ids
  AND cr.group_id = @group_id -- :if @group_id
ORDER BY
  cr.group_sort_order, -- :if @group_order
  cr.sort_order;

-- Used by the GraphQL node resolver to resolve a CategoryGroup, and internally after createCategoryGroup/updateCategoryGroup.
-- name: CategoryGroupByID :one
SELECT id, name, emoji, kind
FROM category_groups
WHERE id = @id;

-- Used by GraphQL mutation createCategoryGroup and startup category seeding.
-- name: CreateCategoryGroup :one
INSERT INTO category_groups (name, emoji, kind, sort_order)
VALUES (@name, @emoji, @kind, COALESCE(NULLIF(CAST(@sort_order AS INTEGER), 0), (SELECT MAX(sort_order) + 1 FROM category_groups), 1))
RETURNING id;

-- Used by internal/database's startup category seeding to create built-in categories with fixed sort order.
-- name: CreateSeedCategory :one
INSERT INTO categories (name, emoji, group_id, sort_order)
VALUES (@name, @emoji, @group_id, @sort_order)
RETURNING id;

-- Used by GraphQL mutation updateCategoryGroup via transactions/db.Store.
-- name: UpdateCategoryGroup :execrows
UPDATE category_groups
SET name = @name,
    emoji = @emoji
WHERE id = @id;

-- Used by GraphQL mutation deleteCategoryGroup via transactions/db.Store to check the group is empty before deleting it.
-- name: CountCategoriesByGroup :one
SELECT COUNT(*)
FROM categories
WHERE group_id = @group_id;

-- Used by GraphQL mutation deleteCategoryGroup via transactions/db.Store.
-- name: DeleteCategoryGroup :execrows
DELETE FROM category_groups
WHERE id = @id;

-- Used by createTransaction and deleteCategory to validate a category and count its references.
-- name: CategoryInfo :one
SELECT c.id, CAST(COUNT(t.id) AS INTEGER) AS transaction_count
FROM categories c
LEFT JOIN transactions t ON t.category_id = c.id
WHERE c.id = @id
GROUP BY c.id;

-- Used by GraphQL mutation deleteCategory via transactions/db.Store.
-- name: DeleteCategory :exec
DELETE FROM categories
WHERE id = @id;

-- Used by GraphQL mutation reorderCategories via transactions/db.Store, guarded by group_id to block cross-group moves.
-- name: UpdateCategorySortOrder :exec
UPDATE categories
SET sort_order = @sort_order
WHERE id = @id
  AND group_id = @group_id;

-- Used by internal/database's startup category seeding to check whether user categories already exist.
-- name: CountNonSentinelCategories :one
SELECT COUNT(*)
FROM categories
WHERE id != 0;

-- Used by internal/database's startup category seeding to check whether the uncategorized sentinel category/group already exist.
-- name: CountSentinelCategories :one
SELECT COUNT(*)
FROM categories c
JOIN category_groups cg ON cg.id = c.group_id
WHERE c.id = 0
  AND cg.id = 0;

-- Used by internal/database's startup category seeding to upsert the uncategorized sentinel category group.
-- name: UpsertSentinelCategoryGroup :exec
INSERT INTO category_groups (id, name, emoji, kind, sort_order)
VALUES (@id, @name, @emoji, @kind, @sort_order)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  emoji = excluded.emoji,
  kind = excluded.kind,
  sort_order = excluded.sort_order;

-- Used by internal/database's startup category seeding to upsert the uncategorized sentinel category.
-- name: UpsertSentinelCategory :exec
INSERT INTO categories (id, name, emoji, sort_order, group_id)
VALUES (@id, @name, @emoji, @sort_order, @group_id)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  emoji = excluded.emoji,
  sort_order = excluded.sort_order,
  group_id = excluded.group_id;

-- Used by GraphQL mutation createCategory via transactions/db.Store.
-- name: CreateCategory :one
INSERT INTO categories (name, emoji, group_id, sort_order)
VALUES (@name, @emoji, @group_id, COALESCE((SELECT MAX(sort_order) + 1 FROM categories WHERE group_id = @group_id), 1))
RETURNING id;

-- Used by GraphQL mutation updateCategory via transactions/db.Store.
-- name: UpdateCategoryFields :execrows
UPDATE categories
SET name = @name,
    emoji = @emoji,
    group_id = @group_id
WHERE id = @id;

-- Used by GraphQL mutation createCategory/updateCategory via transactions/db.Store to check for a conflicting Plaid category mapping before saving.
-- name: PFC2MappedCategoryName :one
SELECT c.name
FROM plaid_category_mappings pcm
JOIN categories c ON c.id = pcm.category_id
WHERE pcm.plaid_detailed = @plaid_detailed
  AND pcm.category_id != @category_id;

-- Used by GraphQL mutation updateCategory via transactions/db.Store to clear a category's existing Plaid mappings before re-inserting the updated set.
-- name: DeleteCategoryPlaidMappings :exec
DELETE FROM plaid_category_mappings
WHERE category_id = @category_id;

-- Used by category mutations and startup seeding to upsert a Plaid detailed-category mapping by category ID.
-- name: UpsertCategoryPlaidMapping :exec
INSERT INTO plaid_category_mappings (plaid_detailed, category_id)
VALUES (@plaid_detailed, @category_id)
ON CONFLICT(plaid_detailed) DO UPDATE SET category_id = excluded.category_id;

-- Used by internal/database's startup Plaid mapping seeding to upsert a Plaid detailed-category mapping by category name.
-- name: UpsertCategoryPlaidMappingByCategoryName :exec
INSERT INTO plaid_category_mappings (plaid_detailed, category_id)
SELECT @plaid_detailed, id
FROM categories
WHERE name = @category_name
ON CONFLICT(plaid_detailed) DO UPDATE SET category_id = excluded.category_id;
