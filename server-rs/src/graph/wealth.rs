use anyhow::{Context as _, Result as AnyResult};
use async_graphql::{Context, Result};

use super::{
    Resolver,
    ids::{local_id, local_ids, validate_id},
    load,
    loaders::{AccountKey, AssetAdapterSourcesKey, AssetKey, AssetLatestSnapshotKey},
};
use crate::{
    accounts::{Account, store as accounts},
    apierror::ApiError,
    ids::{GlobalId, GlobalIdType},
    schema::{
        AssetList, AssetQuote, AssetResolvers, AssetsInput, CreateAssetInput, CreateAssetPayload,
        HistoricalNetWorthInput, HistoricalNetWorthReport, HoldingResolvers, MergeAssetInput, MergeAssetPayload,
        NetWorthInput, NetWorthReport, RealEstateAssetDetails, UpdateAssetInput, UpdateAssetPayload,
    },
    wealth::{AccountFilter, Asset, AssetAdapterSource, AssetDetails, AssetSnapshot, AssetType, Holding},
};

impl AssetResolvers for Asset {
    async fn details(&self, ctx: &Context<'_>) -> Result<Option<AssetDetails>> {
        if self.asset_type != AssetType::RealEstate {
            return Ok(None);
        }
        Ok(load(ctx, AssetKey(self.id))
            .await?
            .and_then(|asset| asset.address)
            .map(|address| AssetDetails::RealEstateAssetDetails(RealEstateAssetDetails { address })))
    }

    async fn adapter_sources(&self, ctx: &Context<'_>) -> Result<Vec<AssetAdapterSource>> {
        Ok(load(ctx, AssetAdapterSourcesKey(self.id)).await?.unwrap_or_default())
    }

    async fn latest_snapshot(&self, ctx: &Context<'_>) -> Result<Option<AssetSnapshot>> {
        load(ctx, AssetLatestSnapshotKey(self.id)).await
    }
}

impl HoldingResolvers for Holding {
    async fn account(&self, ctx: &Context<'_>) -> Result<Account> {
        let account_id = GlobalId::decode(self.account_id.as_str())?.i64_of_type(GlobalIdType::Account)?;
        load(ctx, AccountKey(account_id))
            .await?
            .map(|record| record.account)
            .ok_or_else(|| {
                async_graphql::Error::new_with_source(ApiError::bad_input(format!(
                    "account {:?} not found",
                    self.account_id.as_str()
                )))
            })
    }
}

impl Resolver {
    pub async fn net_worth(&self, input: NetWorthInput) -> AnyResult<NetWorthReport> {
        let as_of_date = input.as_of_date.clone();
        self.wealth.net_worth(account_filter(Some(input))?, as_of_date).await
    }

    pub async fn historical_net_worth(&self, input: HistoricalNetWorthInput) -> AnyResult<HistoricalNetWorthReport> {
        self.wealth
            .historical_net_worth(account_filter(input.filters)?, input.range, input.granularity)
            .await
    }

    pub async fn account(&self, id: &async_graphql::ID) -> AnyResult<Account> {
        let account_id = local_id(id, GlobalIdType::Account)?;
        accounts::account_by_id(&self.pool, account_id)
            .await
            .with_context(|| format!("account {:?}", id.as_str()))?
            .ok_or_else(|| ApiError::bad_input(format!("account {:?} not found", id.as_str())).into())
    }

    pub async fn assets(&self, input: Option<AssetsInput>) -> AnyResult<AssetList> {
        let input = input.unwrap_or(AssetsInput {
            asset_type: None,
            price_connectivity: None,
            include_historical: None,
            search: None,
            investment_connectivity: None,
        });
        Ok(AssetList {
            items: self.wealth.assets(input).await?,
        })
    }

    pub async fn asset_quote(&self, ticker: &str) -> AnyResult<AssetQuote> {
        self.wealth.quote(ticker).await
    }

    pub async fn create_asset(&self, input: CreateAssetInput) -> AnyResult<CreateAssetPayload> {
        Ok(CreateAssetPayload {
            asset: self.wealth.create_asset(input).await?,
        })
    }

    pub async fn update_asset(&self, input: UpdateAssetInput) -> AnyResult<UpdateAssetPayload> {
        validate_id(&input.id, GlobalIdType::Asset)?;
        Ok(UpdateAssetPayload {
            asset: self.wealth.update_asset(input).await?,
        })
    }

    pub async fn merge_asset(&self, input: MergeAssetInput) -> AnyResult<MergeAssetPayload> {
        validate_id(&input.asset_id, GlobalIdType::Asset)?;
        Ok(MergeAssetPayload {
            asset: self.wealth.merge_asset(input).await?,
        })
    }
}

fn account_filter(input: Option<NetWorthInput>) -> AnyResult<AccountFilter> {
    let Some(input) = input else {
        return Ok(AccountFilter::default());
    };
    Ok(AccountFilter {
        owner_ids: local_ids(input.owner_ids.as_deref(), GlobalIdType::Owner)?,
        account_ids: local_ids(input.account_ids.as_deref(), GlobalIdType::Account)?,
        ..AccountFilter::default()
    })
}
