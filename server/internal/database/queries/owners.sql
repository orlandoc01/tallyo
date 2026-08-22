-- Used by GraphQL query owners and owner lookups in account/wealth linking flows.
-- name: Owners :many
SELECT id, name
FROM owners
WHERE TRUE
  AND id = @id -- :if @id
ORDER BY name;

-- Used by GraphQL mutation createOwner via accounts/db.Store.CreateOwner.
-- name: CreateOwner :one
INSERT INTO owners (name)
VALUES (@name)
RETURNING id, name;

-- Used by GraphQL mutation deleteOwner via accounts/db.Store.DeleteOwner.
-- name: DeleteOwner :execrows
DELETE FROM owners
WHERE id = @id;
