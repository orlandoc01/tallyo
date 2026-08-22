package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"tallyo/internal/database"
)

func backupPlainDataCommand(ctx context.Context, dst string, options database.OpenOptions) error {
	dst, err := backupPlainDataPath(options.Path, dst)
	if err != nil {
		return err
	}
	db, err := database.OpenDB(ctx, options)
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()
	if err := db.Backup(ctx, dst); err != nil {
		return err
	}
	options.Logger.Info("plaintext database backup created", "src", options.Path, "dst", dst)
	return nil
}

func backupPlainDataPath(dbPath, dst string) (string, error) {
	if dbPath == ":memory:" {
		return "", fmt.Errorf("cannot back up in-memory database")
	}
	if dst != "" {
		info, err := os.Stat(dst)
		if err != nil && !os.IsNotExist(err) {
			return "", fmt.Errorf("stat backup path: %w", err)
		}
		if err == nil && info.IsDir() {
			return filepath.Join(dst, backupPlainDataName(dbPath)), nil
		}
		return dst, nil
	}
	return filepath.Join(filepath.Dir(dbPath), backupPlainDataName(dbPath)), nil
}

func backupPlainDataName(dbPath string) string {
	ext := filepath.Ext(dbPath)
	return strings.TrimSuffix(filepath.Base(dbPath), ext) + ".plain" + ext
}
