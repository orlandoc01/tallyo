use std::{fs, io::ErrorKind, os::unix::fs::PermissionsExt, path::Path};

use super::{
    DatabaseKey,
    connection::{export_to, sidecar_path},
    open,
};
use anyhow::{Context, Result};

const IN_MEMORY: &str = "cannot encrypt in-memory database";

/// Convert a plaintext SQLite file into a SQLCipher database in place, keeping the original as `<path>.bak`.
pub async fn encrypt_existing(path: impl AsRef<Path>, key: DatabaseKey) -> Result<()> {
    let path = path.as_ref();
    anyhow::ensure!(path != Path::new(":memory:"), IN_MEMORY);
    let encrypted = sidecar_path(path, ".enc");
    let backup = sidecar_path(path, ".bak");
    match fs::metadata(&backup) {
        Ok(_) => anyhow::bail!("backup path already exists: {}", backup.display()),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error).context("stat backup path"),
    }
    if let Err(error) = fs::remove_file(&encrypted)
        && error.kind() != ErrorKind::NotFound
    {
        return Err(error).context("remove stale encrypted database");
    }

    let pool = open(path, None).await.context("open plaintext sqlite")?;
    let exported = export_to(&pool, &encrypted, Some(&key)).await;
    pool.close().await;
    exported.context("encrypt database")?;

    fs::set_permissions(&encrypted, fs::Permissions::from_mode(0o600)).context("restrict encrypted db file perms")?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).context("restrict plaintext backup perms")?;
    fs::rename(path, &backup).context("rename original database")?;
    if let Err(error) = fs::rename(&encrypted, path) {
        let install = anyhow::Error::from(error).context("install encrypted database");
        return Err(match fs::rename(&backup, path) {
            Ok(()) => install,
            Err(rollback) => install.context(format!("restore plaintext database: {rollback}")),
        });
    }
    tracing::info!(path = %path.display(), backup = %backup.display(), "database encrypted");
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{fs, os::unix::fs::PermissionsExt};

    use tempfile::TempDir;

    use super::{IN_MEMORY, encrypt_existing};
    use crate::database::{
        dbtest::{is_plaintext, key},
        open,
    };

    #[tokio::test]
    async fn encrypts_in_place_and_keeps_a_plaintext_backup() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("tallyo.db");
        let pool = open(&path, None).await.unwrap();
        sqlx::query("CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('needle')")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        fs::write(path.with_extension("db.enc"), b"stale").unwrap();

        encrypt_existing(&path, key()).await.unwrap();

        let backup = path.with_extension("db.bak");
        assert!(!is_plaintext(&path));
        assert!(is_plaintext(&backup));
        assert_eq!(fs::metadata(&backup).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert!(!path.with_extension("db.enc").exists());
        assert!(open(&path, None).await.is_err());
        let pool = open(&path, Some(key())).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT body FROM notes")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "needle"
        );
        pool.close().await;
    }

    #[tokio::test]
    async fn refuses_an_in_memory_database() {
        assert_eq!(
            encrypt_existing(":memory:", key()).await.unwrap_err().to_string(),
            IN_MEMORY
        );
    }

    #[tokio::test]
    async fn refuses_to_overwrite_an_existing_backup() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("tallyo.db");
        let backup = path.with_extension("db.bak");
        fs::write(&backup, b"keep me").unwrap();

        let error = encrypt_existing(&path, key()).await.unwrap_err();

        assert_eq!(
            error.to_string(),
            format!("backup path already exists: {}", backup.display())
        );
        assert!(!path.exists());
    }
}
