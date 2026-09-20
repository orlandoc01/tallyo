use std::{
    fs,
    os::unix::fs::{DirBuilderExt, PermissionsExt},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use sqlx::{
    Executor, SqlitePool,
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};

use super::{DatabaseKey, adopt::adopt_goose_database, queries, seed_reference_categories};

pub(super) static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

// Keeps warmed variants resident once the hand-written `sqlx::query` sites also fill the LRU.
const HAND_WRITTEN_STATEMENT_MARGIN: usize = 256;

/// Open a SQLite database with Tallyo's connection invariants.
pub async fn open(path: impl AsRef<Path>, key: Option<DatabaseKey>) -> Result<SqlitePool> {
    let path = path.as_ref();
    let is_in_memory = path == Path::new(":memory:");
    if !is_in_memory {
        create_parent_directory(path)?;
    }

    let key = key.map(|key| key.0);
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .statement_cache_capacity(
            queries::DYNFILTER_VARIANT_COUNT + queries::QUERIES.len() + HAND_WRITTEN_STATEMENT_MARGIN,
        );
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .min_connections(1)
        .max_lifetime(None)
        .idle_timeout(None)
        .after_connect(move |connection, _| {
            let key = key.clone();
            Box::pin(async move {
                if let Some(key) = key {
                    connection
                        .execute(format!(r#"PRAGMA key = "x'{key}'""#).as_str())
                        .await?;
                    connection.execute("PRAGMA temp_store = memory").await?;
                }
                connection.execute("PRAGMA journal_mode = WAL").await?;
                connection.execute("PRAGMA foreign_keys = ON").await?;
                connection.execute("PRAGMA busy_timeout = 30000").await?;
                Ok(())
            })
        })
        .connect_with(options)
        .await
        .context("open SQLite database")?;

    if !is_in_memory {
        restrict_file_permissions(path)?;
    }
    Ok(pool)
}

/// Copy every table of the pool's database into a fresh database at `destination`, encrypting it
/// with `key` when one is given. The export runs inside the SELECT's implicit transaction, so every
/// table copies from one snapshot.
pub(super) async fn export_to(pool: &SqlitePool, destination: &Path, key: Option<&DatabaseKey>) -> Result<()> {
    let mut connection = pool.acquire().await?;
    sqlx::query("ATTACH DATABASE ? AS export KEY ?")
        .bind(destination.to_string_lossy().into_owned())
        .bind(key.map_or_else(String::new, |key| format!("x'{}'", key.0)))
        .execute(&mut *connection)
        .await?;
    sqlx::query("SELECT sqlcipher_export('export')")
        .execute(&mut *connection)
        .await?;
    sqlx::query("DETACH DATABASE export").execute(&mut *connection).await?;
    Ok(())
}

/// Run all native SQLx migrations.
async fn migrate(pool: &SqlitePool) -> Result<()> {
    adopt_goose_database(pool, &MIGRATOR).await?;
    MIGRATOR.run(pool).await.context("run database migrations")
}

/// Open, migrate, and seed a SQLite database.
pub async fn open_database(path: impl AsRef<Path>, key: Option<DatabaseKey>) -> Result<SqlitePool> {
    let path = path.as_ref();
    let pool = open(path, key).await?;
    migrate(&pool).await?;
    seed_reference_categories(&pool).await?;
    warm_statement_cache(&pool).await?;
    if path != Path::new(":memory:") {
        restrict_file_permissions(path)?;
    }
    Ok(pool)
}

// ponytail: the pool holds one permanent connection, so warming it once after migrations covers
// the process lifetime; a replacement connection would refill the cache on first use instead.
async fn warm_statement_cache(pool: &SqlitePool) -> Result<()> {
    let mut connection = pool.acquire().await?;
    queries::prepare_dynfilter_variants(&mut connection)
        .await
        .context("prepare dynamic-filter statement variants")
}

fn create_parent_directory(path: &Path) -> Result<()> {
    let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) else {
        return Ok(());
    };
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(parent)
        .with_context(|| format!("create database directory: {}", parent.display()))
}

fn restrict_file_permissions(path: &Path) -> Result<()> {
    [path.to_owned(), sidecar_path(path, "-wal"), sidecar_path(path, "-shm")]
        .into_iter()
        .try_for_each(|path| restrict_permissions(&path))
}

pub(super) fn sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    let mut path = path.as_os_str().to_os_string();
    path.push(suffix);
    path.into()
}

fn restrict_permissions(path: &Path) -> Result<()> {
    match fs::metadata(path) {
        Ok(_) => fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .with_context(|| format!("restrict database file permissions: {}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| format!("read database file: {}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, os::unix::fs::PermissionsExt, path::Path};

    use sqlx::{Connection, Row, SqlitePool};
    use tempfile::TempDir;

    use super::{
        super::{DatabaseKey, dbtest::key, queries},
        open, open_database,
    };

    const WRONG_KEY: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    #[test]
    fn accepts_database_paths_without_a_parent_directory() {
        assert!(super::create_parent_directory(Path::new("tallyo.db")).is_ok());
    }

    #[tokio::test]
    async fn open_configures_sqlcipher_and_connection_pragmas() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("tallyo.db");
        let pool = open_database(&path, Some(key())).await.unwrap();

        assert_ne!(pragma_text(&pool, "cipher_version").await, "");
        assert_eq!(pragma_text(&pool, "journal_mode").await, "wal");
        assert_eq!(pragma_i64(&pool, "foreign_keys").await, 1);
        assert_eq!(pragma_i64(&pool, "temp_store").await, 2);
        assert!(
            sqlx::query("INSERT INTO categories (name, emoji, group_id, sort_order) VALUES ('invalid', '?', 999, 1)")
                .execute(&pool)
                .await
                .is_err()
        );

        sqlx::query("CREATE VIRTUAL TABLE spike_fts USING fts5(value)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO spike_fts (value) VALUES ('needle')")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM spike_fts WHERE spike_fts MATCH 'needle'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        pool.close().await;

        assert!(
            open(&path, Some(DatabaseKey::try_from(WRONG_KEY.to_owned()).unwrap()))
                .await
                .is_err()
        );
        let pool = open(&path, Some(key())).await.unwrap();
        assert!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM categories")
                .fetch_one(&pool)
                .await
                .unwrap()
                > 0
        );
    }

    #[tokio::test]
    async fn open_creates_private_directories_and_files() {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("nested/tallyo.db");
        let pool = open_database(&path, None).await.unwrap();

        assert_mode(path.parent().unwrap(), 0o700);
        assert_mode(&path, 0o600);
        assert_mode(&path.with_file_name("tallyo.db-wal"), 0o600);
        assert_mode(&path.with_file_name("tallyo.db-shm"), 0o600);
        pool.close().await;
    }

    #[tokio::test]
    async fn open_database_warms_every_dynamic_filter_variant() {
        let pool = open_database(":memory:", None).await.unwrap();
        let mut connection = pool.acquire().await.unwrap();
        let warmed = connection.cached_statements_size();
        assert!(warmed >= queries::DYNFILTER_VARIANT_COUNT);

        for id in [None, Some(1)] {
            queries::list_tags(&mut *connection, queries::ListTagsParams { id })
                .await
                .unwrap();
        }
        assert_eq!(
            connection.cached_statements_size(),
            warmed,
            "runtime text must hit the warmed cache"
        );
    }

    #[tokio::test]
    async fn in_memory_pool_keeps_its_database() {
        let pool = open(":memory:", None).await.unwrap();
        sqlx::query("CREATE TABLE pool_lifetime_test (value INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO pool_lifetime_test VALUES (1)")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT value FROM pool_lifetime_test")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
    }

    fn assert_mode(path: &std::path::Path, expected: u32) {
        assert_eq!(fs::metadata(path).unwrap().permissions().mode() & 0o777, expected);
    }

    async fn pragma_text(pool: &SqlitePool, name: &str) -> String {
        sqlx::query(format!("PRAGMA {name}").as_str())
            .fetch_one(pool)
            .await
            .unwrap()
            .get(0)
    }

    async fn pragma_i64(pool: &SqlitePool, name: &str) -> i64 {
        sqlx::query(format!("PRAGMA {name}").as_str())
            .fetch_one(pool)
            .await
            .unwrap()
            .get(0)
    }
}
