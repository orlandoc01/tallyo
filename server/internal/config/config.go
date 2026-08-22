package config

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	ConfigFilePath  string        `mapstructure:"config_file_path"`
	DBPath          string        `mapstructure:"db_path"`
	DBEncryptionKey string        `mapstructure:"db_encryption_key"`
	DBWarnFullScans bool          `mapstructure:"db_warn_full_scans"`
	Port            string        `mapstructure:"port"`
	SyncOff         bool          `mapstructure:"sync_off"`
	Authorization   Authorization `mapstructure:"authorization"`
}

type Authorization struct {
	DisableAllAuth bool   `mapstructure:"disable_all_auth"`
	MasterPassword string `mapstructure:"master_password"`
}

func Load() (Config, error) {
	v := viper.NewWithOptions(viper.ExperimentalBindStruct())
	v.AutomaticEnv()
	explicitConfigFile := configureFile(v)
	v.SetDefault("db_path", "/data/tallyo.db")
	v.SetDefault("port", "8080")
	if err := bindLegacyEnv(v); err != nil {
		return Config{}, err
	}

	if err := v.ReadInConfig(); err != nil {
		if _, ok := errors.AsType[viper.ConfigFileNotFoundError](err); explicitConfigFile || !ok {
			return Config{}, fmt.Errorf("read config file: %w", err)
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return cfg, fmt.Errorf("unmarshal config: %w", err)
	}
	if cfg.ConfigFilePath == "" {
		cfg.ConfigFilePath = v.ConfigFileUsed()
	}
	keyFile := strings.TrimSpace(v.GetString("db_encryption_key_file"))
	if keyFile != "" {
		key, err := os.ReadFile(keyFile)
		if err != nil {
			return cfg, fmt.Errorf("read db encryption key file: %w", err)
		}
		cfg.DBEncryptionKey = strings.TrimSpace(string(key))
	} else {
		cfg.DBEncryptionKey = strings.TrimSpace(cfg.DBEncryptionKey)
	}

	return cfg, nil
}

func bindLegacyEnv(v *viper.Viper) error {
	bindings := map[string]string{
		"config_file_path":               "CONFIG_FILE_PATH",
		"db_path":                        "DB_PATH",
		"db_encryption_key":              "DB_ENCRYPTION_KEY",
		"db_encryption_key_file":         "DB_ENCRYPTION_KEY_FILE",
		"db_warn_full_scans":             "DB_WARN_FULL_SCANS",
		"port":                           "PORT",
		"sync_off":                       "SYNC_OFF",
		"authorization.disable_all_auth": "DISABLE_ALL_AUTH",
		"authorization.master_password":  "MASTER_PASSWORD",
	}
	for key, env := range bindings {
		if err := v.BindEnv(key, env); err != nil {
			return fmt.Errorf("bind env %s: %w", env, err)
		}
	}
	return nil
}

func configureFile(v *viper.Viper) bool {
	if path := strings.TrimSpace(os.Getenv("CONFIG_FILE_PATH")); path != "" {
		v.SetConfigFile(path)
		return true
	}
	v.SetConfigName("config")
	v.SetConfigType("yaml")
	v.AddConfigPath(".")
	return false
}
