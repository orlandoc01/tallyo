use std::fmt;

use anyhow::Result;

mod adopt;
mod backup;
mod connection;
pub mod dbtest;
mod encrypt;
mod periodic;
#[allow(dead_code)]
pub mod queries;
#[cfg(test)]
mod schema_snapshot;
mod seed;
mod timestamp;
mod transaction;

pub use backup::backup_plain_data;
#[cfg(test)]
use connection::MIGRATOR;
pub use connection::{open, open_database};
pub use encrypt::encrypt_existing;
pub use periodic::{
    RETENTION_SWEEP_INTERVAL, SQLITE_OPTIMIZE_INTERVAL, optimize, run_periodic, run_retention_sweep,
    run_sqlite_optimize,
};
pub use seed::seed_reference_categories;
pub use timestamp::Timestamp;
pub use transaction::with_tx;

#[cfg(test)]
mod queries_gate;
#[cfg(test)]
mod queries_tests;

const INVALID_KEY_LENGTH: &str = "database encryption key must be exactly 64 hexadecimal characters";
const INVALID_KEY_CHARACTERS: &str = "database encryption key must contain only hexadecimal characters";

/// A SQLCipher key, validated at the configuration boundary.
pub struct DatabaseKey(String);

impl fmt::Debug for DatabaseKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DatabaseKey(REDACTED)")
    }
}

impl TryFrom<String> for DatabaseKey {
    type Error = anyhow::Error;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        anyhow::ensure!(value.len() == 64, INVALID_KEY_LENGTH);
        anyhow::ensure!(value.bytes().all(|b| b.is_ascii_hexdigit()), INVALID_KEY_CHARACTERS);
        Ok(Self(value))
    }
}

#[cfg(test)]
mod tests {
    use super::{DatabaseKey, INVALID_KEY_CHARACTERS, INVALID_KEY_LENGTH};

    const KEY: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    #[test]
    fn database_key_validates_input() {
        assert!(DatabaseKey::try_from(KEY.to_owned()).is_ok());
        assert_eq!(
            DatabaseKey::try_from(String::new()).unwrap_err().to_string(),
            INVALID_KEY_LENGTH
        );
        assert_eq!(
            DatabaseKey::try_from("g".repeat(64)).unwrap_err().to_string(),
            INVALID_KEY_CHARACTERS
        );
        assert_eq!(
            DatabaseKey::try_from("a".repeat(63)).unwrap_err().to_string(),
            INVALID_KEY_LENGTH
        );
    }
}
