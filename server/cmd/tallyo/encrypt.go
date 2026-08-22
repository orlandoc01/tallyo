package main

import (
	"context"

	"tallyo/internal/database"
)

// encryptCommand encrypts the configured SQLite database in place and returns.
// Backing the original up to <path>.bak. Invoked by the --encrypt-db flag.
func encryptCommand(ctx context.Context, options database.OpenOptions) error {
	if err := database.EncryptExistingDB(ctx, options); err != nil {
		return err
	}
	options.Logger.Info("database encrypted", "path", options.Path, "backup", options.Path+".bak")
	return nil
}
