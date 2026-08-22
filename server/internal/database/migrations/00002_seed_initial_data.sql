-- +goose Up

INSERT OR IGNORE INTO assets (id, asset_type, identifier, name, classifier, last_price, last_price_at)
VALUES (1, 'CURRENCY', 'USD', 'US Dollar', 'CASH', 1.0, strftime('%Y-%m-%dT%H:%M:%SZ','now'));

INSERT INTO balance_sync_schedules (id, balance_sync_cron)
VALUES
    ('realestate', '30 16 * * *'),
    ('manual', '30 16 * * *'),
    ('plaid', '30 16 * * 1-5'),
    ('simplefin', '30 16 * * 1-5'),
    ('debank', '30 16 * * *')
ON CONFLICT (id) DO NOTHING;

INSERT OR IGNORE INTO retention_sweeps (id)
VALUES
    ('plaid_sync_log_retention'),
    ('simplefin_sync_log_retention'),
    ('snapshot_raw_payload_retention');
