use anyhow::{Context, Result, ensure};

use super::{Resolver, ids::local_id};
use crate::{
    apierror::ApiError,
    ids::GlobalIdType,
    money::Cents,
    schema::{LinkRealEstateInput, LinkRealEstatePayload, UpdateRealEstateInput, UpdateRealEstatePayload},
    wealth::store,
};

impl Resolver {
    pub async fn link_real_estate(&self, mut input: LinkRealEstateInput) -> Result<LinkRealEstatePayload> {
        ensure!(
            input.manual_valuation_usd > Cents::default(),
            ApiError::bad_input("manualValuationUSD must be positive")
        );
        local_id(&input.owner_id, GlobalIdType::Owner)?;
        input.label = input.label.map(|label| label.trim().to_owned());
        self.wealth.link_real_estate(input).await.context("link real estate")
    }

    pub async fn update_real_estate(&self, input: UpdateRealEstateInput) -> Result<UpdateRealEstatePayload> {
        ensure!(
            input.valuation_usd.is_none_or(|valuation| valuation > Cents::default()),
            ApiError::bad_input("valuationUSD must be positive")
        );
        let connection_id = local_id(&input.connection_id, GlobalIdType::Connection)?;
        ensure!(
            store::real_estate_by_connection_id(&self.pool, connection_id)
                .await?
                .is_some(),
            ApiError::bad_input(format!("real estate not found for connection {connection_id}"))
        );
        let account = self
            .wealth
            .update_real_estate(input)
            .await
            .context("update real estate")?;
        Ok(UpdateRealEstatePayload { account })
    }

    pub async fn unlink_real_estate(&self, id: &async_graphql::ID) -> Result<bool> {
        local_id(id, GlobalIdType::Connection)?;
        self.wealth
            .unlink_real_estate(id.as_str())
            .await
            .context("unlink real estate")
    }
}
