use anyhow::Result;

use super::{Resolver, ids::local_id};
use crate::{
    accounts::{SimpleFinAccessToken, store},
    apierror::ApiError,
    ids::GlobalIdType,
    schema::{CreateSimpleFinAccessTokenInput, CreateSimpleFinAccessTokenPayload, SimpleFinAccessTokenList},
};

impl Resolver {
    pub async fn simple_fin_access_tokens(&self) -> Result<SimpleFinAccessTokenList> {
        Ok(SimpleFinAccessTokenList {
            items: store::simple_fin_access_tokens(&self.pool).await?,
        })
    }

    pub async fn create_simple_fin_access_token(
        &self,
        input: CreateSimpleFinAccessTokenInput,
    ) -> Result<CreateSimpleFinAccessTokenPayload> {
        let owner_id = local_id(&input.owner_id, GlobalIdType::Owner)?;
        self.simplefin
            .create_access_token(&input.setup_token, owner_id, input.label.as_deref().unwrap_or_default())
            .await
    }

    pub async fn delete_simple_fin_access_token(&self, id: &async_graphql::ID) -> Result<bool> {
        let token_id = local_id(id, GlobalIdType::SimpleFinAccessToken)?;
        self.simplefin.delete_access_token(token_id).await?;
        Ok(true)
    }

    pub async fn reset_simple_fin_sync(&self, id: &async_graphql::ID) -> Result<SimpleFinAccessToken> {
        let token_id = local_id(id, GlobalIdType::SimpleFinAccessToken)?;
        self.simplefin
            .reset_sync(token_id)
            .await?
            .ok_or_else(|| ApiError::bad_input(format!("simplefin access token {token_id} not found")).into())
    }
}
