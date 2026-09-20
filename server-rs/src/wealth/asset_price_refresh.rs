use anyhow::Result;
use chrono::Utc;

use crate::schema::UpdateAssetInput;

use super::{Asset, WealthService, store};

impl WealthService {
    pub(super) async fn refresh_changed_asset_market_price(
        &self,
        input: &UpdateAssetInput,
        asset: Asset,
    ) -> Result<Asset> {
        let identifier = input.identifier.as_deref().unwrap_or(&asset.identifier);
        let price_asset = Asset {
            identifier: identifier.to_owned(),
            ..asset.clone()
        };
        if let Some(provider) = self.price_provider.as_ref()
            && let Ok(price) = provider.price_at(&price_asset, Utc::now()).await
            && price > 0.0
        {
            let now = Utc::now();
            if store::update_asset_price(&self.pool, asset.id, price, now)
                .await
                .is_ok()
            {
                let _ = store::revalue_latest_asset_holdings(&self.pool, asset.id, price).await;
            }
        }
        Ok(store::asset_by_id(&self.pool, asset.id).await?.unwrap_or(asset))
    }
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::*;
    use crate::{
        database::dbtest,
        schema::{AssetClassifier, AssetType},
        wealth::{AssetUpsert, YahooPriceProvider},
    };

    #[tokio::test]
    async fn refreshes_a_changed_usd_asset_and_returns_the_stored_asset() -> Result<()> {
        let pool = dbtest::open().await?;
        let asset = store::upsert_asset(&pool, usd_asset()).await?;
        let service = WealthService::new(pool.clone(), Some(YahooPriceProvider::new(pool)?), || "UTC".to_owned());
        let input = UpdateAssetInput {
            id: async_graphql::ID::from("asset"),
            identifier: Some("USD".to_owned()),
            name: None,
            classifier: None,
            force_price: None,
            forced_usd_price: None,
            tracking_ticker: None,
            tracking_multiplier: None,
            price_connectivity: None,
            security: None,
            investment_connectivity: None,
        };

        let refreshed = service.refresh_changed_asset_market_price(&input, asset).await?;

        assert_eq!(refreshed.current_price, Some(1.0));
        Ok(())
    }

    fn usd_asset() -> AssetUpsert {
        AssetUpsert {
            asset_type: AssetType::Currency,
            identifier: "USD".to_owned(),
            name: None,
            classifier: AssetClassifier::Cash,
            user_edited: false,
            user_created: false,
            forced_usd_price: None,
            tracking_ticker: None,
            tracking_multiplier: 1.0,
            last_price: None,
            last_price_at: None,
            adapter_source: None,
            plaid_security_type: None,
            cusip: None,
            isin: None,
            simple_fin_cost_basis: None,
            simple_fin_purchase_price: None,
            line_type: None,
            chain_id: None,
            token_id: None,
            token_symbol: None,
            token_name: None,
            project_name: None,
            real_estate: None,
        }
    }
}
