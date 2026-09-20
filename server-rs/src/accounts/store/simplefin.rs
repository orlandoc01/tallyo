use std::collections::HashMap;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sqlx::{Executor, Sqlite, SqlitePool};

use crate::{
    accounts::simplefin_types::UpsertSimpleFinConnectionParams,
    accounts::{SimpleFinConnectionRecord, SourceTable},
    database::{self, queries},
};

use super::accounts_by_connection_sources;

pub async fn link_simple_fin_connection(
    pool: &SqlitePool,
    connection: &UpsertSimpleFinConnectionParams,
) -> Result<(i64, i64)> {
    let connection = connection.clone();
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let simple_fin_connection_id = queries::upsert_simple_fin_connection(
                &mut **transaction,
                queries::UpsertSimpleFinConnectionParams {
                    external_id: &connection.external_id,
                    access_token_id: connection.access_token_id,
                    org_id: connection.org_id.as_deref(),
                    org_domain: connection.org_domain.as_deref(),
                    org_url: connection.org_url.as_deref(),
                    sfin_url: connection.sfin_url.as_deref(),
                    logo_url: connection.logo_url.as_deref(),
                },
            )
            .await?
            .id;
            let source_table = SourceTable::SimpleFinConnections.to_string();
            let connection_id = queries::upsert_connection(
                &mut **transaction,
                queries::UpsertConnectionParams {
                    source_table: &source_table,
                    source_id: simple_fin_connection_id,
                    name: (!connection.name.is_empty()).then_some(connection.name.as_str()),
                    owner_id: connection.owner_id,
                },
            )
            .await
            .context("upsert simplefin connection row")?
            .id;
            Ok((simple_fin_connection_id, connection_id))
        })
    })
    .await
}

pub async fn simple_fin_connections_by_token_ids(
    pool: &SqlitePool,
    access_token_ids: &[i64],
) -> Result<HashMap<i64, Vec<SimpleFinConnectionRecord>>> {
    let mut by_token = access_token_ids
        .iter()
        .copied()
        .map(|id| (id, Vec::new()))
        .collect::<HashMap<_, _>>();
    if access_token_ids.is_empty() {
        return Ok(by_token);
    }
    let rows = queries::simple_fin_connections(
        pool,
        queries::SimpleFinConnectionsParams {
            access_token_ids: Some(access_token_ids),
            ..Default::default()
        },
    )
    .await?;
    if rows.is_empty() {
        return Ok(by_token);
    }
    let connection_ids = rows.iter().map(|row| row.id).collect::<Vec<_>>();
    let accounts = accounts_by_connection_sources(pool, SourceTable::SimpleFinConnections, &connection_ids)
        .await
        .context("load simplefin connection accounts")?;
    for row in rows {
        let access_token_id = row.access_token_id;
        let connection_accounts = accounts.get(&row.id).cloned().unwrap_or_default();
        by_token
            .entry(access_token_id)
            .or_default()
            .push((row, connection_accounts).into());
    }
    Ok(by_token)
}

pub async fn simple_fin_connection_by_conn_id(
    pool: &SqlitePool,
    conn_id: i64,
) -> Result<Option<SimpleFinConnectionRecord>> {
    let connections = simple_fin_connections_by_conn_ids(pool, &[conn_id]).await?;
    Ok(connections.into_values().next())
}

pub async fn simple_fin_connection_ids_by_external_id(
    executor: impl Executor<'_, Database = Sqlite>,
    token_id: i64,
    external_ids: &[String],
) -> Result<HashMap<String, i64>> {
    if external_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let token_ids = [token_id];
    queries::simple_fin_connections(
        executor,
        queries::SimpleFinConnectionsParams {
            access_token_ids: Some(&token_ids),
            external_ids: Some(external_ids),
            ..Default::default()
        },
    )
    .await
    .map(|rows| rows.into_iter().map(|row| (row.external_id, row.id)).collect())
    .map_err(Into::into)
}

pub async fn simple_fin_connections_by_conn_ids(
    pool: &SqlitePool,
    conn_ids: &[i64],
) -> Result<HashMap<i64, SimpleFinConnectionRecord>> {
    if conn_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = queries::simple_fin_connections(
        pool,
        queries::SimpleFinConnectionsParams {
            ids: Some(conn_ids),
            ..Default::default()
        },
    )
    .await?;
    let accounts = accounts_by_connection_sources(pool, SourceTable::SimpleFinConnections, conn_ids)
        .await
        .context("load simplefin connection accounts")?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let id = row.id;
            let connection_accounts = accounts.get(&id).cloned().unwrap_or_default();
            (id, (row, connection_accounts).into())
        })
        .collect())
}

pub async fn set_simple_fin_connection_health(
    executor: impl Executor<'_, Database = Sqlite>,
    conn_id: i64,
    state: &str,
    error_message: Option<&str>,
    last_synced_at: DateTime<Utc>,
) -> Result<()> {
    queries::set_simple_fin_connection_health(
        executor,
        queries::SetSimpleFinConnectionHealthParams {
            health_state: state,
            health_error_message: error_message,
            last_synced_at: Some(last_synced_at.into()),
            id: conn_id,
        },
    )
    .await
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use crate::database::dbtest;

    use super::*;

    #[tokio::test]
    async fn empty_batch_lookups_return_empty_maps() -> Result<()> {
        let pool = dbtest::open().await?;
        assert!(simple_fin_connections_by_token_ids(&pool, &[]).await?.is_empty());
        assert!(simple_fin_connections_by_conn_ids(&pool, &[]).await?.is_empty());
        assert!(
            simple_fin_connection_ids_by_external_id(&pool, 1, &[])
                .await?
                .is_empty()
        );
        Ok(())
    }
}
