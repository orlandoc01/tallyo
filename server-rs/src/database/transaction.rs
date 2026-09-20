use anyhow::{Context, Result};
use sqlx::{Sqlite, SqlitePool, Transaction};

use crate::utils::future::BoxFuture;

/// Run a fallible operation in a transaction.
pub async fn with_tx<T>(
    pool: &SqlitePool,
    operation: impl for<'transaction> FnOnce(
        &'transaction mut Transaction<'_, Sqlite>,
    ) -> BoxFuture<'transaction, Result<T>>,
) -> Result<T> {
    let mut transaction = pool.begin().await.context("begin transaction")?;
    match operation(&mut transaction).await {
        Ok(value) => {
            transaction.commit().await.context("commit transaction")?;
            Ok(value)
        }
        Err(error) => {
            transaction.rollback().await.context("roll back transaction")?;
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use anyhow::{Result, anyhow};

    use super::with_tx;
    use crate::database::open;

    #[tokio::test]
    async fn commits_successful_operations() -> Result<()> {
        let pool = open(":memory:", None).await?;
        sqlx::query("CREATE TABLE transaction_test (value INTEGER)")
            .execute(&pool)
            .await?;

        with_tx(&pool, |transaction| {
            Box::pin(async move {
                sqlx::query("INSERT INTO transaction_test VALUES (1)")
                    .execute(&mut **transaction)
                    .await?;
                Ok(())
            })
        })
        .await?;

        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transaction_test")
                .fetch_one(&pool)
                .await?,
            1
        );
        Ok(())
    }

    #[tokio::test]
    async fn rolls_back_failed_operations() -> Result<()> {
        let pool = open(":memory:", None).await?;
        sqlx::query("CREATE TABLE transaction_test (value INTEGER)")
            .execute(&pool)
            .await?;

        let error = with_tx(&pool, |transaction| {
            Box::pin(async move {
                sqlx::query("INSERT INTO transaction_test VALUES (1)")
                    .execute(&mut **transaction)
                    .await?;
                Err::<(), _>(anyhow!("rollback"))
            })
        })
        .await
        .unwrap_err();

        assert_eq!(error.to_string(), "rollback");
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transaction_test")
                .fetch_one(&pool)
                .await?,
            0
        );
        Ok(())
    }
}
