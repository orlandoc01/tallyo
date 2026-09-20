use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sqlx::{Executor, Sqlite, SqlitePool};

use crate::{
    accounts::simplefin_types::SimpleFinAccessTokenSecret,
    accounts::{SimpleFinAccessToken, SimpleFinTokenSecretKind},
    database::{self, queries},
};

pub const DEFAULT_SIMPLEFIN_SYNC_CRON: &str = "0 6,18 * * *";

pub async fn create_simple_fin_access_token(
    pool: &SqlitePool,
    access_url: &str,
    owner_id: i64,
    label: &str,
) -> Result<SimpleFinAccessToken> {
    let id = queries::create_simple_fin_access_token(
        pool,
        queries::CreateSimpleFinAccessTokenParams {
            access_url,
            label: (!label.is_empty()).then_some(label),
            owner_id,
            sync_cron: DEFAULT_SIMPLEFIN_SYNC_CRON,
            next_sync_at: Some(Utc::now().into()),
        },
    )
    .await
    .context("create simplefin access token")?
    .id;
    simple_fin_access_token_by_id(pool, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("simplefin access token {id} not found"))
}

pub async fn simple_fin_access_tokens(
    executor: impl Executor<'_, Database = Sqlite>,
) -> Result<Vec<SimpleFinAccessToken>> {
    queries::simple_fin_access_tokens(executor, queries::SimpleFinAccessTokensParams::default())
        .await
        .map(|rows| rows.into_iter().map(Into::into).collect())
        .map_err(Into::into)
}

pub async fn simple_fin_access_token_by_id(
    executor: impl Executor<'_, Database = Sqlite>,
    id: i64,
) -> Result<Option<SimpleFinAccessToken>> {
    queries::simple_fin_access_tokens(executor, queries::SimpleFinAccessTokensParams { id: Some(id) })
        .await
        .map(|rows| rows.into_iter().next().map(Into::into))
        .map_err(Into::into)
}

pub async fn simple_fin_token_secret_by_conn_id(
    executor: impl Executor<'_, Database = Sqlite>,
    conn_id: i64,
) -> Result<Option<SimpleFinAccessTokenSecret>> {
    queries::simple_fin_token_secret_by_conn_id_opt(executor, queries::SimpleFinTokenSecretByConnIdParams { conn_id })
        .await
        .map(|row| row.map(Into::into))
        .map_err(Into::into)
}

pub async fn simple_fin_token_secrets_due(
    executor: impl Executor<'_, Database = Sqlite>,
    kind: SimpleFinTokenSecretKind,
    now: DateTime<Utc>,
) -> Result<Vec<SimpleFinAccessTokenSecret>> {
    let kind = kind.to_string();
    queries::simple_fin_token_secrets(
        executor,
        queries::SimpleFinTokenSecretsParams {
            kind: &kind,
            now: Some(now.into()),
        },
    )
    .await
    .map_err(Into::into)
}

pub async fn set_simple_fin_token_synced(
    executor: impl Executor<'_, Database = Sqlite>,
    id: i64,
    last_synced_at: DateTime<Utc>,
    next_sync_at: DateTime<Utc>,
) -> Result<()> {
    queries::set_simple_fin_token_synced(
        executor,
        queries::SetSimpleFinTokenSyncedParams {
            last_synced_at: Some(last_synced_at.into()),
            next_sync_at: Some(next_sync_at.into()),
            id,
        },
    )
    .await
    .map_err(Into::into)
}

pub async fn set_simple_fin_token_balance_synced(
    executor: impl Executor<'_, Database = Sqlite>,
    id: i64,
    next_balance_sync_at: DateTime<Utc>,
) -> Result<()> {
    queries::set_simple_fin_token_balance_synced(
        executor,
        queries::SetSimpleFinTokenBalanceSyncedParams {
            next_balance_sync_at: Some(next_balance_sync_at.into()),
            id,
        },
    )
    .await
    .map_err(Into::into)
}

pub async fn delete_simple_fin_access_token(pool: &SqlitePool, id: i64) -> Result<()> {
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let connections = queries::simple_fin_connections(
                &mut **transaction,
                queries::SimpleFinConnectionsParams {
                    access_token_ids: Some(&[id]),
                    ..Default::default()
                },
            )
            .await
            .context("list simplefin connections")?;
            for connection in connections {
                queries::delete_accounts_by_connection(
                    &mut **transaction,
                    queries::DeleteAccountsByConnectionParams {
                        connection_id: Some(connection.connection_id),
                    },
                )
                .await
                .context("delete accounts")?;
                queries::delete_connection_by_id(
                    &mut **transaction,
                    queries::DeleteConnectionByIdParams {
                        id: connection.connection_id,
                    },
                )
                .await
                .context("delete connection")?;
                queries::delete_simple_fin_connection(
                    &mut **transaction,
                    queries::DeleteSimpleFinConnectionParams { id: connection.id },
                )
                .await
                .context("delete simplefin connection")?;
            }
            queries::delete_simple_fin_access_token(
                &mut **transaction,
                queries::DeleteSimpleFinAccessTokenParams { id },
            )
            .await
            .context("delete simplefin access token")
        })
    })
    .await
}

pub async fn reset_simple_fin_token_synced_at(executor: impl Executor<'_, Database = Sqlite>, id: i64) -> Result<()> {
    queries::reset_simple_fin_token_synced_at(executor, queries::ResetSimpleFinTokenSyncedAtParams { id })
        .await
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use chrono::{DateTime, Utc};

    use crate::{
        accounts::SimpleFinAccessTokenSecret,
        database::{Timestamp, dbtest},
        testutil::store::create_owner,
    };

    use super::*;

    #[tokio::test]
    async fn reused_simplefin_token_secret_round_trips_storage_fields() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "alex").await?;
        let token = create_simple_fin_access_token(&pool, "https://bridge.example", owner.id, "Bridge").await?;
        let (simple_fin_connection_id, _) = super::super::link_simple_fin_connection(
            &pool,
            &super::super::test_support::simplefin_connection(token.id, owner.id, "simplefin"),
        )
        .await?;
        let timestamp = "2026-09-06T12:00:00Z".parse::<DateTime<Utc>>()?;
        sqlx::query(
            "UPDATE simplefin_access_tokens SET created_at = ?, updated_at = ?, last_synced_at = ?, next_sync_at = ?, next_balance_sync_at = ? WHERE id = ?",
        )
        .bind(Timestamp::from(timestamp))
        .bind(Timestamp::from(timestamp))
        .bind(Timestamp::from(timestamp))
        .bind(Timestamp::from(timestamp))
        .bind(Timestamp::from(timestamp))
        .bind(token.id)
        .execute(&pool)
        .await?;

        assert_eq!(
            simple_fin_token_secret_by_conn_id(&pool, simple_fin_connection_id)
                .await?
                .unwrap(),
            SimpleFinAccessTokenSecret {
                access_url: "https://bridge.example".to_owned(),
                created_at: timestamp.into(),
                id: token.id,
                label: Some("Bridge".to_owned()),
                last_synced_at: Some(timestamp.into()),
                next_balance_sync_at: Some(timestamp.into()),
                next_sync_at: Some(timestamp.into()),
                owner_id: owner.id,
                sync_cron: DEFAULT_SIMPLEFIN_SYNC_CRON.to_owned(),
                updated_at: timestamp.into(),
            }
        );
        Ok(())
    }
}
