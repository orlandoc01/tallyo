use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sqlx::{Executor, Sqlite, SqlitePool};

use crate::{
    database::{self, queries},
    schema::ConnectivityStatus,
    wealth::AssetUpdate,
};

pub async fn persist_asset_update(pool: &SqlitePool, update: AssetUpdate) -> Result<()> {
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let updated = queries::update_asset_price(
                &mut **transaction,
                queries::UpdateAssetPriceParams {
                    last_price: Some(update.price),
                    last_price_at: Some(update.price_at.into()),
                    id: update.asset_id,
                },
            )
            .await
            .context("update asset price")?;
            if updated > 0
                && let Some(multiplier) = update.tracking_multiplier
            {
                queries::update_asset_tracking_multiplier(
                    &mut **transaction,
                    queries::UpdateAssetTrackingMultiplierParams {
                        tracking_multiplier: multiplier,
                        id: update.asset_id,
                    },
                )
                .await
                .context("update asset tracking multiplier")?;
            }
            Ok(())
        })
    })
    .await
}

pub async fn update_asset_price(
    executor: impl Executor<'_, Database = Sqlite>,
    asset_id: i64,
    price: f64,
    price_at: DateTime<Utc>,
) -> Result<u64> {
    queries::update_asset_price(
        executor,
        queries::UpdateAssetPriceParams {
            last_price: Some(price),
            last_price_at: Some(price_at.into()),
            id: asset_id,
        },
    )
    .await
    .map_err(Into::into)
}

pub async fn update_asset_price_connectivity(
    executor: impl Executor<'_, Database = Sqlite>,
    asset_id: i64,
    status: ConnectivityStatus,
) -> Result<()> {
    let status = status.to_string();
    queries::update_asset_connectivity(
        executor,
        queries::UpdateAssetConnectivityParams {
            price_connectivity: Some(&status),
            investment_connectivity: None,
            id: asset_id,
        },
    )
    .await
    .map_err(Into::into)
}

pub async fn update_asset_investment_connectivity(
    executor: impl Executor<'_, Database = Sqlite>,
    asset_id: i64,
    status: ConnectivityStatus,
) -> Result<()> {
    let status = status.to_string();
    queries::update_asset_connectivity(
        executor,
        queries::UpdateAssetConnectivityParams {
            price_connectivity: None,
            investment_connectivity: Some(&status),
            id: asset_id,
        },
    )
    .await
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::{
        persist_asset_update, update_asset_investment_connectivity, update_asset_price, update_asset_price_connectivity,
    };
    use crate::{database::dbtest, schema::ConnectivityStatus, wealth::AssetUpdate};

    #[tokio::test]
    async fn persists_prices_multipliers_and_connectivity() -> Result<()> {
        let pool = dbtest::open().await?;
        let asset_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO assets (asset_type, identifier, classifier, tracking_ticker) VALUES ('SECURITY', 'VTI', 'PUBLIC', 'VTI') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        let at = "2026-01-01T00:00:00Z".parse()?;

        update_asset_price(&pool, asset_id, 10.0, at).await?;
        persist_asset_update(
            &pool,
            AssetUpdate {
                asset_id,
                price: 12.0,
                price_at: at,
                tracking_multiplier: Some(1.5),
            },
        )
        .await?;
        update_asset_price_connectivity(&pool, asset_id, ConnectivityStatus::NotFound).await?;
        update_asset_investment_connectivity(&pool, asset_id, ConnectivityStatus::Ignore).await?;

        assert_eq!(
            sqlx::query_as::<_, (f64, f64, String, String)>(
                "SELECT last_price, tracking_multiplier, price_connectivity, investment_connectivity FROM assets WHERE id = ?",
            )
            .bind(asset_id)
            .fetch_one(&pool)
            .await?,
            (12.0, 1.5, "NOT_FOUND".to_owned(), "IGNORE".to_owned())
        );
        Ok(())
    }
}
