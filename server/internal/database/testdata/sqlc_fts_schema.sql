-- sqlc's SQLite analyzer resolves table-level FTS MATCH operands as columns.
-- These declarations are analyzer-only; SQLite evaluates the real virtual-table
-- expressions in queries/*.sql against the unchanged runtime schema.
ALTER TABLE assets_fts ADD COLUMN assets_fts TEXT;
ALTER TABLE transactions_fts ADD COLUMN transactions_fts TEXT;
