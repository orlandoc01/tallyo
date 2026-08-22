package database

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/nooplog"
)

const testEncryptionKey = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"

func TestDBSQLAndBackup(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	if store.SQL() == nil {
		t.Fatal("SQL() returned nil")
	}

	dst := filepath.Join(t.TempDir(), "backup.sqlite")
	must.NoErr(t, store.Backup(ctx, dst))
	info, err := os.Stat(dst)
	must.NoErr(t, err)
	if info.Size() == 0 {
		t.Fatal("backup file is empty")
	}
}

func TestOpenDBRejectsInvalidEncryptionKey(t *testing.T) {
	if _, err := OpenDB(context.Background(), OpenOptions{
		Path:          ":memory:",
		EncryptionKey: "not-hex",
		Logger:        nooplog.Logger,
	}); err == nil {
		t.Fatal("expected invalid encryption key error")
	}
}

func TestDBCloseClosesSQLPool(t *testing.T) {
	store := mustOpenDB(t, context.Background(), ":memory:", "")
	must.NoErr(t, store.Close())
	if err := store.SQL().PingContext(context.Background()); err == nil {
		t.Fatal("PingContext after Close() succeeded")
	}
}

func TestEncryptedDBAndPlaintextBackup(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "encrypted.db")
	store := mustOpenDB(t, ctx, path, testEncryptionKey)

	header := readHeader(t, path)
	if strings.HasPrefix(header, "SQLite format 3") {
		t.Fatal("encrypted database has plaintext SQLite header")
	}

	dst := filepath.Join(t.TempDir(), "backup.db")
	must.NoErr(t, store.Backup(ctx, dst))
	must.NoErr(t, store.Close())
	must.NoErr(t, os.Chmod(path, 0o644))
	if header := readHeader(t, dst); !strings.HasPrefix(header, "SQLite format 3") {
		t.Fatalf("backup header = %q", header)
	}
	if _, err := OpenDB(ctx, OpenOptions{
		Path:          path,
		EncryptionKey: strings.Repeat("0b", 32),
		Logger:        nooplog.Logger,
	}); err == nil {
		t.Fatal("expected wrong encryption key to fail")
	}
}

func TestEncryptExistingDB(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "tallyo.db")
	store := mustOpenDB(t, ctx, path, "")
	must.NoErr(t, store.Close())

	must.NoErr(t, EncryptExistingDB(ctx, OpenOptions{
		Path:          path,
		EncryptionKey: testEncryptionKey,
		Logger:        nooplog.Logger,
	}))
	if header := readHeader(t, path); strings.HasPrefix(header, "SQLite format 3") {
		t.Fatal("encrypted database has plaintext SQLite header")
	}
	if header := readHeader(t, path+".bak"); !strings.HasPrefix(header, "SQLite format 3") {
		t.Fatalf("backup header = %q", header)
	}
	assertFileMode(t, path+".bak", 0o600)
	encrypted := mustOpenDB(t, ctx, path, testEncryptionKey)
	must.NoErr(t, encrypted.Close())
}

func TestOpenDBCreatesDataDirectoryAndFilesWithRestrictivePerms(t *testing.T) {
	ctx := context.Background()
	// A nested, not-yet-existing directory forces OpenDB's own MkdirAll to
	// create it, so this observes the mode OpenDB actually applies rather
	// than t.TempDir()'s (already 0700) mode.
	path := filepath.Join(t.TempDir(), "nested", "tallyo.db")
	store := mustOpenDB(t, ctx, path, "")
	defer func() {
		must.NoErr(t, store.Close())
	}()

	assertFileMode(t, filepath.Dir(path), 0o700)
	assertFileMode(t, path, 0o600)
	assertFileMode(t, path+"-wal", 0o600)
	assertFileMode(t, path+"-shm", 0o600)
}

func TestBackupRestrictsFilePerms(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	dst := filepath.Join(t.TempDir(), "backup.sqlite")
	must.NoErr(t, store.Backup(ctx, dst))
	assertFileMode(t, dst, 0o600)
}

func assertFileMode(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	must.NoErr(t, err)
	if perm := info.Mode().Perm(); perm != want {
		t.Fatalf("%s mode = %o, want %o", path, perm, want)
	}
}

func TestOpenDSNSerializesSQLCTimesAsRFC3339Seconds(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	expiresAt := time.Date(2026, 7, 6, 19, 55, 5, 0, time.UTC)

	must.NoErr(t, dbgen.New(store.SQL()).CreateLoginSession(ctx, dbgen.CreateLoginSessionParams{
		ID:                  "session_time_format",
		ClientID:            "tallyo-web",
		RedirectUri:         "http://localhost/callback",
		CodeChallenge:       "challenge",
		CodeChallengeMethod: "S256",
		CallbackState:       "callback_state_time_format",
		ExpiresAt:           expiresAt,
	}))

	var rawExpiresAt, rawCreatedAt string
	must.NoErr(t, store.SQL().QueryRowContext(
		ctx,
		`SELECT CAST(expires_at AS TEXT), CAST(created_at AS TEXT) FROM login_sessions WHERE id = ?`,
		"session_time_format",
	).Scan(&rawExpiresAt, &rawCreatedAt))

	if rawExpiresAt != expiresAt.Format(time.RFC3339) {
		t.Fatalf("expires_at = %q, want %q", rawExpiresAt, expiresAt.Format(time.RFC3339))
	}
	rfc3339Seconds := regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`)
	if !rfc3339Seconds.MatchString(rawExpiresAt) {
		t.Fatalf("expires_at = %q, want RFC3339 seconds", rawExpiresAt)
	}
	if !rfc3339Seconds.MatchString(rawCreatedAt) {
		t.Fatalf("created_at = %q, want RFC3339 seconds", rawCreatedAt)
	}
}

func readHeader(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	must.NoErr(t, err)
	if len(data) < 16 {
		t.Fatalf("file too short: %d", len(data))
	}
	return string(data[:16])
}
