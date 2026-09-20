use anyhow::{Context, Result};
use sqlx::{
    SqlitePool,
    migrate::{Migrate, Migrator},
};

// The Go server's final goose version: 00001 schema + 00002 seed. Rust's 0001 and 0002
// migrations reproduce both, so such a database is stamped as being at sqlx version 2.
const LAST_GOOSE_VERSION: i64 = 2;
const ADOPTED_SQLX_VERSION: i64 = 2;

/// Stamp the migrations the Go server already applied on a goose-migrated database.
pub(super) async fn adopt_goose_database(pool: &SqlitePool, migrator: &Migrator) -> Result<()> {
    let goose_table_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'goose_db_version')",
    )
    .fetch_one(pool)
    .await?;
    if !goose_table_exists {
        return Ok(());
    }
    let at_last_goose_version: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM goose_db_version WHERE version_id = ? AND is_applied = 1)")
            .bind(LAST_GOOSE_VERSION)
            .fetch_one(pool)
            .await?;
    if !at_last_goose_version {
        return Ok(());
    }

    let mut connection = pool.acquire().await?;
    connection.ensure_migrations_table().await?;
    if !connection.list_applied_migrations().await?.is_empty() {
        return Ok(());
    }
    let adopted = migrator
        .migrations
        .iter()
        .filter(|migration| migration.version <= ADOPTED_SQLX_VERSION);
    for migration in adopted {
        sqlx::query(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
             VALUES (?, ?, TRUE, ?, 0)",
        )
        .bind(migration.version)
        .bind(migration.description.as_ref())
        .bind(migration.checksum.as_ref())
        .execute(&mut *connection)
        .await
        .with_context(|| format!("stamp migration {} on goose database", migration.version))?;
    }
    tracing::info!("adopted goose-migrated database as sqlx version {ADOPTED_SQLX_VERSION}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use sqlx::{SqlitePool, migrate::Migrate};
    use tempfile::TempDir;

    use super::super::{MIGRATOR, open, open_database, queries};

    async fn applied_versions(pool: &SqlitePool) -> Result<Vec<i64>> {
        Ok(
            sqlx::query_scalar("SELECT version FROM _sqlx_migrations ORDER BY version")
                .fetch_all(pool)
                .await?,
        )
    }

    #[tokio::test]
    async fn adopts_a_goose_migrated_database() -> Result<()> {
        let directory = TempDir::new()?;
        let path = directory.path().join("tallyo.db");
        let pool = open(&path, None).await?;
        {
            let mut connection = pool.acquire().await?;
            connection.ensure_migrations_table().await?;
            for migration in MIGRATOR
                .migrations
                .iter()
                .filter(|migration| migration.version <= super::LAST_GOOSE_VERSION)
            {
                connection.apply(migration).await?;
            }
        }
        sqlx::query("INSERT INTO rules (merchant_pattern, original_pattern, priority) VALUES ('coffee', '', 0)")
            .execute(&pool)
            .await?;
        sqlx::query("DROP TABLE _sqlx_migrations").execute(&pool).await?;
        sqlx::query(
            "CREATE TABLE goose_db_version (id INTEGER PRIMARY KEY AUTOINCREMENT, \
             version_id INTEGER NOT NULL, is_applied INTEGER NOT NULL, tstamp TIMESTAMP)",
        )
        .execute(&pool)
        .await?;
        sqlx::query("INSERT INTO goose_db_version (version_id, is_applied) VALUES (0, 1), (1, 1), (2, 1)")
            .execute(&pool)
            .await?;
        pool.close().await;

        let expected: Vec<i64> = MIGRATOR.migrations.iter().map(|migration| migration.version).collect();
        for _ in 0..2 {
            let pool = open_database(&path, None).await?;
            assert_eq!(applied_versions(&pool).await?, expected);
            let stamped: i64 = sqlx::query_scalar("SELECT count(*) FROM _sqlx_migrations WHERE execution_time = 0")
                .fetch_one(&pool)
                .await?;
            assert_eq!(stamped, 2, "adopted migrations are stamped, not executed");
            assert_eq!(
                queries::list_rules(
                    &pool,
                    queries::ListRulesParams {
                        search_match: Some("\"cof\"*"),
                        ..Default::default()
                    },
                )
                .await?
                .len(),
                1,
                "rules_fts rebuild must backfill rules that predate the migration"
            );
            pool.close().await;
        }
        Ok(())
    }
}
