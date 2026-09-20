use std::collections::HashMap;

use async_graphql::dataloader::{DataLoader, Loader};
use chrono::{DateTime, Utc};

use super::Resolver;
use crate::{
    accounts::{self, Account, AccountRecord, ConnectionRecord, EvmWallet, PlaidItemRecord, SimpleFinConnection},
    admin::{self, PlaidCredential},
    transactions::{self, Tag},
    wealth::{self, AccountSnapshot, AssetAdapterSource, AssetRecord, AssetSnapshot},
};

/// Request-scoped batch loaders are created per request, so nothing is cached across requests.
pub struct Loaders(DataLoader<Resolver>);

impl Loaders {
    pub fn new(resolver: &Resolver) -> Self {
        Self(DataLoader::new(resolver.clone(), tokio::spawn))
    }

    pub async fn load_one<K>(&self, key: K) -> async_graphql::Result<Option<<Resolver as Loader<K>>::Value>>
    where
        K: Send + Sync + std::hash::Hash + Eq + Clone + 'static,
        Resolver: Loader<K, Error = async_graphql::Error>,
    {
        self.0.load_one(key).await
    }
}

// Loader tasks run on the test thread under the current-thread runtime, so this sees one request.
#[cfg(test)]
thread_local! {
    pub(super) static BATCHES: std::cell::RefCell<Vec<&'static str>> = const { std::cell::RefCell::new(Vec::new()) };
}

macro_rules! loader {
    ($key:ident($id:ty) => $value:ty, |$resolver:ident, $ids:ident| $fetch:expr) => {
        #[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
        pub(super) struct $key(pub(super) $id);

        impl Loader<$key> for Resolver {
            type Value = $value;
            type Error = async_graphql::Error;

            async fn load(&self, keys: &[$key]) -> Result<HashMap<$key, Self::Value>, Self::Error> {
                #[cfg(test)]
                BATCHES.with(|batches| batches.borrow_mut().push(stringify!($key)));
                let $resolver = self;
                let $ids = keys.iter().map(|key| key.0).collect::<Vec<_>>();
                let values: HashMap<$id, $value> = $fetch.await.map_err(async_graphql::Error::new_with_source)?;
                Ok(values.into_iter().map(|(id, value)| ($key(id), value)).collect())
            }
        }
    };
}

loader!(AccountLatestSnapshotKey(i64) => AccountSnapshot, |resolver, ids| resolver.wealth.account_latest_snapshots(&ids));
loader!(AccountLastSyncedAtKey(i64) => DateTime<Utc>, |resolver, ids| resolver.wealth.accounts_last_synced_at(&ids));
loader!(AccountKey(i64) => AccountRecord, |resolver, ids| accounts::store::accounts_by_ids(&resolver.pool, &ids));
loader!(AssetKey(i64) => AssetRecord, |resolver, ids| wealth::store::assets_by_ids(&resolver.pool, &ids));
loader!(AssetAdapterSourcesKey(i64) => Vec<AssetAdapterSource>, |resolver, ids| wealth::store::asset_adapter_sources_by_asset_ids(&resolver.pool, &ids));
loader!(AssetLatestSnapshotKey(i64) => AssetSnapshot, |resolver, ids| resolver.wealth.asset_snapshots_by_ids(&ids));
loader!(RuleAccountsKey(i64) => Vec<Account>, |resolver, ids| accounts::store::accounts_by_rule_ids(&resolver.pool, &ids));
loader!(RuleTagsKey(i64) => Vec<Tag>, |resolver, ids| transactions::store::tags_by_rule_ids(&resolver.pool, &ids));
loader!(ConnectionKey(i64) => ConnectionRecord, |resolver, ids| accounts::store::connections_by_ids(&resolver.pool, &ids));
loader!(PlaidItemKey(i64) => PlaidItemRecord, |resolver, ids| accounts::store::plaid_items_by_ids(&resolver.pool, &ids));
loader!(EvmWalletKey(i64) => EvmWallet, |resolver, ids| accounts::store::evm_wallets_by_connection_ids(&resolver.pool, &ids));
loader!(SimpleFinConnectionKey(i64) => SimpleFinConnection, |resolver, ids| async {
    accounts::store::simple_fin_connections_by_conn_ids(&resolver.pool, &ids)
        .await
        .map(|records| records.into_iter().map(|(id, record)| (id, record.connection)).collect())
});
loader!(SimpleFinConnectionsByTokenKey(i64) => Vec<SimpleFinConnection>, |resolver, ids| async {
    accounts::store::simple_fin_connections_by_token_ids(&resolver.pool, &ids)
        .await
        .map(|by_token| {
            by_token
                .into_iter()
                .map(|(id, records)| (id, records.into_iter().map(|record| record.connection).collect()))
                .collect()
        })
});
loader!(PlaidCredentialKey(i64) => PlaidCredential, |resolver, ids| admin::store::plaid_credentials_by_ids(&resolver.pool, &ids));
loader!(ItemAccountsKey(i64) => Vec<Account>, |resolver, ids| accounts::store::accounts_by_items(&resolver.pool, &ids));
loader!(TransactionTagsKey(i64) => Vec<Tag>, |resolver, ids| transactions::store::tags_by_transaction_ids(&resolver.pool, &ids));
