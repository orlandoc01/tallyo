use anyhow::{Result, ensure};
use sqlx::{Executor, Sqlite, SqlitePool};

use crate::{
    database::queries,
    wealth::{AdapterSource, Asset},
};

use super::assets::asset_by_id;

pub async fn asset_by_adapter_source(pool: &SqlitePool, source: &AdapterSource) -> Result<Option<Asset>> {
    let adapter = source.adapter.to_string();
    let Some(row) = queries::asset_adapter_source_asset_id_opt(
        pool,
        queries::AssetAdapterSourceAssetIdParams {
            source_adapter: &adapter,
            source_id: &source.source_id,
        },
    )
    .await?
    else {
        return Ok(None);
    };
    asset_by_id(pool, row.asset_id).await
}

pub async fn validate_asset_merge(
    executor: impl Executor<'_, Database = Sqlite>,
    duplicate_asset_id: i64,
    target_asset_id: i64,
) -> Result<()> {
    ensure!(duplicate_asset_id != target_asset_id, "asset IDs must differ");
    let collision = queries::asset_merge_collision_exists(
        executor,
        queries::AssetMergeCollisionExistsParams {
            duplicate_asset_id,
            target_asset_id,
        },
    )
    .await?
    .has_collision;
    ensure!(
        !collision,
        "cannot merge assets {duplicate_asset_id} and {target_asset_id} because a snapshot or account/date holds both"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::{asset_by_adapter_source, validate_asset_merge};
    use crate::{
        database::dbtest,
        wealth::{AdapterSource, SyncerId},
    };

    #[tokio::test]
    async fn finds_adapter_assets_and_rejects_self_merges() -> Result<()> {
        let pool = dbtest::open().await?;
        let asset_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO assets (asset_type, identifier, classifier) VALUES ('CRYPTO', 'ETH', 'CRYPTOCURRENCY') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        sqlx::query(
            "INSERT INTO asset_adapter_sources (asset_id, source_adapter, source_id) VALUES (?, 'debank', '0xeth')",
        )
        .bind(asset_id)
        .execute(&pool)
        .await?;
        let source = AdapterSource {
            adapter: SyncerId::Debank,
            source_id: "0xeth".to_owned(),
        };

        assert_eq!(
            asset_by_adapter_source(&pool, &source).await?.map(|asset| asset.id),
            Some(asset_id)
        );
        assert!(
            asset_by_adapter_source(
                &pool,
                &AdapterSource {
                    source_id: "missing".to_owned(),
                    ..source
                }
            )
            .await?
            .is_none()
        );
        assert_eq!(
            validate_asset_merge(&pool, asset_id, asset_id)
                .await
                .unwrap_err()
                .to_string(),
            "asset IDs must differ"
        );
        validate_asset_merge(&pool, asset_id, asset_id + 1).await?;
        Ok(())
    }
}
