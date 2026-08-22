-- Used by internal/database's retention sweep (background job and manual CLI trigger) to touch every retention_sweeps row.
-- name: TriggerRetentionSweep :exec
-- Intentionally touches every sweep row; each trigger self-selects on NEW.id.
UPDATE retention_sweeps
SET trigger_sweep = 1;
