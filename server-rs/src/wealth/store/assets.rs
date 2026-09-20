use std::collections::HashMap;

use anyhow::{Context, Result, anyhow};
use sqlx::{Executor, Sqlite, SqliteConnection, SqlitePool};

use crate::{
    database::{self, Timestamp, queries},
    wealth::{AdapterSource, Asset, AssetAdapterSource, AssetRecord, AssetUpsert, normalize_tracking},
};

use super::asset_additional::{additional_from_upsert, merge_additional};

pub async fn asset_by_id(executor: impl Executor<'_, Database = Sqlite>, id: i64) -> Result<Option<Asset>> {
    queries::assets(
        executor,
        queries::AssetsParams {
            id: Some(id),
            ..Default::default()
        },
    )
    .await?
    .into_iter()
    .next()
    .map(|row| row.assets.try_into())
    .transpose()
}

pub async fn asset_by_key(
    executor: impl Executor<'_, Database = Sqlite>,
    asset_type: crate::schema::AssetType,
    identifier: &str,
) -> Result<Option<AssetRecord>> {
    let asset_type = asset_type.to_string();
    queries::assets(
        executor,
        queries::AssetsParams {
            asset_type: Some(&asset_type),
            identifier: Some(identifier),
            ..Default::default()
        },
    )
    .await?
    .into_iter()
    .next()
    .map(|row| row.assets.try_into())
    .transpose()
}

pub(super) async fn asset_additional_by_id(
    executor: impl Executor<'_, Database = Sqlite>,
    id: i64,
) -> Result<Option<String>> {
    let row = queries::assets(
        executor,
        queries::AssetsParams {
            id: Some(id),
            ..Default::default()
        },
    )
    .await?
    .into_iter()
    .next();
    Ok(row.and_then(|row| row.assets.additional))
}

pub async fn assets_by_ids(
    executor: impl Executor<'_, Database = Sqlite>,
    ids: &[i64],
) -> Result<HashMap<i64, AssetRecord>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    queries::assets(
        executor,
        queries::AssetsParams {
            ids: Some(ids),
            ..Default::default()
        },
    )
    .await?
    .into_iter()
    .map(|row| {
        let record: AssetRecord = row.assets.try_into()?;
        Ok((record.asset.id, record))
    })
    .collect()
}

pub async fn asset_adapter_sources_by_asset_ids(
    executor: impl Executor<'_, Database = Sqlite>,
    asset_ids: &[i64],
) -> Result<HashMap<i64, Vec<AssetAdapterSource>>> {
    if asset_ids.is_empty() {
        return Ok(HashMap::new());
    }
    queries::asset_adapter_sources_by_asset_ids(executor, queries::AssetAdapterSourcesByAssetIDsParams { asset_ids })
        .await?
        .into_iter()
        .map(|row| {
            Ok((
                row.asset_id,
                AssetAdapterSource {
                    source_adapter: row
                        .source_adapter
                        .parse::<crate::wealth::SyncerId>()
                        .with_context(|| format!("parse asset source adapter {:?}", row.source_adapter))?
                        .asset_source_adapter()
                        .ok_or_else(|| anyhow!("syncer {} cannot be an asset adapter source", row.source_adapter))?,
                    source_id: row.source_id,
                },
            ))
        })
        .collect::<Result<Vec<_>>>()
        .map(|sources| {
            sources.into_iter().fold(
                HashMap::<i64, Vec<AssetAdapterSource>>::new(),
                |mut grouped, (asset_id, source)| {
                    grouped.entry(asset_id).or_default().push(source);
                    grouped
                },
            )
        })
}

pub async fn upsert_asset(pool: &SqlitePool, asset: AssetUpsert) -> Result<Asset> {
    database::with_tx(pool, |transaction| {
        Box::pin(async move { upsert_asset_in_transaction(transaction, asset).await })
    })
    .await
}

pub(crate) async fn upsert_asset_in_transaction(
    executor: &mut SqliteConnection,
    mut asset: AssetUpsert,
) -> Result<Asset> {
    let multiplier = if asset.tracking_multiplier != 0.0 { asset.tracking_multiplier } else { 1.0 };
    (asset.tracking_ticker, asset.tracking_multiplier) =
        normalize_tracking(&asset.identifier, asset.tracking_ticker.as_deref(), multiplier);

    if let Some(AdapterSource { adapter, source_id }) = asset.adapter_source.as_ref()
        && !source_id.is_empty()
    {
        let source_adapter = adapter.to_string();
        if let Some(row) = queries::asset_adapter_source_asset_id_opt(
            &mut *executor,
            queries::AssetAdapterSourceAssetIdParams {
                source_adapter: &source_adapter,
                source_id,
            },
        )
        .await
        .context("lookup asset adapter source")?
        {
            update_adapter_source_asset(executor, row.asset_id, &asset).await?;
            return asset_by_id(&mut *executor, row.asset_id)
                .await?
                .ok_or_else(|| anyhow!("asset {} not found", row.asset_id));
        }
    }

    let existing = asset_by_key(&mut *executor, asset.asset_type, &asset.identifier).await?;
    if existing.as_ref().is_some_and(|existing| existing.user_edited) {
        asset.name = None;
        asset.cusip = None;
        asset.isin = None;
    }
    let additional = additional_from_upsert(&asset)?;
    let asset_type = asset.asset_type.to_string();
    let classifier = asset.classifier.to_string();
    let row = queries::upsert_asset_row(
        &mut *executor,
        queries::UpsertAssetRowParams {
            asset_type: &asset_type,
            identifier: &asset.identifier,
            name: asset.name.as_deref(),
            classifier: &classifier,
            forced_usd_price: asset.forced_usd_price,
            tracking_ticker: asset.tracking_ticker.as_deref(),
            tracking_multiplier: asset.tracking_multiplier,
            additional: additional.as_deref(),
            user_edited: asset.user_edited,
            user_created: asset.user_created,
            last_price: asset.last_price,
            last_price_at: asset.last_price_at.map(Timestamp::from),
        },
    )
    .await
    .context("upsert asset")?;
    let merged_additional = merge_additional(asset.asset_type, row.additional.as_deref(), additional.as_deref())?;
    if merged_additional != row.additional {
        queries::update_asset_additional(
            &mut *executor,
            queries::UpdateAssetAdditionalParams {
                additional: merged_additional.as_deref(),
                id: row.id,
            },
        )
        .await
        .context("update asset additional")?;
    }
    if let Some(AdapterSource { adapter, source_id }) = asset.adapter_source
        && !source_id.is_empty()
    {
        let source_adapter = adapter.to_string();
        queries::insert_asset_adapter_source(
            &mut *executor,
            queries::InsertAssetAdapterSourceParams {
                asset_id: row.id,
                source_adapter: &source_adapter,
                source_id: &source_id,
            },
        )
        .await
        .context("insert asset adapter source")?;
    }
    asset_by_id(&mut *executor, row.id)
        .await?
        .ok_or_else(|| anyhow!("asset {} not found", row.id))
}

async fn update_adapter_source_asset(
    executor: &mut SqliteConnection,
    asset_id: i64,
    asset: &AssetUpsert,
) -> Result<()> {
    if asset.asset_type == crate::schema::AssetType::Crypto {
        let current = queries::assets(
            &mut *executor,
            queries::AssetsParams {
                id: Some(asset_id),
                ..Default::default()
            },
        )
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("asset {asset_id} not found"))?;
        let additional = additional_from_upsert(asset)?;
        let merged = merge_additional(
            asset.asset_type,
            current.assets.additional.as_deref(),
            additional.as_deref(),
        )?;
        queries::update_asset_additional(
            &mut *executor,
            queries::UpdateAssetAdditionalParams {
                additional: merged.as_deref(),
                id: asset_id,
            },
        )
        .await
        .context("update crypto asset additional")?;
    }
    if let Some(price) = asset.last_price {
        queries::update_asset_price(
            executor,
            queries::UpdateAssetPriceParams {
                last_price: Some(price),
                last_price_at: Some(asset.last_price_at.unwrap_or_else(chrono::Utc::now).into()),
                id: asset_id,
            },
        )
        .await
        .context("update tracked asset price")?;
    }
    Ok(())
}
