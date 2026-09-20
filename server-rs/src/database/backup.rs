use std::{
    fs,
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};

use super::{DatabaseKey, connection::export_to, open};

const IN_MEMORY: &str = "cannot back up in-memory database";

/// Write a consistent plaintext copy of the database at `source`, decrypting it when `key` is set.
pub async fn backup_plain_data(
    source: impl AsRef<Path>,
    key: Option<DatabaseKey>,
    destination: Option<PathBuf>,
) -> Result<PathBuf> {
    let source = source.as_ref();
    anyhow::ensure!(source != Path::new(":memory:"), IN_MEMORY);
    fs::metadata(source).with_context(|| format!("stat source database: {}", source.display()))?;
    let destination = resolve_destination(source, destination);
    create_private_file(&destination)?;

    if let Err(error) = export(source, key, &destination).await {
        let _ = fs::remove_file(&destination);
        return Err(error);
    }

    tracing::info!(source = %source.display(), destination = %destination.display(), "database backed up");
    Ok(destination)
}

async fn export(source: &Path, key: Option<DatabaseKey>, destination: &Path) -> Result<()> {
    let pool = open(source, key).await.context("open source database")?;
    let exported = export_to(&pool, destination, None).await;
    pool.close().await;
    exported.context("back up database")
}

// SQLite treats the empty file as an empty database, so the plaintext copy is never world-readable.
fn create_private_file(destination: &Path) -> Result<()> {
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(destination)
    {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            anyhow::bail!("backup path already exists: {}", destination.display())
        }
        Err(error) => Err(error).with_context(|| format!("create backup file: {}", destination.display())),
    }
}

fn resolve_destination(source: &Path, destination: Option<PathBuf>) -> PathBuf {
    match destination {
        Some(path) if path.is_dir() => path.join(plain_file_name(source)),
        Some(path) => path,
        None => source.with_file_name(plain_file_name(source)),
    }
}

fn plain_file_name(source: &Path) -> PathBuf {
    let mut name = source.file_stem().unwrap_or_default().to_os_string();
    name.push(".plain");
    if let Some(extension) = source.extension() {
        name.push(".");
        name.push(extension);
    }
    name.into()
}

#[cfg(test)]
mod tests {
    use std::{fs, os::unix::fs::PermissionsExt, path::Path};

    use tempfile::TempDir;

    use super::{IN_MEMORY, backup_plain_data, plain_file_name};
    use crate::database::{
        DatabaseKey, dbtest,
        dbtest::{is_plaintext, key},
        open, open_database,
    };

    async fn seed(path: &Path, key: Option<DatabaseKey>) {
        let pool = open(path, key).await.unwrap();
        sqlx::query("CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('one'), ('two')")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
    }

    async fn note_count(path: &Path) -> i64 {
        let pool = open(path, None).await.unwrap();
        let count = sqlx::query_scalar("SELECT COUNT(*) FROM notes")
            .fetch_one(&pool)
            .await
            .unwrap();
        pool.close().await;
        count
    }

    #[tokio::test]
    async fn copies_a_plaintext_database_beside_the_source() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("tallyo.db");
        seed(&path, None).await;

        let destination = backup_plain_data(&path, None, None).await.unwrap();

        assert_eq!(destination, directory.path().join("tallyo.plain.db"));
        assert!(is_plaintext(&destination));
        assert_eq!(fs::metadata(&destination).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(note_count(&destination).await, 2);
        assert!(!directory.path().join("tallyo.plain.db-wal").exists());
    }

    #[tokio::test]
    async fn decrypts_an_encrypted_source() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("tallyo.db");
        seed(&path, Some(key())).await;
        assert!(!is_plaintext(&path));

        let destination = backup_plain_data(&path, Some(key()), None).await.unwrap();

        assert!(is_plaintext(&destination));
        assert_eq!(note_count(&destination).await, 2);
    }

    #[tokio::test]
    async fn copies_the_migrated_schema_including_fts_tables() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("tallyo.db");
        let pool = dbtest::open_at(&path).await.unwrap();
        sqlx::query("INSERT INTO rules (merchant_pattern) VALUES ('needle')")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let destination = backup_plain_data(&path, None, None).await.unwrap();

        let copy = open_database(&destination, None).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM rules_fts WHERE rules_fts MATCH 'needle'")
                .fetch_one(&copy)
                .await
                .unwrap(),
            1
        );
        copy.close().await;
    }

    #[tokio::test]
    async fn writes_the_generated_name_into_an_explicit_directory() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("tallyo.db");
        seed(&path, None).await;
        let backups = directory.path().join("backups");
        fs::create_dir(&backups).unwrap();

        let destination = backup_plain_data(&path, None, Some(backups.clone())).await.unwrap();

        assert_eq!(destination, backups.join("tallyo.plain.db"));
        assert_eq!(note_count(&destination).await, 2);
    }

    #[tokio::test]
    async fn uses_an_explicit_file_path_as_written() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("tallyo.db");
        seed(&path, None).await;
        let explicit = directory.path().join("snapshot.sqlite");

        let destination = backup_plain_data(&path, None, Some(explicit.clone())).await.unwrap();

        assert_eq!(destination, explicit);
        assert_eq!(note_count(&destination).await, 2);
    }

    #[tokio::test]
    async fn refuses_an_existing_destination() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("tallyo.db");
        seed(&path, None).await;
        let destination = directory.path().join("tallyo.plain.db");
        fs::write(&destination, b"keep me").unwrap();

        let error = backup_plain_data(&path, None, None).await.unwrap_err();

        assert_eq!(
            error.to_string(),
            format!("backup path already exists: {}", destination.display())
        );
        assert_eq!(fs::read(&destination).unwrap(), b"keep me");
    }

    #[tokio::test]
    async fn removes_the_destination_when_the_export_fails() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("tallyo.db");
        seed(&path, Some(key())).await;
        let destination = directory.path().join("tallyo.plain.db");

        assert!(backup_plain_data(&path, None, None).await.is_err());

        assert!(!destination.exists());
    }

    #[tokio::test]
    async fn refuses_a_missing_source() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("missing.db");

        assert!(backup_plain_data(&path, None, None).await.is_err());
        assert!(!path.exists());
        assert!(!directory.path().join("missing.plain.db").exists());
    }

    #[tokio::test]
    async fn refuses_an_in_memory_database() {
        assert_eq!(
            backup_plain_data(":memory:", None, None).await.unwrap_err().to_string(),
            IN_MEMORY
        );
    }

    #[test]
    fn derives_plain_names() {
        assert_eq!(
            plain_file_name(Path::new("/data/tallyo.db")),
            Path::new("tallyo.plain.db")
        );
        assert_eq!(plain_file_name(Path::new("/data/tallyo")), Path::new("tallyo.plain"));
        assert_eq!(
            plain_file_name(Path::new("tallyo.tar.db")),
            Path::new("tallyo.tar.plain.db")
        );
    }
}
