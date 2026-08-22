package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	_ "time/tzdata"

	"tallyo/internal/config"
	"tallyo/internal/database"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("server failed", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	encryptDB := flag.Bool("encrypt-db", false, "encrypt the configured SQLite database and exit")
	var backupEnabled bool
	var backupPath string
	// Bare --backup-plain-data enables the default path, =PATH sets an
	// explicit one, and =false disables it instead of creating a file
	// literally named "false".
	flag.BoolFunc("backup-plain-data", "write a plaintext backup and exit; optionally pass =PATH", func(value string) error {
		if value == "false" {
			backupEnabled = false
			backupPath = ""
			return nil
		}
		backupEnabled = true
		if value != "true" {
			backupPath = value
		}
		return nil
	})
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	dbOptions := database.OpenOptions{
		Path:          cfg.DBPath,
		EncryptionKey: cfg.DBEncryptionKey,
		WarnFullScans: cfg.DBWarnFullScans,
		Logger:        logger,
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if *encryptDB {
		return encryptCommand(ctx, dbOptions)
	}
	if backupEnabled {
		return backupPlainDataCommand(ctx, backupPath, dbOptions)
	}
	return runServer(ctx, logger, cfg, dbOptions)
}
