use std::sync::Arc;

use anyhow::{Result, anyhow};
use chrono::Utc;
use sqlx::SqlitePool;

use crate::{
    accounts::{
        AccountsCreated, CreateLinkTokenPayload, ExchangePublicTokenPayload, LinkEvmWalletPayload, PlaidSyncKind,
        SourceTable, UpsertAccount, events::EventBus,
    },
    apierror::ApiError,
    clients::plaid::{Institution, Item, PlaidClient},
    database::queries,
    utils::{cron::next_after, favicon::duckduckgo_favicon_url, future::BoxFuture},
};

use super::{
    PlaidClientFactory, fields_from_plaid_account,
    store::{
        accounts_by_item, create_connection, create_evm_wallet, owner_by_id, plaid_item_by_id, plaid_item_secret_by_id,
        reset_item_sync, set_plaid_product_flags, upsert_account, upsert_plaid_item,
    },
    types::CompleteLinkUpdatePayload,
};

pub const DEFAULT_SYNC_CRON: &str = "0 6,18 * * *";
pub const DEFAULT_RECURRING_SYNC_CRON: &str = "0 12 * * 0";
pub const INVALID_EVM_ADDRESS: &str = "invalid EVM address: must be 0x followed by 40 hex characters";

pub trait ItemSyncer: Send + Sync {
    fn sync_item<'a>(&'a self, item_id: i64) -> BoxFuture<'a, Result<()>>;
}

pub struct LinkService {
    pub pool: SqlitePool,
    pub clients: Arc<PlaidClientFactory>,
    pub syncer: Arc<dyn ItemSyncer>,
    pub events: EventBus,
}

impl LinkService {
    pub async fn create_link_token(&self, credential_id: i64, owner_id: i64) -> Result<CreateLinkTokenPayload> {
        let owner = owner_by_id(&self.pool, owner_id)
            .await?
            .ok_or_else(|| ApiError::bad_input(format!("invalid owner id {owner_id}")))?;
        let (link_token, expiration) = self
            .clients
            .client_for_credential(credential_id)
            .await?
            .create_link_token(&owner.name)
            .await?;
        Ok(CreateLinkTokenPayload { link_token, expiration })
    }

    pub async fn exchange_public_token(
        &self,
        public_token: &str,
        credential_id: i64,
        owner_id: i64,
        institution_id: Option<String>,
        institution_name: Option<String>,
    ) -> Result<ExchangePublicTokenPayload> {
        if owner_by_id(&self.pool, owner_id).await?.is_none() {
            return Err(ApiError::bad_input(format!("invalid owner id {owner_id}")).into());
        }
        let client = self.clients.client_for_credential(credential_id).await?;
        let (access_token, external_id) = client.exchange_public_token(public_token).await?;
        let (investments_enabled, liabilities_enabled) = detect_products(&client, &access_token).await?;
        let (institution_name, logo_url) =
            resolve_institution_metadata(&client, institution_id.as_deref(), institution_name).await;
        let now = Utc::now();
        let item_id = upsert_plaid_item(
            &self.pool,
            queries::UpsertPlaidItemParams {
                external_id: &external_id,
                credential_id,
                access_token: &access_token,
                institution_id: institution_id.as_deref(),
                logo_url: logo_url.as_deref(),
                next_sync_at: Some(next_after(DEFAULT_SYNC_CRON, now)?.into()),
                next_recurring_sync_at: Some(next_after(DEFAULT_RECURRING_SYNC_CRON, now)?.into()),
                next_balance_sync_at: Some(now.into()),
                plaid_investments_enabled: investments_enabled,
                plaid_liabilities_enabled: liabilities_enabled,
            },
        )
        .await?;
        let connection = create_connection(&self.pool, item_id, institution_name.as_deref(), owner_id).await?;
        reset_item_sync(&self.pool, item_id).await?;
        self.upsert_accounts(&client, &access_token, owner_id, connection.connection.id)
            .await?;
        self.events.publish(AccountsCreated {
            connection_id: connection.connection.id,
            provider: SourceTable::PlaidItems,
            source_id: item_id,
        });
        let item = plaid_item_by_id(&self.pool, item_id)
            .await?
            .ok_or_else(|| anyhow!("plaid item {item_id} not found"))?;
        let accounts = accounts_by_item(&self.pool, item_id).await?;
        Ok(ExchangePublicTokenPayload {
            item: item.item,
            accounts,
        })
    }

    pub async fn link_evm_wallet(
        &self,
        address: &str,
        owner_id: i64,
        label: &str,
        chain_ids: &[String],
    ) -> Result<LinkEvmWalletPayload> {
        if !is_evm_address(address) {
            return Err(ApiError::bad_input(INVALID_EVM_ADDRESS).into());
        }
        super::validate_evm_chain_ids(chain_ids)?;
        let (connection, account) = create_evm_wallet(&self.pool, address, owner_id, label, chain_ids).await?;
        self.events.publish(AccountsCreated {
            connection_id: connection.connection.id,
            provider: SourceTable::EvmWallets,
            source_id: connection.source_id,
        });
        Ok(LinkEvmWalletPayload {
            connection: connection.connection,
            account,
        })
    }

    pub async fn create_update_link_token(&self, item_id: i64) -> Result<CreateLinkTokenPayload> {
        let item = plaid_item_secret_by_id(&self.pool, item_id, PlaidSyncKind::Sync)
            .await?
            .ok_or_else(|| ApiError::bad_input(format!("plaid item {item_id} not found")))?;
        let client = self
            .clients
            .client_for_credential(item.plaid_items.credential_id)
            .await?;
        let (investments_enabled, liabilities_enabled) = if item.plaid_items.plaid_investments_enabled
            && item.plaid_items.plaid_liabilities_enabled
        {
            (true, true)
        } else {
            let support = institution_wealth_product_support(&client, item.plaid_items.institution_id.as_deref()).await;
            (
                item.plaid_items.plaid_investments_enabled || !support.0,
                item.plaid_items.plaid_liabilities_enabled || !support.1,
            )
        };
        let (link_token, expiration) = client
            .create_update_link_token(
                &item.plaid_items.access_token,
                &item.owner,
                investments_enabled,
                liabilities_enabled,
            )
            .await?;
        Ok(CreateLinkTokenPayload { link_token, expiration })
    }

    pub async fn complete_link_update(&self, item_id: i64) -> Result<CompleteLinkUpdatePayload> {
        plaid_item_by_id(&self.pool, item_id)
            .await?
            .ok_or_else(|| ApiError::bad_input(format!("plaid item {item_id} not found")))?;
        if self.syncer.sync_item(item_id).await.is_ok() {
            self.sync_product_flags(item_id).await?;
        }
        let item = plaid_item_by_id(&self.pool, item_id)
            .await?
            .ok_or_else(|| anyhow!("plaid item {item_id} not found"))?;
        Ok(CompleteLinkUpdatePayload { item: item.item })
    }

    async fn upsert_accounts(
        &self,
        client: &PlaidClient,
        access_token: &str,
        owner_id: i64,
        connection_id: i64,
    ) -> Result<()> {
        for plaid_account in client.accounts(access_token).await? {
            let fields = fields_from_plaid_account(&plaid_account);
            upsert_account(
                &self.pool,
                &UpsertAccount {
                    external_id: fields.id,
                    connection_id: Some(connection_id),
                    owner_id,
                    name: fields.name,
                    account_type: fields.account_type,
                    subtype: fields.subtype,
                    mask: fields.mask,
                    notes: None,
                    closed: false,
                    hidden: false,
                    needs_review: false,
                },
            )
            .await?;
        }
        Ok(())
    }

    async fn sync_product_flags(&self, item_id: i64) -> Result<()> {
        let Some(item) = plaid_item_secret_by_id(&self.pool, item_id, PlaidSyncKind::Sync).await? else {
            return Ok(());
        };
        let client = self
            .clients
            .client_for_credential(item.plaid_items.credential_id)
            .await?;
        let (investments_enabled, liabilities_enabled) =
            detect_products(&client, &item.plaid_items.access_token).await?;
        set_plaid_product_flags(&self.pool, item_id, investments_enabled, liabilities_enabled).await
    }
}

async fn detect_products(client: &PlaidClient, access_token: &str) -> Result<(bool, bool)> {
    let item = client.item_get(access_token).await?;
    Ok((
        plaid_item_has_product(&item, "investments"),
        plaid_item_has_product(&item, "liabilities"),
    ))
}

fn plaid_item_has_product(item: &Item, product: &str) -> bool {
    item.available_products
        .iter()
        .chain(&item.billed_products)
        .chain(item.products.iter().flatten())
        .chain(item.consented_products.iter().flatten())
        .any(|candidate| candidate == product)
}

async fn resolve_institution_metadata(
    client: &PlaidClient,
    institution_id: Option<&str>,
    provided_name: Option<String>,
) -> (Option<String>, Option<String>) {
    let Some(institution_id) = institution_id.filter(|id| !id.is_empty()) else {
        return (provided_name, None);
    };
    let Ok(institution) = client.institution(institution_id).await else {
        return (provided_name, None);
    };
    let name = provided_name.or_else(|| (!institution.name.is_empty()).then_some(institution.name));
    let logo_url = institution.url.as_deref().and_then(duckduckgo_favicon_url);
    (name, logo_url)
}

async fn institution_wealth_product_support(client: &PlaidClient, institution_id: Option<&str>) -> (bool, bool) {
    let Some(institution_id) = institution_id.filter(|id| !id.is_empty()) else {
        return (false, false);
    };
    let Ok(Institution { products, .. }) = client.institution(institution_id).await else {
        return (false, false);
    };
    (
        products.iter().any(|product| product == "investments"),
        products.iter().any(|product| product == "liabilities"),
    )
}

fn is_evm_address(address: &str) -> bool {
    address.len() == 42 && address.starts_with("0x") && address.as_bytes()[2..].iter().all(u8::is_ascii_hexdigit)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use anyhow::Result;
    use wiremock::MockServer;

    use crate::{
        accounts::{AccountType, EventBus, ItemSyncer, LinkService, PlaidClientFactory, SourceTable, type_from_plaid},
        database::dbtest,
        testutil::{
            plaid_mock,
            store::{create_owner, create_plaid_credential},
        },
        utils::future::BoxFuture,
    };

    struct FakeItemSyncer;

    impl ItemSyncer for FakeItemSyncer {
        fn sync_item<'a>(&'a self, _item_id: i64) -> BoxFuture<'a, Result<()>> {
            Box::pin(async { Ok(()) })
        }
    }

    #[test]
    fn maps_plaid_account_types() {
        assert_eq!(type_from_plaid("depository"), AccountType::Depository);
        assert_eq!(type_from_plaid("credit"), AccountType::Credit);
        assert_eq!(type_from_plaid("loan"), AccountType::Loan);
        assert_eq!(type_from_plaid("investment"), AccountType::Investment);
        assert_eq!(type_from_plaid("other"), AccountType::Other);
        assert_eq!(type_from_plaid("unknown"), AccountType::Other);
    }

    #[tokio::test]
    async fn links_plaid_and_evm_accounts_and_refreshes_link_updates() -> Result<()> {
        let server = MockServer::start().await;
        plaid_mock::mount_link_flow(&server).await;
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "alex").await?;
        let credential_id = create_plaid_credential(&pool).await?;
        let events = EventBus::default();
        let mut subscriber = events.register_subscriber("test");
        let syncer: Arc<dyn ItemSyncer> = Arc::new(FakeItemSyncer);
        let service = LinkService {
            pool: pool.clone(),
            clients: Arc::new(PlaidClientFactory::with_base_url(pool.clone(), server.uri())),
            syncer,
            events: events.clone(),
        };
        assert_eq!(
            service.create_link_token(credential_id, owner.id).await?.link_token,
            "link"
        );
        let exchange = service
            .exchange_public_token("public", credential_id, owner.id, Some("ins".into()), None)
            .await?;
        assert_eq!(exchange.accounts.len(), 1);
        assert_eq!(exchange.item.institution_id.as_deref(), Some("ins"));
        assert_eq!(subscriber.recv().await.unwrap().provider, SourceTable::PlaidItems);
        assert_eq!(
            service.create_update_link_token(exchange.item.id).await?.link_token,
            "link"
        );
        assert!(
            service.complete_link_update(exchange.item.id).await?.item.health_state
                == crate::accounts::PlaidItemHealthState::Healthy
        );

        let wallet = service
            .link_evm_wallet(
                "0x1111111111111111111111111111111111111111",
                owner.id,
                "Wallet",
                &["eth".into()],
            )
            .await?;
        let created = subscriber.recv().await.unwrap();
        assert_eq!(created.provider, SourceTable::EvmWallets);
        assert_eq!(created.connection_id, wallet.connection.id);
        assert!(
            service
                .link_evm_wallet("bad", owner.id, "", &["eth".into()])
                .await
                .is_err()
        );
        assert!(
            service
                .link_evm_wallet("0x2222222222222222222222222222222222222222", owner.id, "", &[])
                .await
                .is_err()
        );
        Ok(())
    }
}
