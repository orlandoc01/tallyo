-- Used by wealth/db.Store.CreateRealEstate (GraphQL mutation linkRealEstate) to create the REAL_ESTATE asset row.
-- name: InsertRealEstateAsset :one
INSERT INTO assets (asset_type, identifier, name, classifier, additional)
VALUES ('REAL_ESTATE', @identifier, @name, 'REAL_ESTATE', @additional)
RETURNING id;

-- Used by wealth/db.Store.RealEstateByConnectionID (lookup, edit, delete) and
-- ActiveRealEstate (periodic manual-snapshot sync, which additionally excludes
-- closed accounts: the shared snapshot sink rejects closed-account writes, so
-- syncing one would only discard the result).
-- name: ActiveRealEstate :many
SELECT
  a.id AS asset_id,
  acc.id AS account_id,
  c.id AS connection_id,
  c.owner_id,
  COALESCE(c.name, acc.name) AS name,
  a.additional
FROM connections c
JOIN assets a ON a.asset_type = 'REAL_ESTATE' AND a.id = c.source_id
JOIN accounts acc ON acc.connection_id = c.id
WHERE TRUE
  AND acc.is_closed = 0 -- :if @open_only
  AND c.id = @connection_id -- :if @connection_id
  AND c.source_table = 'assets'
  AND c.is_active = 1
  AND acc.manual = 0
  AND acc.type = 'PROPERTY'
ORDER BY acc.created_at;
