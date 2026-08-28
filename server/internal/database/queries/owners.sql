-- Used by GraphQL query owners and owner lookups in account/wealth linking flows.
-- name: Owners :many
SELECT o.*
FROM owners o
WHERE TRUE
  AND o.id = @id -- :if @id
ORDER BY o.name;

-- Used by GraphQL mutation createOwner via accounts/db.Store.CreateOwner.
-- name: CreateOwner :one
INSERT INTO owners (name)
VALUES (@name)
RETURNING *;

-- Used by GraphQL mutation deleteOwner via accounts/db.Store.DeleteOwner.
-- name: DeleteOwner :execrows
DELETE FROM owners
WHERE id = @id;
