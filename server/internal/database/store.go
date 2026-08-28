package database

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"tallyo/internal/database/dbgen"

	_ "github.com/ncruces/go-sqlite3/vfs/adiantum"
)

const EncryptionKeyHexLen = 64

type DB struct {
	db *sql.DB
	BaseStore
}

type BaseStore struct {
	db *sql.DB
}

type OpenOptions struct {
	Path          string
	EncryptionKey string
	WarnFullScans bool
	Logger        *slog.Logger
}

func OpenDB(ctx context.Context, options OpenOptions) (*DB, error) {
	if err := ValidateEncryptionKey(options.EncryptionKey); err != nil {
		return nil, err
	}
	if options.Path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(options.Path), 0o700); err != nil {
			return nil, fmt.Errorf("create db directory: %w", err)
		}
	}
	// Embed pragmas in the DSN so go-sqlite3 applies them on every
	// new connection. This guarantees foreign_keys=ON even if database/sql
	// silently discards a broken connection and opens a replacement.
	db, err := openSQLite(openDSN(options.Path, options.EncryptionKey), options)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// SQLite only supports one writer at a time; multiple connections
	// just fight over the single write lock and cause SQLITE_BUSY.
	// Limit the pool to one connection so all DB access is serialized
	// at the Go level, eliminating contention entirely.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)
	s := &DB{db: db, BaseStore: BaseStore{db: db}}
	if err := s.initSchema(ctx); err != nil {
		if closeErr := db.Close(); closeErr != nil {
			return nil, errors.Join(fmt.Errorf("init schema: %w", err), fmt.Errorf("close sqlite: %w", closeErr))
		}
		return nil, err
	}
	if options.Path != ":memory:" {
		if err := restrictDBFilePerms(options.Path); err != nil {
			if closeErr := db.Close(); closeErr != nil {
				return nil, errors.Join(fmt.Errorf("restrict db file perms: %w", err), fmt.Errorf("close sqlite: %w", closeErr))
			}
			return nil, fmt.Errorf("restrict db file perms: %w", err)
		}
	}
	return s, nil
}

func restrictDBFilePerms(path string) error {
	for _, p := range []string{path, path + "-wal", path + "-shm"} {
		if err := os.Chmod(p, 0o600); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func (s *DB) SQL() *sql.DB { return s.db }

func NewBaseStore(db *DB) BaseStore {
	return BaseStore{db: db.SQL()}
}

func (s BaseStore) WithTx(ctx context.Context, fn func(*sql.Tx, *dbgen.Queries) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := fn(tx, dbgen.New(tx)); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *DB) Close() error {
	return s.db.Close()
}

func (s *DB) Backup(ctx context.Context, dst string) error {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("acquire connection: %w", err)
	}
	defer func() { _ = conn.Close() }()
	tmpDir, err := os.MkdirTemp(filepath.Dir(dst), ".tallyo-backup-")
	if err != nil {
		return fmt.Errorf("create private backup directory: %w", err)
	}
	defer func() { _ = os.RemoveAll(tmpDir) }()
	tmp := filepath.Join(tmpDir, filepath.Base(dst))
	if _, err := conn.ExecContext(ctx, "VACUUM INTO ?", sqliteURI(tmp)+"?vfs=os"); err != nil {
		return fmt.Errorf("vacuum into: %w", err)
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		return fmt.Errorf("restrict backup file perms: %w", err)
	}
	if err := os.Link(tmp, dst); err != nil {
		return fmt.Errorf("install backup: %w", err)
	}
	return nil
}

func BackupPlainDataPath(dbPath, dst string) (string, error) {
	if dbPath == ":memory:" {
		return "", fmt.Errorf("cannot back up in-memory database")
	}
	if dst != "" {
		info, err := os.Stat(dst)
		if err != nil && !os.IsNotExist(err) {
			return "", fmt.Errorf("stat backup path: %w", err)
		}
		if err == nil && info.IsDir() {
			return filepath.Join(dst, BackupPlainDataName(dbPath)), nil
		}
		return dst, nil
	}
	return filepath.Join(filepath.Dir(dbPath), BackupPlainDataName(dbPath)), nil
}

func BackupPlainDataName(dbPath string) string {
	ext := filepath.Ext(dbPath)
	return strings.TrimSuffix(filepath.Base(dbPath), ext) + ".plain" + ext
}

func ValidateEncryptionKey(key string) error {
	if key == "" {
		return nil
	}
	if len(key) != EncryptionKeyHexLen {
		return fmt.Errorf("DB Encryption Key must be exactly %d hex characters", EncryptionKeyHexLen)
	}
	if _, err := hex.DecodeString(key); err != nil {
		return fmt.Errorf("DB Encryption Key must be valid hex: %w", err)
	}
	return nil
}

func EncryptExistingDB(ctx context.Context, options OpenOptions) error {
	if options.Path == ":memory:" {
		return fmt.Errorf("cannot encrypt in-memory database")
	}
	if err := ValidateEncryptionKey(options.EncryptionKey); err != nil {
		return err
	}
	if options.EncryptionKey == "" {
		return fmt.Errorf("DB Encryption Key is required with --encrypt-db")
	}

	encPath := options.Path + ".enc"
	bakPath := options.Path + ".bak"
	if _, err := os.Stat(bakPath); err == nil {
		return fmt.Errorf("backup path already exists: %s", bakPath)
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("stat backup path: %w", err)
	}
	if err := os.Remove(encPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove stale encrypted database: %w", err)
	}

	db, err := openSQLite(openDSN(options.Path, ""), options)
	if err != nil {
		return fmt.Errorf("open plaintext sqlite: %w", err)
	}
	_, err = db.ExecContext(ctx, "VACUUM INTO ?", encryptedVacuumURI(encPath, options.EncryptionKey))
	closeErr := db.Close()
	if err != nil {
		return fmt.Errorf("encrypt database: %w", err)
	}
	if closeErr != nil {
		return fmt.Errorf("close plaintext sqlite: %w", closeErr)
	}
	if err := os.Chmod(encPath, 0o600); err != nil {
		return fmt.Errorf("restrict encrypted db file perms: %w", err)
	}
	if err := os.Chmod(options.Path, 0o600); err != nil {
		return fmt.Errorf("restrict plaintext backup perms: %w", err)
	}
	if err := os.Rename(options.Path, bakPath); err != nil {
		return fmt.Errorf("rename original database: %w", err)
	}
	if err := os.Rename(encPath, options.Path); err != nil {
		installErr := fmt.Errorf("install encrypted database: %w", err)
		if rollbackErr := os.Rename(bakPath, options.Path); rollbackErr != nil {
			return errors.Join(installErr, fmt.Errorf("restore plaintext database: %w", rollbackErr))
		}
		return installErr
	}
	return nil
}

func openDSN(path, encryptionKey string) string {
	params := []string{}
	if encryptionKey != "" {
		params = append(
			params,
			"vfs=adiantum",
			"_pragma="+url.QueryEscape("hexkey('"+encryptionKey+"')"),
		)
	}
	params = append(
		params,
		"_timefmt="+url.QueryEscape("2006-01-02T15:04:05Z07:00"),
		"_pragma="+url.QueryEscape("foreign_keys(on)"),
		"_pragma="+url.QueryEscape("journal_mode(wal)"),
		"_pragma="+url.QueryEscape("synchronous(normal)"),
		"_pragma="+url.QueryEscape("busy_timeout(30000)"),
	)
	if encryptionKey != "" {
		params = append(params, "_pragma="+url.QueryEscape("temp_store(memory)"))
	}
	return sqliteURI(path) + "?" + strings.Join(params, "&")
}

func encryptedVacuumURI(path, encryptionKey string) string {
	return sqliteURI(path) + "?vfs=adiantum&hexkey=" + url.QueryEscape(encryptionKey)
}

func sqliteURI(path string) string {
	if path == ":memory:" {
		return "file::memory:"
	}
	return (&url.URL{Scheme: "file", Path: path}).String()
}
