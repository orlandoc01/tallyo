package database

import (
	"context"
	"embed"
	"fmt"
	"io/fs"

	"github.com/pressly/goose/v3"
)

//go:embed migrations/[0-9]*.sql
var embeddedMigrations embed.FS

func (s *DB) runMigrations(ctx context.Context) error {
	migrations, err := fs.Sub(embeddedMigrations, "migrations")
	if err != nil {
		return fmt.Errorf("open embedded migrations: %w", err)
	}
	if err := s.ensureGooseVersionTable(ctx); err != nil {
		return fmt.Errorf("prepare goose version table: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectSQLite3, s.db, migrations)
	if err != nil {
		return fmt.Errorf("create goose provider: %w", err)
	}
	if _, err := provider.Up(ctx); err != nil {
		return fmt.Errorf("goose up: %w", err)
	}
	return nil
}

func (s *DB) ensureGooseVersionTable(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS goose_db_version (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		version_id INTEGER NOT NULL,
		is_applied INTEGER NOT NULL,
		tstamp TIMESTAMP DEFAULT (datetime('now'))
	)`); err != nil {
		return fmt.Errorf("create goose version table: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM goose_db_version WHERE version_id = 0`); err != nil {
		return fmt.Errorf("reset goose zero version: %w", err)
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO goose_db_version (version_id, is_applied, tstamp)
VALUES (0, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`)
	return err
}
