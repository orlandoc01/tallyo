use anyhow::Result;

use crate::database::{dbtest, queries};

async fn token(pool: &sqlx::SqlitePool, suffix: &str) -> Result<i64> {
    let owner_id = sqlx::query_scalar::<_, i64>("INSERT INTO owners (name) VALUES (?) RETURNING id")
        .bind(format!("owner-{suffix}"))
        .fetch_one(pool)
        .await?;
    Ok(sqlx::query_scalar::<_, i64>(
        "INSERT INTO simplefin_access_tokens (access_url, owner_id) VALUES (?, ?) RETURNING id",
    )
    .bind(format!("https://{suffix}"))
    .bind(owner_id)
    .fetch_one(pool)
    .await?)
}

#[tokio::test]
async fn lists_access_tokens_with_optional_id() -> Result<()> {
    let pool = dbtest::open().await?;
    let token_id = token(&pool, "one").await?;
    token(&pool, "two").await?;
    assert_eq!(
        queries::simple_fin_access_tokens(&pool, queries::SimpleFinAccessTokensParams::default())
            .await?
            .len(),
        2
    );
    assert_eq!(
        queries::simple_fin_access_tokens(&pool, queries::SimpleFinAccessTokensParams { id: Some(token_id) },)
            .await?
            .len(),
        1
    );
    Ok(())
}

#[tokio::test]
async fn lists_connections_with_optional_slices() -> Result<()> {
    let pool = dbtest::open().await?;
    let token_id = token(&pool, "one").await?;
    let other_token_id = token(&pool, "two").await?;
    let connection_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO simplefin_connections (external_id, access_token_id) VALUES ('connection', ?) RETURNING id",
    )
    .bind(token_id)
    .fetch_one(&pool)
    .await?;
    let other_connection_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO simplefin_connections (external_id, access_token_id) VALUES ('connection-two', ?) RETURNING id",
    )
    .bind(other_token_id)
    .fetch_one(&pool)
    .await?;
    let owner_id = sqlx::query_scalar::<_, i64>("SELECT owner_id FROM simplefin_access_tokens WHERE id = ?")
        .bind(token_id)
        .fetch_one(&pool)
        .await?;
    let other_owner_id = sqlx::query_scalar::<_, i64>("SELECT owner_id FROM simplefin_access_tokens WHERE id = ?")
        .bind(other_token_id)
        .fetch_one(&pool)
        .await?;
    sqlx::query("INSERT INTO connections (source_table, source_id, owner_id, is_active) VALUES ('simplefin_connections', ?, ?, 1)")
        .bind(connection_id)
        .bind(owner_id)
        .execute(&pool)
        .await?;
    sqlx::query("INSERT INTO connections (source_table, source_id, owner_id, is_active) VALUES ('simplefin_connections', ?, ?, 1)")
        .bind(other_connection_id)
        .bind(other_owner_id)
        .execute(&pool)
        .await?;

    assert_eq!(
        queries::simple_fin_connections(&pool, queries::SimpleFinConnectionsParams::default())
            .await?
            .into_iter()
            .map(|row| row.id)
            .collect::<Vec<_>>(),
        [connection_id, other_connection_id]
    );
    assert_eq!(
        queries::simple_fin_connections(
            &pool,
            queries::SimpleFinConnectionsParams {
                access_token_ids: Some(&[token_id]),
                ..Default::default()
            },
        )
        .await?
        .into_iter()
        .map(|row| row.id)
        .collect::<Vec<_>>(),
        [connection_id]
    );
    assert_eq!(
        queries::simple_fin_connections(
            &pool,
            queries::SimpleFinConnectionsParams {
                ids: Some(&[connection_id]),
                ..Default::default()
            },
        )
        .await?
        .into_iter()
        .map(|row| row.id)
        .collect::<Vec<_>>(),
        [connection_id]
    );
    let external_ids = ["connection".to_owned()];
    assert_eq!(
        queries::simple_fin_connections(
            &pool,
            queries::SimpleFinConnectionsParams {
                external_ids: Some(&external_ids),
                ..Default::default()
            },
        )
        .await?
        .into_iter()
        .map(|row| row.id)
        .collect::<Vec<_>>(),
        [connection_id]
    );
    Ok(())
}
