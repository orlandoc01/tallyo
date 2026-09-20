use std::{env, fs, path::PathBuf};

use anyhow::{Context, Result};
use figment::{
    Figment,
    providers::{Format, Serialized, Yaml},
};
use serde::{Deserialize, Serialize};

use crate::database::DatabaseKey;

#[derive(Debug)]
pub struct Config {
    pub config_file_path: Option<PathBuf>,
    pub db_path: PathBuf,
    pub db_encryption_key: Option<DatabaseKey>,
    pub port: u16,
    pub sync_off: bool,
    pub authorization: Authorization,
}

#[derive(Debug)]
pub struct Authorization {
    pub disable_all_auth: bool,
    pub master_password: Option<MasterPassword>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MasterPassword(String);

impl TryFrom<String> for MasterPassword {
    type Error = anyhow::Error;

    fn try_from(value: String) -> Result<Self> {
        anyhow::ensure!(!value.is_empty(), "master password must not be empty");
        Ok(Self(value))
    }
}

impl MasterPassword {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Deserialize, Serialize)]
struct RawConfig {
    config_file_path: Option<PathBuf>,
    #[serde(default = "default_db_path")]
    db_path: PathBuf,
    db_encryption_key: Option<String>,
    db_encryption_key_file: Option<String>,
    #[serde(default = "default_port")]
    port: u16,
    #[serde(default)]
    sync_off: bool,
    #[serde(default)]
    authorization: RawAuthorization,
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct RawAuthorization {
    #[serde(default)]
    disable_all_auth: bool,
    master_password: Option<String>,
}

fn default_db_path() -> PathBuf {
    PathBuf::from("/data/tallyo.db")
}

const fn default_port() -> u16 {
    8080
}

pub fn load() -> Result<Config> {
    let explicit_path = nonempty_env("CONFIG_FILE_PATH").map(PathBuf::from);
    let default_path = PathBuf::from("config.yaml");
    let selected_path = explicit_path
        .as_ref()
        .or_else(|| default_path.exists().then_some(&default_path));
    if let Some(path) = explicit_path.as_ref() {
        fs::metadata(path).with_context(|| format!("read config file: {}", path.display()))?;
    }

    let figment = selected_path.map_or_else(
        || Figment::from(Serialized::defaults(defaults())),
        |path| Figment::from(Serialized::defaults(defaults())).merge(Yaml::file(path)),
    );
    let raw = figment.extract::<RawConfig>().context("unmarshal config")?;
    config_from_raw(apply_env(raw)?, selected_path.cloned())
}

fn defaults() -> RawConfig {
    RawConfig {
        config_file_path: None,
        db_path: default_db_path(),
        db_encryption_key: None,
        db_encryption_key_file: None,
        port: default_port(),
        sync_off: false,
        authorization: RawAuthorization::default(),
    }
}

fn apply_env(mut config: RawConfig) -> Result<RawConfig> {
    if let Some(value) = nonempty_env("DB_PATH") {
        config.db_path = PathBuf::from(value);
    }
    if let Some(value) = env::var_os("DB_ENCRYPTION_KEY") {
        config.db_encryption_key = Some(value.to_string_lossy().into_owned());
    }
    if let Some(value) = env::var_os("DB_ENCRYPTION_KEY_FILE") {
        config.db_encryption_key_file = Some(value.to_string_lossy().into_owned());
    }
    if let Some(value) = nonempty_env("PORT") {
        config.port = value.parse().context("parse PORT")?;
    }
    if let Some(value) = nonempty_env("SYNC_OFF") {
        config.sync_off = parse_bool(&value).context("parse SYNC_OFF")?;
    }
    if let Some(value) = nonempty_env("DISABLE_ALL_AUTH") {
        config.authorization.disable_all_auth = parse_bool(&value).context("parse DISABLE_ALL_AUTH")?;
    }
    if let Some(value) = env::var_os("MASTER_PASSWORD") {
        config.authorization.master_password = Some(value.to_string_lossy().into_owned());
    }
    Ok(config)
}

fn config_from_raw(mut raw: RawConfig, used_file: Option<PathBuf>) -> Result<Config> {
    let key_file = raw.db_encryption_key_file.take().filter(|path| !path.trim().is_empty());
    let key = match key_file {
        Some(path) => fs::read_to_string(&path)
            .with_context(|| format!("read db encryption key file: {path}"))?
            .trim()
            .to_owned(),
        None => raw.db_encryption_key.take().unwrap_or_default().trim().to_owned(),
    };
    Ok(Config {
        config_file_path: raw.config_file_path.or(used_file),
        db_path: raw.db_path,
        db_encryption_key: (!key.is_empty()).then(|| DatabaseKey::try_from(key)).transpose()?,
        port: raw.port,
        sync_off: raw.sync_off,
        authorization: Authorization {
            disable_all_auth: raw.authorization.disable_all_auth,
            master_password: raw
                .authorization
                .master_password
                .filter(|password| !password.is_empty())
                .map(MasterPassword::try_from)
                .transpose()?,
        },
    })
}

fn nonempty_env(name: &str) -> Option<String> {
    env::var_os(name)
        .map(|value| value.to_string_lossy().trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn parse_bool(value: &str) -> Option<bool> {
    match value {
        "true" | "1" => Some(true),
        "false" | "0" => Some(false),
        _ => None,
    }
}

#[cfg(test)]
#[allow(clippy::result_large_err)]
mod tests {
    use std::path::Path;

    use figment::Jail;

    use super::load;

    #[test]
    fn loads_defaults() {
        Jail::expect_with(|_jail| {
            let config = load().unwrap();
            assert_eq!(config.db_path, Path::new("/data/tallyo.db"));
            assert_eq!(config.port, 8080);
            assert!(config.config_file_path.is_none());
            Ok(())
        });
    }

    #[test]
    fn loads_yaml_and_environment_overrides() {
        Jail::expect_with(|jail| {
            jail.create_file(
                "settings.yml",
                "authorization:\n  master_password: file-password\ndb_path: /tmp/spend.db\nport: 1111\n",
            )?;
            jail.set_env("CONFIG_FILE_PATH", jail.directory().join("settings.yml").display());
            jail.set_env("PORT", "2222");
            let config = load().unwrap();
            assert_eq!(config.config_file_path, Some(jail.directory().join("settings.yml")));
            assert_eq!(config.db_path, Path::new("/tmp/spend.db"));
            assert_eq!(config.port, 2222);
            assert_eq!(config.authorization.master_password.unwrap().as_str(), "file-password");
            Ok(())
        });
    }

    #[test]
    fn rejects_missing_explicit_config_file() {
        Jail::expect_with(|jail| {
            jail.set_env("CONFIG_FILE_PATH", jail.directory().join("missing.yml").display());
            assert!(load().is_err());
            Ok(())
        });
    }

    #[test]
    fn parses_authentication_and_trimmed_encryption_key() {
        Jail::expect_with(|jail| {
            jail.set_env("MASTER_PASSWORD", "my-master-password");
            jail.set_env("DISABLE_ALL_AUTH", "true");
            jail.set_env("DB_ENCRYPTION_KEY", format!("  {}  ", "a".repeat(64)));
            let config = load().unwrap();
            assert!(config.authorization.disable_all_auth);
            assert_eq!(
                config.authorization.master_password.unwrap().as_str(),
                "my-master-password"
            );
            assert!(config.db_encryption_key.is_some());
            Ok(())
        });
    }

    #[test]
    fn treats_an_empty_master_password_as_absent() {
        Jail::expect_with(|jail| {
            jail.set_env("MASTER_PASSWORD", "");
            assert!(load().unwrap().authorization.master_password.is_none());
            Ok(())
        });
    }

    #[test]
    fn rejects_invalid_environment_values() {
        Jail::expect_with(|jail| {
            jail.set_env("PORT", "not-a-port");
            assert!(load().is_err());
            jail.set_env("PORT", "8080");
            jail.set_env("SYNC_OFF", "not-a-bool");
            assert!(load().is_err());
            Ok(())
        });
    }

    #[test]
    fn key_file_overrides_inline_key() {
        Jail::expect_with(|jail| {
            let key = format!("{}\n", "a".repeat(64));
            jail.create_file("db-key", &key)?;
            jail.set_env("DB_ENCRYPTION_KEY", "b".repeat(64));
            jail.set_env("DB_ENCRYPTION_KEY_FILE", jail.directory().join("db-key").display());
            assert!(load().unwrap().db_encryption_key.is_some());
            Ok(())
        });
    }
}
