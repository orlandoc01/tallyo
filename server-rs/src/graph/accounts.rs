use async_graphql::{Context, Error, Result};
use chrono::{DateTime, Utc};

use super::{
    load,
    loaders::{
        AccountKey, AccountLastSyncedAtKey, AccountLatestSnapshotKey, AssetKey, ConnectionKey, EvmWalletKey,
        ItemAccountsKey, PlaidCredentialKey, PlaidItemKey, SimpleFinConnectionKey, SimpleFinConnectionsByTokenKey,
    },
};
use crate::{
    accounts::{Account, AccountType, Connection, PlaidItem, SimpleFinAccessToken, SourceTable},
    admin::PlaidCredential,
    schema::{
        AccountResolvers, AccountSnapshot, AccountWealthProperty, ConnectionProvider, ConnectionResolvers, EvmWallet,
        PlaidItemResolvers, RealEstateAssetDetails, SimpleFinAccessTokenResolvers, SimpleFinConnection,
    },
    wealth::AssetType,
};

impl AccountResolvers for Account {
    async fn connection(&self, ctx: &Context<'_>) -> Result<Option<Connection>> {
        let Some(connection_id) = connection_id(ctx, self.id).await? else {
            return Ok(None);
        };
        Ok(load(ctx, ConnectionKey(connection_id))
            .await?
            .map(|record| record.connection))
    }

    async fn type_locked(&self, _ctx: &Context<'_>) -> Result<bool> {
        Ok(self.r#type == AccountType::Property || (!self.manual && self.r#type == AccountType::CryptoWallet))
    }

    async fn last_synced_at(&self, ctx: &Context<'_>) -> Result<Option<DateTime<Utc>>> {
        load(ctx, AccountLastSyncedAtKey(self.id)).await
    }

    async fn latest_snapshot(&self, ctx: &Context<'_>) -> Result<Option<AccountSnapshot>> {
        load(ctx, AccountLatestSnapshotKey(self.id)).await
    }

    async fn account_wealth_property(&self, ctx: &Context<'_>) -> Result<Option<AccountWealthProperty>> {
        if self.r#type != AccountType::Property {
            return Ok(None);
        }
        let Some(connection_id) = connection_id(ctx, self.id).await? else {
            return Ok(None);
        };
        let Some(connection) = load(ctx, ConnectionKey(connection_id))
            .await?
            .filter(|connection| connection.source_table == SourceTable::Assets)
        else {
            return Ok(None);
        };
        Ok(load(ctx, AssetKey(connection.source_id))
            .await?
            .filter(|asset| asset.asset.asset_type == AssetType::RealEstate)
            .and_then(|asset| asset.address)
            .map(|address| AccountWealthProperty::RealEstateAssetDetails(RealEstateAssetDetails { address })))
    }
}

async fn connection_id(ctx: &Context<'_>, account_id: i64) -> Result<Option<i64>> {
    Ok(load(ctx, AccountKey(account_id))
        .await?
        .and_then(|record| record.connection_id))
}

impl ConnectionResolvers for Connection {
    async fn provider(&self, ctx: &Context<'_>) -> Result<Option<ConnectionProvider>> {
        let Some(connection) = load(ctx, ConnectionKey(self.id)).await? else {
            return Err(Error::new(format!("connection {} not found", self.id)));
        };
        let provider = match connection.source_table {
            SourceTable::PlaidItems => load(ctx, PlaidItemKey(connection.source_id))
                .await?
                .map(|record| ConnectionProvider::PlaidItem(record.item))
                .ok_or_else(|| Error::new(format!("plaid item {} not found", connection.source_id)))?,
            SourceTable::EvmWallets => load(ctx, EvmWalletKey(self.id))
                .await?
                .map(|wallet| {
                    ConnectionProvider::EvmWallet(EvmWallet {
                        address: wallet.address,
                        chain_ids: wallet.chain_ids,
                    })
                })
                .ok_or_else(|| Error::new(format!("evm wallet for connection {} not found", self.id)))?,
            SourceTable::SimpleFinConnections => load(ctx, SimpleFinConnectionKey(connection.source_id))
                .await?
                .map(ConnectionProvider::SimpleFinConnection)
                .ok_or_else(|| Error::new(format!("simplefin connection {} not found", connection.source_id)))?,
            SourceTable::Assets => return Ok(None),
        };
        Ok(Some(provider))
    }
}

impl PlaidItemResolvers for PlaidItem {
    async fn credential(&self, ctx: &Context<'_>) -> Result<PlaidCredential> {
        let item = load(ctx, PlaidItemKey(self.id))
            .await?
            .ok_or_else(|| Error::new(format!("plaid item {} not found", self.id)))?;
        load(ctx, PlaidCredentialKey(item.credential_id))
            .await?
            .ok_or_else(|| Error::new(format!("plaid credential {} not found", item.credential_id)))
    }

    async fn accounts(&self, ctx: &Context<'_>) -> Result<Vec<Account>> {
        Ok(load(ctx, ItemAccountsKey(self.id)).await?.unwrap_or_default())
    }
}

impl SimpleFinAccessTokenResolvers for SimpleFinAccessToken {
    async fn connections(&self, ctx: &Context<'_>) -> Result<Vec<SimpleFinConnection>> {
        Ok(load(ctx, SimpleFinConnectionsByTokenKey(self.id))
            .await?
            .unwrap_or_default())
    }
}
