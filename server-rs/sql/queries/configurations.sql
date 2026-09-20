-- Used by GraphQL query configuration via admin/db.Store, and by startup config resolution to load all runtime settings sections.
-- name: ListConfigurationSections :many
SELECT section, enabled, fields
FROM configurations
ORDER BY section;

-- Used by GraphQL mutation updateConfiguration via admin/db.Store to persist a runtime configuration section.
-- name: UpsertConfigurationSection :exec
INSERT INTO configurations (section, enabled, fields, updated_at)
VALUES (@section, @enabled, @fields, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
ON CONFLICT(section) DO UPDATE SET
    enabled = excluded.enabled,
    fields = excluded.fields,
    updated_at = excluded.updated_at;
