ALTER TABLE login_sessions ADD COLUMN browser_binding TEXT;
ALTER TABLE oauth_refresh_tokens ADD COLUMN first_issued_at DATETIME;
ALTER TABLE oauth_clients ADD COLUMN last_used_at DATETIME;
UPDATE oauth_clients SET last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE is_preseeded = 0;
