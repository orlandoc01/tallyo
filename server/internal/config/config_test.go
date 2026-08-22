package config

import (
	"os"
	"path/filepath"
	"tallyo/internal/utils/must"
	"testing"
)

func TestLoadParsesEnvironment(t *testing.T) {
	t.Setenv("MASTER_PASSWORD", "key")

	cfg, err := Load()
	must.NoErr(t, err)
	if cfg.DBPath == "" || cfg.Port == "" {
		t.Fatalf("expected default config values, got %#v", cfg)
	}
}

func TestLoadParsesConfigFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.yml")
	contents := []byte(`
authorization:
  master_password: file-password
db_path: /tmp/spend.db
db_warn_full_scans: true
`)
	must.NoErr(t, os.WriteFile(path, contents, 0o600))
	t.Setenv("CONFIG_FILE_PATH", path)

	cfg, err := Load()
	must.NoErr(t, err)
	if cfg.ConfigFilePath != path || cfg.DBPath != "/tmp/spend.db" || !cfg.DBWarnFullScans || cfg.Authorization.MasterPassword != "file-password" {
		t.Fatalf("file config not loaded: %#v", cfg)
	}
}

func TestLoadEnvironmentOverridesConfigFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.yml")
	contents := []byte(`
port: "1111"
`)
	must.NoErr(t, os.WriteFile(path, contents, 0o600))
	t.Setenv("CONFIG_FILE_PATH", path)
	t.Setenv("PORT", "2222")

	cfg, err := Load()
	must.NoErr(t, err)
	if cfg.Port != "2222" {
		t.Fatalf("Port = %q", cfg.Port)
	}
}

func TestLoadRejectsMissingExplicitConfigFile(t *testing.T) {
	t.Setenv("CONFIG_FILE_PATH", filepath.Join(t.TempDir(), "missing.yml"))

	if _, err := Load(); err == nil {
		t.Fatalf("expected missing explicit config file error")
	}
}

func TestLoadSucceedsWithNoEnvVars(t *testing.T) {
	cfg, err := Load()
	must.NoErr(t, err)
	if cfg.DBPath != "/data/tallyo.db" {
		t.Fatalf("DBPath = %q", cfg.DBPath)
	}
	if cfg.Port != "8080" {
		t.Fatalf("Port = %q", cfg.Port)
	}
	if cfg.DBWarnFullScans {
		t.Fatal("DBWarnFullScans = true")
	}
}

func TestLoadParsesMasterPassword(t *testing.T) {
	t.Setenv("MASTER_PASSWORD", "my-master-password")

	cfg, err := Load()
	must.NoErr(t, err)
	if cfg.Authorization.MasterPassword != "my-master-password" {
		t.Fatalf("MasterPassword = %q", cfg.Authorization.MasterPassword)
	}
}

func TestLoadParsesDisableAllAuth(t *testing.T) {
	t.Setenv("DISABLE_ALL_AUTH", "true")

	cfg, err := Load()
	must.NoErr(t, err)
	if !cfg.Authorization.DisableAllAuth {
		t.Fatal("DisableAllAuth = false")
	}
}

func TestLoadParsesDBEncryptionKey(t *testing.T) {
	t.Setenv("DB_ENCRYPTION_KEY", "  key-from-env  ")

	cfg, err := Load()
	must.NoErr(t, err)
	if cfg.DBEncryptionKey != "key-from-env" {
		t.Fatalf("DBEncryptionKey = %q", cfg.DBEncryptionKey)
	}
}

func TestLoadParsesDBWarnFullScans(t *testing.T) {
	t.Setenv("DB_WARN_FULL_SCANS", "true")

	cfg, err := Load()
	must.NoErr(t, err)
	if !cfg.DBWarnFullScans {
		t.Fatal("DBWarnFullScans = false")
	}
}

func TestLoadDBEncryptionKeyFileTakesPrecedence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db-key")
	must.NoErr(t, os.WriteFile(path, []byte("key-from-file\n"), 0o600))
	t.Setenv("DB_ENCRYPTION_KEY", "key-from-env")
	t.Setenv("DB_ENCRYPTION_KEY_FILE", path)

	cfg, err := Load()
	must.NoErr(t, err)
	if cfg.DBEncryptionKey != "key-from-file" {
		t.Fatalf("DBEncryptionKey = %q", cfg.DBEncryptionKey)
	}
}
