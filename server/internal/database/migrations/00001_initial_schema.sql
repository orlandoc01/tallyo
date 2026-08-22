-- +goose Up
-- +goose StatementBegin
-- Schema snapshot for tallyo
-- Auto-generated; do not edit directly.
-- Regenerate with: UPDATE_SCHEMA_SNAPSHOT=1 go test ./internal/database/ -run TestSchemaSnapshot

CREATE TABLE account_balance_daily_snapshots (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    balance_usd_cents INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    date TEXT NOT NULL,
    flag_reason TEXT,
    flagged BOOLEAN NOT NULL DEFAULT 0,
    id INTEGER PRIMARY KEY,
    raw_payload TEXT,
    source TEXT NOT NULL,
    synced_at DATETIME NOT NULL
);

CREATE UNIQUE INDEX idx_account_balance_snapshots_account_date
    ON account_balance_daily_snapshots(account_id, date);

CREATE INDEX idx_account_balance_snapshots_synced_at
ON account_balance_daily_snapshots(synced_at);

CREATE TABLE account_balance_snapshot_provider_states (
    provider_balance_usd_cents INTEGER NOT NULL,
    provider_holdings_json TEXT NOT NULL,
    snapshot_id INTEGER PRIMARY KEY REFERENCES account_balance_daily_snapshots(id) ON DELETE CASCADE
);

CREATE TABLE account_balance_snapshot_reviews (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    carry_forward_balance_usd_cents INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    decision TEXT NOT NULL DEFAULT 'IN_REVIEW',
    first_flagged_date TEXT NOT NULL,
    flag_reason TEXT,
    flagged_snapshot_count INTEGER NOT NULL DEFAULT 1,
    id INTEGER PRIMARY KEY,
    latest_flagged_date TEXT NOT NULL,
    provider_balance_usd_cents INTEGER NOT NULL,
    provider_holdings_json TEXT,
    updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    CHECK(decision IN ('IN_REVIEW', 'APPROVED_CHANGES'))
);

CREATE UNIQUE INDEX idx_account_balance_snapshot_reviews_account
    ON account_balance_snapshot_reviews(account_id);

CREATE TABLE account_sync_state (
    account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    last_balance_synced_at DATETIME
);

CREATE TABLE accounts (
    connection_id INTEGER REFERENCES connections(id),
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    external_id TEXT NOT NULL UNIQUE,
    id INTEGER PRIMARY KEY,
    is_closed BOOLEAN NOT NULL DEFAULT 0,
    is_hidden BOOLEAN NOT NULL DEFAULT 0,
    manual BOOLEAN NOT NULL DEFAULT 0,
    mask TEXT,
    name TEXT NOT NULL,
    needs_review BOOLEAN NOT NULL DEFAULT 0,
    notes TEXT,
    owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
    review_reason TEXT,
    subtype TEXT,
    type TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_accounts_connection
ON accounts(connection_id);

CREATE INDEX idx_accounts_owner
ON accounts(owner_id);

CREATE TABLE asset_adapter_sources (
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    id INTEGER PRIMARY KEY,
    source_adapter TEXT NOT NULL,
    source_id TEXT NOT NULL,
    UNIQUE(source_adapter, source_id)
);

CREATE INDEX idx_asset_adapter_sources_asset
    ON asset_adapter_sources(asset_id);

CREATE TABLE asset_analysis_reports (
    asset_id INTEGER PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    bond_position REAL NOT NULL DEFAULT 0,
    cash_position REAL NOT NULL DEFAULT 0,
    category TEXT NOT NULL,
    convertible_position REAL NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    equity_sector TEXT,
    fetched_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    group_name TEXT NOT NULL,
    other_position REAL NOT NULL DEFAULT 0,
    preferred_position REAL NOT NULL DEFAULT 0,
    sector_basic_materials REAL NOT NULL DEFAULT 0,
    sector_communication_services REAL NOT NULL DEFAULT 0,
    sector_consumer_cyclical REAL NOT NULL DEFAULT 0,
    sector_consumer_defensive REAL NOT NULL DEFAULT 0,
    sector_energy REAL NOT NULL DEFAULT 0,
    sector_financial_services REAL NOT NULL DEFAULT 0,
    sector_healthcare REAL NOT NULL DEFAULT 0,
    sector_industrials REAL NOT NULL DEFAULT 0,
    sector_real_estate REAL NOT NULL DEFAULT 0,
    sector_technology REAL NOT NULL DEFAULT 0,
    sector_utilities REAL NOT NULL DEFAULT 0,
    stock_position REAL NOT NULL DEFAULT 0
);

CREATE TABLE asset_daily_holdings (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    counts_toward_value BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    date TEXT NOT NULL,
    id INTEGER PRIMARY KEY,
    manual BOOLEAN NOT NULL DEFAULT 0,
    price REAL,
    quantity REAL,
    snapshot_id INTEGER NOT NULL REFERENCES account_balance_daily_snapshots(id) ON DELETE CASCADE,
    value_usd_cents INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_asset_daily_holdings_account_date_asset ON asset_daily_holdings(account_id, date, asset_id);

CREATE INDEX idx_asset_daily_holdings_asset ON asset_daily_holdings(asset_id);

CREATE UNIQUE INDEX idx_asset_daily_holdings_snapshot_asset ON asset_daily_holdings(snapshot_id, asset_id);

CREATE TABLE assets (
    additional TEXT,
    asset_type TEXT NOT NULL,
    classifier TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    forced_usd_price REAL,
    id INTEGER PRIMARY KEY,
    identifier TEXT NOT NULL,
    investment_connectivity TEXT NOT NULL DEFAULT 'HEALTHY',
    last_price REAL,
    last_price_at DATETIME,
    name TEXT,
    price_connectivity TEXT NOT NULL DEFAULT 'HEALTHY',
    tracking_multiplier REAL NOT NULL DEFAULT 1,
    tracking_ticker TEXT,
    updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    user_created BOOLEAN NOT NULL DEFAULT 0,
    user_edited BOOLEAN NOT NULL DEFAULT 0,
    CHECK(asset_type IN ('CURRENCY','SECURITY','CRYPTO','REAL_ESTATE','OTHER')),
    UNIQUE(asset_type, identifier)
);

CREATE INDEX idx_assets_classifier ON assets(classifier);

CREATE VIRTUAL TABLE assets_fts USING fts5(
  identifier,
  name,
  content='assets',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TABLE balance_sync_schedules (
    balance_sync_cron TEXT NOT NULL,
    id TEXT PRIMARY KEY,
    next_balance_sync_at DATETIME
);

CREATE TABLE budgets (
    amount_cents INTEGER NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    id INTEGER PRIMARY KEY,
    month TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE UNIQUE INDEX idx_budgets_category_month
ON budgets(category_id, month);

CREATE INDEX idx_budgets_month
ON budgets(month);

CREATE TABLE categories (
    emoji TEXT NOT NULL,
    group_id INTEGER NOT NULL REFERENCES category_groups(id),
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL
);

CREATE INDEX idx_categories_group ON categories(group_id);

CREATE TABLE category_groups (
    emoji TEXT NOT NULL,
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    CHECK(kind IN ('EXPENSE','INCOME','TRANSFER'))
);

CREATE TABLE configurations (
    enabled BOOLEAN NOT NULL DEFAULT 0,
    fields TEXT NOT NULL DEFAULT '{}',
    section TEXT PRIMARY KEY,
    updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE connections (
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    id INTEGER PRIMARY KEY,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    name TEXT,
    owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
    source_id INTEGER NOT NULL,
    source_table TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_connections_owner
ON connections(owner_id);

CREATE UNIQUE INDEX idx_connections_source ON connections(source_table, source_id);

CREATE TABLE evm_wallets (
    address TEXT NOT NULL,
    chain_ids TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    id INTEGER PRIMARY KEY,
    label TEXT NOT NULL DEFAULT '',
    next_balance_sync_at DATETIME,
    updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE UNIQUE INDEX idx_evm_wallets_address ON evm_wallets(address);

CREATE TABLE login_sessions (
    authenticated BOOLEAN NOT NULL DEFAULT 0,
    callback_state TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    code_challenge_method TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    email TEXT,
    email_magic_token TEXT,
    email_otp TEXT,
    email_otp_attempts INTEGER NOT NULL DEFAULT 0,
    email_otp_expires_at DATETIME,
    expires_at DATETIME NOT NULL,
    id TEXT PRIMARY KEY,
    pkce_verifier TEXT,
    purpose TEXT,
    redirect_uri TEXT NOT NULL,
    scopes TEXT,
    state TEXT,
    subject TEXT,
    webauthn_session TEXT
);

CREATE INDEX idx_login_sessions_expires ON login_sessions(expires_at);

CREATE TABLE oauth_access_tokens (
    client_id TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    expires_at DATETIME NOT NULL,
    request_id TEXT,
    scopes TEXT,
    signature TEXT PRIMARY KEY,
    subject TEXT NOT NULL
);

CREATE INDEX idx_oauth_access_expires ON oauth_access_tokens(expires_at);

CREATE INDEX idx_oauth_access_request
ON oauth_access_tokens(request_id);

CREATE INDEX idx_oauth_access_subject
ON oauth_access_tokens(subject);

CREATE TABLE oauth_authorization_codes (
    active BOOLEAN NOT NULL DEFAULT 1,
    client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
    code_challenge TEXT NOT NULL,
    code_challenge_method TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    expires_at DATETIME NOT NULL,
    redirect_uri TEXT NOT NULL,
    scopes TEXT,
    signature TEXT PRIMARY KEY,
    subject TEXT NOT NULL
);

CREATE INDEX idx_oauth_authorization_codes_client
ON oauth_authorization_codes(client_id);

CREATE INDEX idx_oauth_codes_expires ON oauth_authorization_codes(expires_at);

CREATE TABLE oauth_clients (
    application_type TEXT NOT NULL DEFAULT 'native',
    client_name TEXT,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    grant_types TEXT NOT NULL,
    id TEXT PRIMARY KEY,
    is_preseeded BOOLEAN NOT NULL DEFAULT 0,
    is_public BOOLEAN NOT NULL DEFAULT 1,
    redirect_uris TEXT NOT NULL,
    response_types TEXT NOT NULL,
    scopes TEXT NOT NULL
);

CREATE TABLE oauth_refresh_tokens (
    active BOOLEAN NOT NULL DEFAULT 1,
    client_id TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    expires_at DATETIME NOT NULL,
    request_id TEXT,
    scopes TEXT,
    signature TEXT PRIMARY KEY,
    subject TEXT NOT NULL
);

CREATE INDEX idx_oauth_refresh_expires ON oauth_refresh_tokens(expires_at);

CREATE INDEX idx_oauth_refresh_request
ON oauth_refresh_tokens(request_id);

CREATE INDEX idx_oauth_refresh_subject
ON oauth_refresh_tokens(subject);

CREATE TABLE owners (
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE plaid_category_mappings (
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    plaid_detailed TEXT PRIMARY KEY
);

CREATE INDEX idx_plaid_category_mappings_category ON plaid_category_mappings(category_id);

CREATE TABLE plaid_credentials (
    client_id TEXT NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    environment TEXT NOT NULL DEFAULT 'development',
    id INTEGER PRIMARY KEY,
    label TEXT,
    secret TEXT NOT NULL
);

CREATE TABLE plaid_items (
    access_token TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    credential_id INTEGER NOT NULL REFERENCES plaid_credentials(id) ON DELETE RESTRICT,
    cursor TEXT,
    external_id TEXT NOT NULL UNIQUE,
    health_error_code TEXT,
    health_error_message TEXT,
    health_state TEXT NOT NULL DEFAULT 'HEALTHY',
    health_updated_at DATETIME,
    id INTEGER PRIMARY KEY,
    institution_id TEXT,
    last_recurring_synced_at DATETIME,
    last_synced_at DATETIME,
    logo_url TEXT,
    next_balance_sync_at DATETIME,
    next_recurring_sync_at DATETIME,
    next_sync_at DATETIME,
    plaid_investments_enabled BOOLEAN NOT NULL DEFAULT 0,
    plaid_liabilities_enabled BOOLEAN NOT NULL DEFAULT 0,
    recurring_sync_cron TEXT NOT NULL DEFAULT '0 12 * * 0',
    sync_cron TEXT NOT NULL DEFAULT '0 6,18 * * *',
    updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_plaid_items_credential ON plaid_items(credential_id);

CREATE TABLE plaid_sync_log (
    added TEXT NOT NULL DEFAULT '[]',
    api TEXT NOT NULL DEFAULT 'transactions',
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES plaid_items(id) ON DELETE CASCADE,
    modified TEXT NOT NULL DEFAULT '[]',
    removed TEXT NOT NULL DEFAULT '[]',
    synced_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_plaid_sync_log_item ON plaid_sync_log(item_id, synced_at DESC);

CREATE TABLE recurring_charge_transactions (
    charge_id INTEGER NOT NULL REFERENCES recurring_charges(id) ON DELETE CASCADE,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    PRIMARY KEY (charge_id, transaction_id)
);

CREATE INDEX idx_recurring_charge_transactions_transaction
ON recurring_charge_transactions(transaction_id);

CREATE TABLE recurring_charges (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    average_amount_cents INTEGER NOT NULL,
    description TEXT NOT NULL,
    external_id TEXT NOT NULL UNIQUE,
    first_date TEXT NOT NULL,
    frequency TEXT NOT NULL,
    id INTEGER PRIMARY KEY,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    is_user_modified BOOLEAN NOT NULL DEFAULT 0,
    last_amount_cents INTEGER NOT NULL,
    last_date TEXT NOT NULL,
    merchant_name TEXT,
    status TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_recurring_charges_account
ON recurring_charges(account_id);

CREATE TABLE retention_sweeps (
    id TEXT PRIMARY KEY,
    last_sweep_at DATETIME,
    trigger_sweep BOOLEAN NOT NULL DEFAULT 0
);

CREATE TABLE rule_accounts (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
    PRIMARY KEY (rule_id, account_id)
);

CREATE INDEX idx_rule_accounts_account
ON rule_accounts(account_id);

CREATE TABLE rule_tags (
    rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (rule_id, tag_id)
);

CREATE INDEX idx_rule_tags_tag ON rule_tags(tag_id);

CREATE TABLE rules (
    amount_max_cents INTEGER,
    amount_min_cents INTEGER,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    id INTEGER PRIMARY KEY,
    merchant_name TEXT,
    merchant_pattern TEXT NOT NULL,
    original_pattern TEXT NOT NULL DEFAULT '',
    priority INTEGER NOT NULL DEFAULT 0,
    should_be_recurring BOOLEAN,
    should_hide BOOLEAN
);

CREATE INDEX idx_rules_category ON rules(category_id);

CREATE INDEX idx_rules_priority ON rules(priority DESC);

CREATE TABLE signing_keys (
    algorithm TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    id TEXT PRIMARY KEY,
    private_key_pem TEXT NOT NULL,
    public_key_pem TEXT NOT NULL
);

CREATE TABLE simplefin_access_tokens (
    access_url TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    id INTEGER PRIMARY KEY,
    label TEXT,
    last_synced_at DATETIME,
    next_balance_sync_at DATETIME,
    next_sync_at DATETIME,
    owner_id INTEGER NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
    sync_cron TEXT NOT NULL DEFAULT '0 6,18 * * *',
    updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE simplefin_connections (
    access_token_id INTEGER NOT NULL REFERENCES simplefin_access_tokens(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    external_id TEXT NOT NULL UNIQUE,
    health_error_message TEXT,
    health_state TEXT NOT NULL DEFAULT 'HEALTHY',
    health_updated_at DATETIME,
    id INTEGER PRIMARY KEY,
    last_synced_at DATETIME,
    logo_url TEXT,
    org_domain TEXT,
    org_id TEXT,
    org_url TEXT,
    sfin_url TEXT,
    updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_simplefin_connections_access_token
ON simplefin_connections(access_token_id);

CREATE TABLE simplefin_sync_log (
    access_token_id INTEGER NOT NULL REFERENCES simplefin_access_tokens(id) ON DELETE CASCADE,
    added TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    id INTEGER PRIMARY KEY,
    modified TEXT NOT NULL DEFAULT '[]',
    pending_removed TEXT NOT NULL DEFAULT '[]',
    start_date TEXT,
    synced_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_simplefin_sync_log_token
    ON simplefin_sync_log(access_token_id, synced_at DESC);

CREATE TABLE tags (
    color TEXT NOT NULL DEFAULT '#3B82F6',
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    transaction_count INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE transaction_tags (
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    PRIMARY KEY (transaction_id, tag_id)
);

CREATE INDEX idx_transaction_tags_tag ON transaction_tags(tag_id);

CREATE TABLE transactions (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    datetime DATETIME NOT NULL,
    external_id TEXT NOT NULL,
    id INTEGER PRIMARY KEY,
    is_hidden BOOLEAN NOT NULL DEFAULT 0,
    is_recurring BOOLEAN NOT NULL DEFAULT 0,
    is_reviewed BOOLEAN NOT NULL DEFAULT 0,
    logo_url TEXT,
    merchant_name TEXT,
    notes TEXT,
    original_name TEXT,
    pending BOOLEAN NOT NULL DEFAULT 0,
    pfc2_categorized BOOLEAN NOT NULL DEFAULT 0,
    plaid_category TEXT,
    posted_datetime DATETIME NOT NULL,
    raw_provider_json TEXT,
    source TEXT NOT NULL DEFAULT 'plaid',
    staged_for_llm BOOLEAN NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_transactions_account ON transactions(account_id);

CREATE INDEX idx_transactions_amount_id
ON transactions(amount_cents DESC, id DESC);

CREATE INDEX idx_transactions_category ON transactions(category_id);

CREATE INDEX idx_transactions_datetime_id ON transactions(datetime DESC, id DESC);

CREATE INDEX idx_transactions_reviewed_merchant_category_datetime
ON transactions(LOWER(merchant_name), category_id, datetime DESC)
WHERE merchant_name IS NOT NULL AND is_reviewed = 1;

CREATE UNIQUE INDEX idx_transactions_source_external ON transactions(source, external_id);

CREATE INDEX idx_transactions_staged_for_llm
ON transactions(staged_for_llm);

CREATE INDEX idx_transactions_staged_for_llm_datetime
ON transactions(datetime DESC) WHERE staged_for_llm = 1;

CREATE VIRTUAL TABLE transactions_fts USING fts5(
  merchant_name, original_name, notes,
  content='transactions', content_rowid='id',
  tokenize='unicode61'
);

CREATE TABLE users (
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    email TEXT NOT NULL UNIQUE,
    id INTEGER PRIMARY KEY,
    invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    role TEXT NOT NULL DEFAULT 'writer'
);

CREATE INDEX idx_users_invited_by
ON users(invited_by);

CREATE TABLE webauthn_credentials (
    created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    credential TEXT NOT NULL,
    id TEXT PRIMARY KEY,
    last_used_at DATETIME,
    name TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_webauthn_credentials_user ON webauthn_credentials(user_id);

CREATE TABLE webauthn_registrations (
    expires_at DATETIME NOT NULL,
    name TEXT NOT NULL,
    session TEXT NOT NULL,
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);

CREATE VIEW category_rows AS
SELECT
  c.id AS cat_id,
  c.name AS cat_name,
  c.emoji AS cat_emoji,
  cg.name AS group_name,
  cg.emoji AS group_emoji,
  cg.kind AS group_kind,
  c.sort_order,
  cg.id AS group_id,
  cg.sort_order AS group_sort_order,
  CAST(COALESCE((
    SELECT GROUP_CONCAT(pcm.plaid_detailed)
    FROM plaid_category_mappings pcm
    WHERE pcm.category_id = c.id
  ), '') AS TEXT) AS plaid_pfc2_codes
FROM categories c
JOIN category_groups cg ON cg.id = c.group_id;

CREATE TRIGGER assets_fts_ad AFTER DELETE ON assets BEGIN
  INSERT INTO assets_fts(assets_fts, rowid, identifier, name)
  VALUES('delete', old.id, old.identifier, old.name);
END;

CREATE TRIGGER assets_fts_ai AFTER INSERT ON assets BEGIN
  INSERT INTO assets_fts(rowid, identifier, name)
  VALUES (new.id, new.identifier, new.name);
END;

CREATE TRIGGER assets_fts_au AFTER UPDATE OF identifier, name ON assets BEGIN
  INSERT INTO assets_fts(assets_fts, rowid, identifier, name)
  VALUES('delete', old.id, old.identifier, old.name);
  INSERT INTO assets_fts(rowid, identifier, name)
  VALUES (new.id, new.identifier, new.name);
END;

CREATE TRIGGER plaid_sync_log_retention_sweep
AFTER UPDATE OF trigger_sweep ON retention_sweeps
FOR EACH ROW WHEN NEW.id = 'plaid_sync_log_retention' AND NEW.trigger_sweep = 1
BEGIN
  DELETE FROM plaid_sync_log
  WHERE synced_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-90 days');
  UPDATE retention_sweeps
  SET trigger_sweep = 0,
      last_sweep_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER simplefin_sync_log_retention_sweep
AFTER UPDATE OF trigger_sweep ON retention_sweeps
FOR EACH ROW WHEN NEW.id = 'simplefin_sync_log_retention' AND NEW.trigger_sweep = 1
BEGIN
  DELETE FROM simplefin_sync_log
  WHERE synced_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-90 days');
  UPDATE retention_sweeps
  SET trigger_sweep = 0,
      last_sweep_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER snapshot_raw_payload_retention_sweep
AFTER UPDATE OF trigger_sweep ON retention_sweeps
FOR EACH ROW WHEN NEW.id = 'snapshot_raw_payload_retention' AND NEW.trigger_sweep = 1
BEGIN
  UPDATE account_balance_daily_snapshots
  SET raw_payload = NULL
  WHERE raw_payload IS NOT NULL
    AND date < strftime('%Y-%m-%d', 'now', '-90 days');
  UPDATE retention_sweeps
  SET trigger_sweep = 0,
      last_sweep_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER transaction_tags_count_delete
AFTER DELETE ON transaction_tags
BEGIN
    UPDATE tags SET transaction_count = transaction_count - 1 WHERE id = OLD.tag_id;
END;

CREATE TRIGGER transaction_tags_count_insert
AFTER INSERT ON transaction_tags
BEGIN
    UPDATE tags SET transaction_count = transaction_count + 1 WHERE id = NEW.tag_id;
END;

CREATE TRIGGER transactions_fts_ad AFTER DELETE ON transactions BEGIN
  INSERT INTO transactions_fts(transactions_fts, rowid, merchant_name, original_name, notes)
  VALUES('delete', old.id, old.merchant_name, old.original_name, old.notes);
END;

CREATE TRIGGER transactions_fts_ai AFTER INSERT ON transactions BEGIN
  INSERT INTO transactions_fts(rowid, merchant_name, original_name, notes)
  VALUES (new.id, new.merchant_name, new.original_name, new.notes);
END;

CREATE TRIGGER transactions_fts_au
AFTER UPDATE OF merchant_name, original_name, notes ON transactions
WHEN old.merchant_name IS NOT new.merchant_name
  OR old.original_name IS NOT new.original_name
  OR old.notes IS NOT new.notes
BEGIN
  INSERT INTO transactions_fts(transactions_fts, rowid, merchant_name, original_name, notes)
  VALUES('delete', old.id, old.merchant_name, old.original_name, old.notes);
  INSERT INTO transactions_fts(rowid, merchant_name, original_name, notes)
  VALUES (new.id, new.merchant_name, new.original_name, new.notes);
END;

-- +goose StatementEnd
