use std::collections::HashMap;

use anyhow::{Context, Result, anyhow};
use chrono::{DateTime, Utc};
use rand::RngCore;
use sqlx::{Executor, Sqlite, SqlitePool};

use crate::{
    accounts::{Account, AccountType, ConnectionRecord, EvmWallet, SourceTable, normalize_evm_chain_ids},
    database::{self, queries},
};

use super::{account_by_id, connection_by_id, owner_by_id};

pub async fn create_evm_wallet(
    pool: &SqlitePool,
    address: &str,
    owner_id: i64,
    label: &str,
    chain_ids: &[String],
) -> Result<(ConnectionRecord, Account)> {
    let address = address.to_owned();
    if owner_by_id(pool, owner_id).await.context("lookup owner")?.is_none() {
        return Err(anyhow!("unknown owner id {owner_id}"));
    }
    let name = if label.is_empty() { truncate_address(&address) } else { label.to_owned() };
    let wallet_label = label.to_owned();
    let chain_ids = normalize_evm_chain_ids(chain_ids).join(",");
    let external_id = random_id();
    let stored_name = name.clone();
    let source_table = SourceTable::EvmWallets.to_string();
    let account_type = AccountType::CryptoWallet.to_string();
    let (_wallet_id, connection_id, account_id) = database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let wallet_id = queries::insert_evm_wallet(
                &mut **transaction,
                queries::InsertEvmWalletParams {
                    address: &address,
                    label: &wallet_label,
                    chain_ids: &chain_ids,
                },
            )
            .await
            .context("insert evm_wallet")?
            .id;
            let connection_id = queries::upsert_connection(
                &mut **transaction,
                queries::UpsertConnectionParams {
                    source_table: &source_table,
                    source_id: wallet_id,
                    name: Some(&stored_name),
                    owner_id,
                },
            )
            .await
            .context("insert connection")?
            .id;
            let account_id = queries::insert_linked_account(
                &mut **transaction,
                queries::InsertLinkedAccountParams {
                    external_id: &external_id,
                    connection_id: Some(connection_id),
                    owner_id,
                    name: &stored_name,
                    r#type: &account_type,
                },
            )
            .await
            .context("insert evm account")?
            .id;
            Ok((wallet_id, connection_id, account_id))
        })
    })
    .await?;
    let connection = connection_by_id(pool, connection_id)
        .await?
        .ok_or_else(|| anyhow!("connection {connection_id} not found"))?;
    let account = account_by_id(pool, account_id)
        .await?
        .ok_or_else(|| anyhow!("account {account_id} not found"))?;
    Ok((connection, account))
}

pub async fn evm_wallet_by_connection_id(pool: &SqlitePool, connection_id: i64) -> Result<Option<EvmWallet>> {
    let wallets = evm_wallets_by_connection_ids(pool, &[connection_id]).await?;
    Ok(wallets.into_values().next())
}

pub async fn evm_wallets_by_connection_ids(
    executor: impl Executor<'_, Database = Sqlite>,
    connection_ids: &[i64],
) -> Result<HashMap<i64, EvmWallet>> {
    if connection_ids.is_empty() {
        return Ok(HashMap::new());
    }
    queries::evm_wallets(
        executor,
        queries::EvmWalletsParams {
            connection_ids: Some(connection_ids),
            ..Default::default()
        },
    )
    .await
    .map(|rows| {
        rows.into_iter()
            .map(|row| {
                let connection_id = row.connection_id;
                (connection_id, row.into())
            })
            .collect()
    })
    .context("lookup evm wallets by connection")
}

pub async fn evm_wallets_due_for_balance_sync(
    executor: impl Executor<'_, Database = Sqlite>,
    now: DateTime<Utc>,
) -> Result<Vec<EvmWallet>> {
    queries::evm_wallets(
        executor,
        queries::EvmWalletsParams {
            now: Some(now.into()),
            due_only: true,
            ..Default::default()
        },
    )
    .await
    .map(|rows| rows.into_iter().map(Into::into).collect())
    .context("list evm wallets due for balance sync")
}

pub async fn set_evm_wallet_balance_synced(
    executor: impl Executor<'_, Database = Sqlite>,
    wallet_id: i64,
    next_balance_sync_at: DateTime<Utc>,
) -> Result<()> {
    queries::set_evm_wallet_balance_synced(
        executor,
        queries::SetEvmWalletBalanceSyncedParams {
            next_balance_sync_at: Some(next_balance_sync_at.into()),
            id: wallet_id,
        },
    )
    .await
    .map_err(Into::into)
}

pub async fn evm_wallet_account_id(
    executor: impl Executor<'_, Database = Sqlite>,
    wallet_id: i64,
) -> Result<Option<i64>> {
    queries::evm_wallet_account_id_opt(executor, queries::EvmWalletAccountIdParams { wallet_id })
        .await
        .map(|row| row.map(|row| row.id))
        .map_err(Into::into)
}

pub async fn delete_evm_wallet(pool: &SqlitePool, connection_id: i64) -> Result<()> {
    let wallet = evm_wallet_by_connection_id(pool, connection_id)
        .await?
        .ok_or_else(|| anyhow!("evm wallet for connection {connection_id} not found"))?;
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
            queries::delete_connection_by_id(
                &mut **transaction,
                queries::DeleteConnectionByIdParams { id: connection_id },
            )
            .await
            .context("delete connection")?;
            queries::delete_evm_wallet(&mut **transaction, queries::DeleteEvmWalletParams { id: wallet.id })
                .await
                .context("delete evm_wallet")?;
            Ok(())
        })
    })
    .await
}

pub fn truncate_address(address: &str) -> String {
    if address.len() <= 10 {
        return address.to_owned();
    }
    format!("{}…{}", &address[..6], &address[address.len() - 4..])
}

fn random_id() -> String {
    let mut bytes = [0; 16];
    rand::rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use crate::{database::dbtest, testutil::store::create_owner};

    use super::*;

    #[tokio::test]
    async fn evm_wallet_creation_returns_the_persisted_rows() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "alex").await?;
        let (connection, account) = create_evm_wallet(
            &pool,
            "0x1111111111111111111111111111111111111111",
            owner.id,
            "",
            &["eth".into()],
        )
        .await?;
        let wallet = evm_wallet_by_connection_id(&pool, connection.connection.id)
            .await?
            .unwrap();
        assert_eq!(wallet.label, "");
        assert_eq!(
            super::super::connection_by_id(&pool, connection.connection.id).await?,
            Some(connection.clone())
        );
        assert_eq!(
            super::super::account_by_id(&pool, account.id).await?,
            Some(account.clone())
        );
        assert_eq!(evm_wallet_account_id(&pool, wallet.id).await?, Some(account.id));
        Ok(())
    }

    #[tokio::test]
    async fn empty_batch_lookups_return_empty_maps() -> Result<()> {
        let pool = dbtest::open().await?;
        assert!(evm_wallets_by_connection_ids(&pool, &[]).await?.is_empty());
        Ok(())
    }
}
