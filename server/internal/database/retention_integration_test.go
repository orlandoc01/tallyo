package database

import (
	"context"
	"tallyo/internal/utils/must"
	"testing"
)

func TestTriggerRetentionSweep(t *testing.T) {
	ctx := context.Background()
	db := testDB(t)

	statements := []string{
		`INSERT INTO plaid_credentials (id, client_id, secret) VALUES (1, 'client', 'secret')`,
		`INSERT INTO plaid_items (id, credential_id, access_token, external_id) VALUES (1, 1, 'access', 'item')`,
		`INSERT INTO plaid_sync_log (item_id, synced_at) VALUES
(1, '2000-01-01T00:00:00Z'),
(1, '2999-01-01T00:00:00Z')`,
		`INSERT INTO owners (id, name) VALUES (1, 'owner')`,
		`INSERT INTO simplefin_access_tokens (id, owner_id, access_url) VALUES
(1, 1, 'https://example.com/setup')`,
		`INSERT INTO simplefin_sync_log (access_token_id, synced_at) VALUES
(1, '2000-01-01T00:00:00Z'),
(1, '2999-01-01T00:00:00Z')`,
		`INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES
(1, 'account', 1, 'Account', 'depository')`,
		`INSERT INTO account_balance_daily_snapshots (account_id, source, date, synced_at, raw_payload) VALUES
(1, 'plaid', '2000-01-01', '2000-01-01T00:00:00Z', '{"old":true}'),
(1, 'plaid', '2999-01-01', '2999-01-01T00:00:00Z', '{"new":true}')`,
	}
	for _, statement := range statements {
		if _, err := db.SQL().ExecContext(ctx, statement); err != nil {
			t.Fatalf("seed %q: %v", statement, err)
		}
	}

	must.NoErr(t, TriggerRetentionSweep(ctx, db))

	for _, test := range []struct {
		query string
		want  int
	}{
		{query: `SELECT COUNT(*) FROM plaid_sync_log`, want: 1},
		{query: `SELECT COUNT(*) FROM simplefin_sync_log`, want: 1},
		{query: `SELECT COUNT(*) FROM account_balance_daily_snapshots WHERE raw_payload IS NOT NULL`, want: 1},
		{query: `SELECT COUNT(*) FROM retention_sweeps WHERE trigger_sweep = 0 AND last_sweep_at IS NOT NULL`, want: 3},
	} {
		assertCount(t, ctx, db, test.query, test.want)
	}
}

func assertCount(t *testing.T, ctx context.Context, db *DB, query string, want int) {
	t.Helper()

	var got int
	must.NoErr(t, db.SQL().QueryRowContext(ctx, query).Scan(&got))
	if got != want {
		t.Fatalf("count %q = %d, want %d", query, got, want)
	}
}
