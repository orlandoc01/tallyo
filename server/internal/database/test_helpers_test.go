package database

import (
	"context"
	"testing"

	"tallyo/internal/utils/must"
	"tallyo/internal/utils/nooplog"
)

func testDB(t *testing.T) *DB {
	t.Helper()
	db := mustOpenDB(t, context.Background(), ":memory:", "")
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func mustOpenDB(t *testing.T, ctx context.Context, path, encryptionKey string) *DB {
	t.Helper()
	db, err := OpenDB(ctx, OpenOptions{Path: path, EncryptionKey: encryptionKey, Logger: nooplog.Logger})
	must.NoErr(t, err)
	return db
}
