use anyhow::{Context, Result};
use sqlx::Executor;

use super::{dbtest, queries};
use crate::transactions::store::HANDWRITTEN_QUERIES;

#[tokio::test]
async fn queries_prepare() -> Result<()> {
    let pool = dbtest::open().await?;
    for (name, sql) in queries::QUERIES.iter().chain(HANDWRITTEN_QUERIES) {
        pool.describe(sql).await.with_context(|| format!("prepare {name}"))?;
    }
    Ok(())
}
