use std::collections::HashMap;

use anyhow::{Context, Result};
use sqlx::{Executor, Sqlite, SqlitePool};

use crate::{
    accounts::{ConnectionRecord, ConnectionUpdate, SourceTable, normalize_evm_chain_ids, validate_evm_chain_ids},
    apierror::ApiError,
    database::{self, Timestamp, queries},
};

pub async fn connections(
    executor: impl Executor<'_, Database = Sqlite>,
    include_inactive: bool,
) -> Result<Vec<ConnectionRecord>> {
    queries::connections(
        executor,
        queries::ConnectionsParams {
            supported_providers_only: true,
            active_only: !include_inactive,
            ..Default::default()
        },
    )
    .await?
    .into_iter()
    .map(ConnectionRecord::try_from)
    .collect()
}

pub async fn connection_by_id(
    executor: impl Executor<'_, Database = Sqlite>,
    id: i64,
) -> Result<Option<ConnectionRecord>> {
    let ids = [id];
    queries::connections(
        executor,
        queries::ConnectionsParams {
            ids: Some(&ids),
            ..Default::default()
        },
    )
    .await?
    .into_iter()
    .next()
    .map(ConnectionRecord::try_from)
    .transpose()
}

pub async fn connection_by_source(
    executor: impl Executor<'_, Database = Sqlite>,
    source_table: SourceTable,
    source_id: i64,
) -> Result<Option<ConnectionRecord>> {
    let source_table = source_table.to_string();
    queries::connections(
        executor,
        queries::ConnectionsParams {
            source_table: &source_table,
            source_id,
            source_lookup: true,
            ..Default::default()
        },
    )
    .await?
    .into_iter()
    .next()
    .map(ConnectionRecord::try_from)
    .transpose()
}

pub async fn connection_by_plaid_item_id(
    executor: impl Executor<'_, Database = Sqlite>,
    item_id: i64,
) -> Result<Option<ConnectionRecord>> {
    connection_by_source(executor, SourceTable::PlaidItems, item_id).await
}

pub async fn connections_by_ids(
    executor: impl Executor<'_, Database = Sqlite>,
    ids: &[i64],
) -> Result<HashMap<i64, ConnectionRecord>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    queries::connections(
        executor,
        queries::ConnectionsParams {
            ids: Some(ids),
            ..Default::default()
        },
    )
    .await?
    .into_iter()
    .map(|row| ConnectionRecord::try_from(row).map(|record| (record.connection.id, record)))
    .collect()
}

pub async fn upsert_connection(
    executor: impl Executor<'_, Database = Sqlite>,
    source_table: SourceTable,
    source_id: i64,
    name: Option<&str>,
    owner_id: i64,
) -> Result<i64> {
    let source_table = source_table.to_string();
    queries::upsert_connection(
        executor,
        queries::UpsertConnectionParams {
            source_table: &source_table,
            source_id,
            name,
            owner_id,
        },
    )
    .await
    .map(|row| row.id)
    .context("upsert connection")
}

pub async fn create_connection(
    pool: &SqlitePool,
    plaid_item_id: i64,
    name: Option<&str>,
    owner_id: i64,
) -> Result<ConnectionRecord> {
    let id = upsert_connection(pool, SourceTable::PlaidItems, plaid_item_id, name, owner_id).await?;
    connection_by_id(pool, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("connection {id} not found"))
}

pub async fn update_connection(
    pool: &SqlitePool,
    connection_id: i64,
    mut update: ConnectionUpdate,
) -> Result<Option<ConnectionRecord>> {
    let Some(connection) = connection_by_id(pool, connection_id).await? else {
        return Ok(None);
    };
    if (update.sync_cron.is_some() || update.recurring_sync_cron.is_some())
        && connection.source_table != SourceTable::PlaidItems
    {
        return Err(ApiError::bad_input("sync settings are only supported for Plaid connections").into());
    }
    if update.evm_chain_ids.is_some() && connection.source_table != SourceTable::EvmWallets {
        return Err(ApiError::bad_input("chainIds are only supported for EVM wallet connections").into());
    }
    if let Some(chain_ids) = update.evm_chain_ids.as_mut() {
        validate_evm_chain_ids(chain_ids)?;
        *chain_ids = normalize_evm_chain_ids(chain_ids);
    }
    if update.sync_cron.is_some() || update.recurring_sync_cron.is_some() {
        anyhow::ensure!(
            update.sync_cron.is_some()
                && update.recurring_sync_cron.is_some()
                && update.next_sync_at.is_some()
                && update.next_recurring_sync_at.is_some(),
            "syncCron and recurringSyncCron are required together"
        );
    }
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            if let Some(is_active) = update.is_active {
                queries::update_connection_active(
                    &mut **transaction,
                    queries::UpdateConnectionActiveParams {
                        is_active,
                        id: connection_id,
                    },
                )
                .await
                .context("update connection active state")?;
            }
            if let (Some(sync_cron), Some(recurring_sync_cron), Some(next_sync_at), Some(next_recurring_sync_at)) = (
                update.sync_cron.as_deref(),
                update.recurring_sync_cron.as_deref(),
                update.next_sync_at,
                update.next_recurring_sync_at,
            ) {
                queries::update_plaid_connection_sync_settings(
                    &mut **transaction,
                    queries::UpdatePlaidConnectionSyncSettingsParams {
                        sync_cron,
                        recurring_sync_cron,
                        next_sync_at: Some(Timestamp::from(next_sync_at)),
                        next_recurring_sync_at: Some(Timestamp::from(next_recurring_sync_at)),
                        id: connection.source_id,
                    },
                )
                .await
                .context("update plaid sync settings")?;
            }
            if let Some(chain_ids) = update.evm_chain_ids.as_deref() {
                let chain_ids = chain_ids.join(",");
                queries::update_evm_wallet_chain_ids(
                    &mut **transaction,
                    queries::UpdateEvmWalletChainIDsParams {
                        chain_ids: &chain_ids,
                        connection_id,
                    },
                )
                .await
                .context("update evm wallet chain ids")?;
            }
            Ok(())
        })
    })
    .await?;
    connection_by_id(pool, connection_id).await
}

pub async fn delete_connection(pool: &SqlitePool, connection_id: i64) -> Result<bool> {
    let Some(connection) = connection_by_id(pool, connection_id).await? else {
        return Ok(false);
    };
    let provider_delete = match connection.source_table {
        SourceTable::PlaidItems => ProviderDelete::PlaidItem(connection.source_id),
        SourceTable::EvmWallets => ProviderDelete::EvmWallet(connection.source_id),
        SourceTable::SimpleFinConnections => ProviderDelete::SimpleFinConnection(connection.source_id),
        SourceTable::Assets => {
            return Err(ApiError::bad_input("unsupported connection provider \"assets\"").into());
        }
    };
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            queries::delete_accounts_by_connection(
                &mut **transaction,
                queries::DeleteAccountsByConnectionParams {
                    connection_id: Some(connection_id),
                },
            )
            .await
            .context("delete accounts")?;
            match provider_delete {
                ProviderDelete::PlaidItem(id) => {
                    queries::delete_plaid_item(&mut **transaction, queries::DeletePlaidItemParams { id })
                        .await
                        .context("delete plaid item")?;
                }
                ProviderDelete::EvmWallet(id) => {
                    queries::delete_evm_wallet(&mut **transaction, queries::DeleteEvmWalletParams { id })
                        .await
                        .context("delete evm wallet")?;
                }
                ProviderDelete::SimpleFinConnection(id) => {
                    queries::delete_simple_fin_connection(
                        &mut **transaction,
                        queries::DeleteSimpleFinConnectionParams { id },
                    )
                    .await
                    .context("delete simplefin connection")?;
                }
            }
            queries::delete_connection_by_id(
                &mut **transaction,
                queries::DeleteConnectionByIdParams { id: connection_id },
            )
            .await
            .context("delete connection")?;
            Ok(())
        })
    })
    .await?;
    Ok(true)
}

enum ProviderDelete {
    PlaidItem(i64),
    EvmWallet(i64),
    SimpleFinConnection(i64),
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use chrono::Utc;

    use crate::{
        accounts::{ConnectionUpdate, SourceTable},
        database::dbtest,
        testutil::store::create_owner,
    };

    use super::*;

    #[tokio::test]
    async fn unknown_connection_source_returns_an_error() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "alex").await?;
        let id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO connections (source_table, source_id, owner_id) VALUES ('unknown', 1, ?) RETURNING id",
        )
        .bind(owner.id)
        .fetch_one(&pool)
        .await?;
        assert!(connection_by_id(&pool, id).await.is_err());
        Ok(())
    }

    #[tokio::test]
    async fn connection_settings_and_assets_deletion_are_provider_restricted() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "alex").await?;
        let asset_connection = upsert_connection(&pool, SourceTable::Assets, 1, None, owner.id).await?;
        let update = ConnectionUpdate {
            is_active: None,
            sync_cron: Some("0 * * * *".into()),
            recurring_sync_cron: Some("0 * * * *".into()),
            next_sync_at: Some(Utc::now()),
            next_recurring_sync_at: Some(Utc::now()),
            evm_chain_ids: None,
        };
        assert!(update_connection(&pool, asset_connection, update).await.is_err());
        let update = ConnectionUpdate {
            is_active: None,
            sync_cron: None,
            recurring_sync_cron: None,
            next_sync_at: None,
            next_recurring_sync_at: None,
            evm_chain_ids: Some(vec!["eth".into()]),
        };
        assert!(update_connection(&pool, asset_connection, update).await.is_err());
        assert!(delete_connection(&pool, asset_connection).await.is_err());
        Ok(())
    }

    #[tokio::test]
    async fn empty_batch_lookups_return_empty_maps() -> Result<()> {
        let pool = dbtest::open().await?;
        assert!(connections_by_ids(&pool, &[]).await?.is_empty());
        Ok(())
    }
}
