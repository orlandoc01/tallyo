use std::collections::HashMap;

use anyhow::{Context, Result};

use super::{Resolver, ids::local_id};
use crate::{
    accounts::{Account, PlaidItem, store as accounts},
    admin::{PlaidCredential, store as admin},
    ids::GlobalIdType,
    schema::{
        CompleteLinkUpdatePayload, CreateLinkTokenInput, CreateLinkTokenPayload, CreatePlaidCredentialInput,
        CreatePlaidCredentialPayload, DeletePlaidCredentialInput, DeletePlaidCredentialPayload,
        ExchangePublicTokenInput, ExchangePublicTokenPayload, PlaidCredentialList, PlaidItemList, PlaidItemsInput,
        UpdatePlaidCredentialInput, UpdatePlaidCredentialPayload,
    },
};

/// Go's hydrated Plaid item shape for callers that bypass the GraphQL loaders (MCP).
#[derive(Clone, Debug, PartialEq)]
pub struct HydratedPlaidItem {
    pub item: PlaidItem,
    pub credential: Option<PlaidCredential>,
    pub accounts: Vec<Account>,
}

impl Resolver {
    pub async fn plaid_items(&self, input: Option<PlaidItemsInput>) -> Result<PlaidItemList> {
        let include_inactive = input.is_some_and(|input| input.include_inactive.unwrap_or_default());
        Ok(PlaidItemList {
            items: accounts::plaid_items(&self.pool, include_inactive)
                .await?
                .into_iter()
                .map(|record| record.item)
                .collect(),
        })
    }

    pub async fn hydrate_plaid_items(&self, items: Vec<PlaidItem>) -> Result<Vec<HydratedPlaidItem>> {
        let item_ids = items.iter().map(|item| item.id).collect::<Vec<_>>();
        let records = accounts::plaid_items_by_ids(&self.pool, &item_ids).await?;
        let mut accounts_by_item = accounts::accounts_by_items(&self.pool, &item_ids)
            .await
            .context("load plaid item accounts")?;
        let credential_ids = records
            .values()
            .map(|record| record.credential_id)
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let mut credentials: HashMap<i64, PlaidCredential> =
            admin::plaid_credentials_by_ids(&self.pool, &credential_ids)
                .await
                .context("load plaid item credentials")?;
        Ok(items
            .into_iter()
            .map(|item| HydratedPlaidItem {
                credential: records
                    .get(&item.id)
                    .and_then(|record| credentials.remove(&record.credential_id)),
                accounts: accounts_by_item.remove(&item.id).unwrap_or_default(),
                item,
            })
            .collect())
    }

    pub async fn plaid_credentials(&self) -> Result<PlaidCredentialList> {
        Ok(PlaidCredentialList {
            items: admin::plaid_credentials(&self.pool).await?,
        })
    }

    pub async fn create_plaid_credential(
        &self,
        input: CreatePlaidCredentialInput,
    ) -> Result<CreatePlaidCredentialPayload> {
        Ok(CreatePlaidCredentialPayload {
            credential: admin::create_plaid_credential(&self.pool, input).await?,
        })
    }

    pub async fn update_plaid_credential(
        &self,
        input: UpdatePlaidCredentialInput,
    ) -> Result<UpdatePlaidCredentialPayload> {
        Ok(UpdatePlaidCredentialPayload {
            credential: admin::update_plaid_credential(&self.pool, input).await?,
        })
    }

    pub async fn delete_plaid_credential(
        &self,
        input: DeletePlaidCredentialInput,
    ) -> Result<DeletePlaidCredentialPayload> {
        Ok(DeletePlaidCredentialPayload {
            success: admin::delete_plaid_credential(&self.pool, i64::from(input.id)).await?,
        })
    }

    pub async fn create_link_token(&self, input: CreateLinkTokenInput) -> Result<CreateLinkTokenPayload> {
        let owner_id = local_id(&input.owner_id, GlobalIdType::Owner)?;
        self.linker
            .create_link_token(i64::from(input.credential_id), owner_id)
            .await
    }

    pub async fn exchange_public_token(&self, input: ExchangePublicTokenInput) -> Result<ExchangePublicTokenPayload> {
        let owner_id = local_id(&input.owner_id, GlobalIdType::Owner)?;
        self.linker
            .exchange_public_token(
                &input.public_token,
                i64::from(input.credential_id),
                owner_id,
                input.institution_id,
                input.institution_name,
            )
            .await
    }

    pub async fn create_update_link_token(&self, item_id: &async_graphql::ID) -> Result<CreateLinkTokenPayload> {
        let item_id = local_id(item_id, GlobalIdType::PlaidItem)?;
        self.linker.create_update_link_token(item_id).await
    }

    pub async fn complete_link_update(&self, item_id: &async_graphql::ID) -> Result<CompleteLinkUpdatePayload> {
        let item_id = local_id(item_id, GlobalIdType::PlaidItem)?;
        self.linker.complete_link_update(item_id).await
    }
}
