use anyhow::{Context, Result, anyhow, ensure};
use sqlx::SqlitePool;

use crate::{
    database::{self, queries},
    wealth::{Asset, SyncerId},
};

use super::assets::asset_by_id;

pub async fn merge_asset_by_source(
    pool: &SqlitePool,
    adapter: SyncerId,
    source_id: &str,
    target_asset_id: i64,
) -> Result<Option<Asset>> {
    let source_id = source_id.to_owned();
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let adapter = adapter.to_string();
            let duplicate_asset_id = queries::asset_adapter_source_asset_id_opt(
                &mut **transaction,
                queries::AssetAdapterSourceAssetIdParams {
                    source_adapter: &adapter,
                    source_id: &source_id,
                },
            )
            .await
            .context("lookup adapter source")?
            .map(|row| row.asset_id)
            .ok_or_else(|| anyhow!("no such adapter source {adapter}:{source_id}"))?;
            if duplicate_asset_id == target_asset_id {
                return asset_by_id(&mut **transaction, target_asset_id).await;
            }
            let duplicate = asset_by_id(&mut **transaction, duplicate_asset_id)
                .await?
                .ok_or_else(|| anyhow!("asset {duplicate_asset_id} not found"))?;
            let target = asset_by_id(&mut **transaction, target_asset_id)
                .await?
                .ok_or_else(|| anyhow!("asset {target_asset_id} not found"))?;
            ensure!(
                duplicate.asset_type == target.asset_type,
                "cannot merge {} asset {} into {} asset {}",
                duplicate.asset_type,
                duplicate_asset_id,
                target.asset_type,
                target_asset_id
            );
            let collision = queries::asset_merge_collision_exists(
                &mut **transaction,
                queries::AssetMergeCollisionExistsParams {
                    duplicate_asset_id,
                    target_asset_id,
                },
            )
            .await
            .context("check asset merge collision")?
            .has_collision;
            ensure!(
                !collision,
                "cannot merge assets {duplicate_asset_id} and {target_asset_id} because a snapshot or account/date holds both"
            );
            let params = queries::UpdateAssetDailyHoldingsAssetIdParams {
                duplicate_asset_id,
                target_asset_id,
            };
            queries::update_asset_daily_holdings_asset_id(&mut **transaction, params.clone())
                .await
                .context("move asset holdings")?;
            queries::move_asset_analysis_report(
                &mut **transaction,
                queries::MoveAssetAnalysisReportParams {
                    duplicate_asset_id,
                    target_asset_id,
                },
            )
            .await
            .context("move asset analysis report")?;
            queries::move_asset_adapter_sources(
                &mut **transaction,
                queries::MoveAssetAdapterSourcesParams {
                    duplicate_asset_id,
                    target_asset_id,
                },
            )
            .await
            .context("move asset adapter sources")?;
            queries::delete_asset_by_id(&mut **transaction, queries::DeleteAssetByIdParams { id: duplicate_asset_id })
                .await
                .context("delete duplicate asset")?;
            Ok(Some(target))
        })
    })
    .await
}
