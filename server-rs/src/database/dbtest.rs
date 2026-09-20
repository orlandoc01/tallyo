use std::{fs, path::Path};

use anyhow::{Context, Result};
use sqlx::SqlitePool;

use super::{DatabaseKey, open_database};

const KEY: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

pub fn key() -> DatabaseKey {
    DatabaseKey::try_from(KEY.to_owned()).unwrap()
}

pub fn is_plaintext(path: &Path) -> bool {
    fs::read(path).unwrap().starts_with(b"SQLite format 3")
}

/// Open a migrated, seeded in-memory database for tests.
pub async fn open() -> Result<SqlitePool> {
    // A replacement pool connection would see a separate empty :memory: database.
    // This depends on the non-recycling single connection.
    open_database(":memory:", None).await
}

/// Open a migrated, seeded file-backed database for tests.
pub async fn open_at(path: impl AsRef<Path>) -> Result<SqlitePool> {
    open_database(path, None).await
}

/// Verify an EXPLAIN QUERY PLAN output mentions every required fragment.
pub async fn assert_query_plan_uses(pool: &SqlitePool, query: &str, fragments: &[&str]) -> Result<()> {
    let plan = query_plan(pool, query).await?;
    for fragment in fragments {
        anyhow::ensure!(
            plan.contains(fragment),
            "query plan = {plan:?}, expected it to use {fragment}"
        );
    }
    Ok(())
}

/// Verify an EXPLAIN QUERY PLAN output omits every forbidden fragment.
pub async fn assert_query_plan_omits(pool: &SqlitePool, query: &str, fragments: &[&str]) -> Result<()> {
    let plan = query_plan(pool, query).await?;
    for fragment in fragments {
        anyhow::ensure!(
            !plan.contains(fragment),
            "query plan = {plan:?}, expected it to omit {fragment}"
        );
    }
    Ok(())
}

#[derive(sqlx::FromRow)]
struct QueryPlanRow {
    detail: String,
}

async fn query_plan(pool: &SqlitePool, query: &str) -> Result<String> {
    // EXPLAIN QUERY PLAN takes an arbitrary statement, so this stays a runtime query.
    let rows = sqlx::query_as::<_, QueryPlanRow>(&format!("EXPLAIN QUERY PLAN {query}"))
        .fetch_all(pool)
        .await
        .context("explain query plan")?;
    Ok(rows.into_iter().map(|row| row.detail).collect::<Vec<_>>().join("\n"))
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use tempfile::TempDir;

    use super::{assert_query_plan_omits, assert_query_plan_uses, open, open_at};

    #[tokio::test]
    async fn opens_migrated_and_seeded_databases() -> Result<()> {
        let in_memory = open().await?;
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM categories WHERE id = 0")
                .fetch_one(&in_memory)
                .await?,
            1
        );

        let directory = TempDir::new()?;
        let file_backed = open_at(directory.path().join("tallyo.db")).await?;
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM categories WHERE id = 0")
                .fetch_one(&file_backed)
                .await?,
            1
        );
        Ok(())
    }

    #[tokio::test]
    async fn asserts_query_plans() -> Result<()> {
        let pool = open().await?;
        sqlx::query("CREATE TABLE plan_test (id INTEGER PRIMARY KEY, name TEXT)")
            .execute(&pool)
            .await?;
        sqlx::query("CREATE INDEX idx_plan_test_name ON plan_test(name)")
            .execute(&pool)
            .await?;

        let query = "SELECT id FROM plan_test WHERE name = 'Tallyo'";
        assert_query_plan_uses(&pool, query, &["idx_plan_test_name"]).await?;
        assert_query_plan_omits(&pool, query, &["SCAN plan_test"]).await?;
        Ok(())
    }
}
