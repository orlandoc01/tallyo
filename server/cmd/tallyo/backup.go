package main

import (
	"context"

	"tallyo/internal/database"
)

func backupPlainDataCommand(ctx context.Context, dst string, options database.OpenOptions) error {
	dst, err := database.BackupPlainDataPath(options.Path, dst)
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
