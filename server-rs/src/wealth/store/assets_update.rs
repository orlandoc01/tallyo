use anyhow::{Context, Result, ensure};
use sqlx::{SqliteConnection, SqlitePool};

use crate::{
    database::{self, queries},
    schema::{AssetType, UpdateAssetInput},
    wealth::Asset,
};

use super::{
    asset_additional::{SecurityAdditional, merge_additional},
    assets::{asset_additional_by_id, asset_by_id},
};

pub async fn update_asset(pool: &SqlitePool, asset_id: i64, input: &UpdateAssetInput) -> Result<Asset> {
    let input = input.clone();
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let existing = asset_by_id(&mut **transaction, asset_id)
                .await?
                .ok_or_else(|| anyhow::anyhow!("asset {asset_id} not found"))?;
            let identifier_changed = input
                .identifier
                .as_deref()
                .is_some_and(|identifier| identifier != existing.identifier);
            let forced_price = forced_price_update(&input)?;
            let effective_ticker_changed = effective_ticker_changed(&existing, &input);
            update_asset_base(
                transaction,
                asset_id,
                &existing,
                &input,
                forced_price,
                identifier_changed,
                effective_ticker_changed,
            )
            .await?;
            asset_by_id(&mut **transaction, asset_id)
                .await?
                .ok_or_else(|| anyhow::anyhow!("asset {asset_id} not found"))
        })
    })
    .await
}

pub async fn revalue_latest_asset_holdings(pool: &SqlitePool, asset_id: i64, price: f64) -> Result<()> {
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let snapshot_ids = queries::latest_snapshot_ids_for_asset(
                &mut **transaction,
                queries::LatestSnapshotIDsForAssetParams { asset_id },
            )
            .await
            .context("list latest snapshots for asset")?
            .into_iter()
            .map(|row| row.snapshot_id)
            .collect::<Vec<_>>();
            if snapshot_ids.is_empty() {
                return Ok(());
            }
            queries::revalue_asset_holdings_by_snapshot_ids(
                &mut **transaction,
                queries::RevalueAssetHoldingsBySnapshotIDsParams {
                    price: Some(price),
                    asset_id,
                    snapshot_ids: &snapshot_ids,
                },
            )
            .await
            .context("revalue latest holdings")?;
            queries::recalculate_snapshot_balances_by_ids(
                &mut **transaction,
                queries::RecalculateSnapshotBalancesByIDsParams {
                    snapshot_ids: &snapshot_ids,
                },
            )
            .await
            .context("recalculate latest snapshot balances")
        })
    })
    .await
}

pub async fn sweep_unreferenced_assets(pool: &SqlitePool) -> Result<u64> {
    queries::delete_unreferenced_assets(pool).await.map_err(Into::into)
}

async fn update_asset_base(
    transaction: &mut SqliteConnection,
    asset_id: i64,
    existing: &Asset,
    input: &UpdateAssetInput,
    forced_price: ForcedPriceUpdate,
    identifier_changed: bool,
    effective_ticker_changed: bool,
) -> Result<()> {
    let classifier = input.classifier.map(|value| value.to_string());
    let price_connectivity = input.price_connectivity.map(|value| value.to_string());
    let investment_connectivity = input.investment_connectivity.map(|value| value.to_string());
    let result = queries::update_asset_base(
        &mut *transaction,
        queries::UpdateAssetBaseParams {
            name: input.name.as_deref(),
            identifier: input.identifier.as_deref(),
            classifier: classifier.as_deref(),
            forced_price_set: forced_price.set,
            forced_price_value: forced_price.value,
            forced_price_clear: forced_price.clear,
            tracking_ticker: input.tracking_ticker.as_deref(),
            tracking_multiplier: input.tracking_multiplier,
            clear_market_price: identifier_changed,
            price_connectivity: price_connectivity.as_deref(),
            effective_ticker_changed,
            investment_connectivity: investment_connectivity.as_deref(),
            id: asset_id,
        },
    )
    .await;
    if let Err(error) = result {
        if error.to_string().contains("UNIQUE constraint failed") {
            let identifier = input.identifier.as_deref().unwrap_or("<none>");
            return Err(anyhow::anyhow!(
                "an asset with identifier {identifier:?} already exists for type {:?}",
                existing.asset_type
            ));
        }
        return Err(error).context("update asset base");
    }
    if effective_ticker_changed {
        queries::delete_asset_analysis_report_by_asset_id(
            &mut *transaction,
            queries::DeleteAssetAnalysisReportByAssetIdParams { asset_id },
        )
        .await
        .context("delete stale asset analysis report")?;
    }
    update_asset_security(transaction, asset_id, existing.asset_type, input).await
}

async fn update_asset_security(
    transaction: &mut SqliteConnection,
    asset_id: i64,
    asset_type: AssetType,
    input: &UpdateAssetInput,
) -> Result<()> {
    if asset_type != AssetType::Security {
        return Ok(());
    }
    let Some(security) = input.security.as_ref() else {
        return Ok(());
    };
    let current = asset_additional_by_id(&mut *transaction, asset_id).await?;
    let incoming = serde_json::to_string(&SecurityAdditional {
        plaid_security_type: None,
        cusip: security.cusip.clone(),
        isin: security.isin.clone(),
        simple_fin_cost_basis: None,
        simple_fin_purchase_price: None,
    })?;
    let merged = merge_additional(asset_type, current.as_deref(), Some(&incoming))?;
    queries::update_asset_additional(
        &mut *transaction,
        queries::UpdateAssetAdditionalParams {
            additional: merged.as_deref(),
            id: asset_id,
        },
    )
    .await
    .context("update security additional")?;
    Ok(())
}

#[derive(Clone, Copy, Debug)]
struct ForcedPriceUpdate {
    value: Option<f64>,
    set: bool,
    clear: bool,
}

fn forced_price_update(input: &UpdateAssetInput) -> Result<ForcedPriceUpdate> {
    match input.force_price {
        None => Ok(ForcedPriceUpdate {
            value: input.forced_usd_price,
            set: input.forced_usd_price.is_some(),
            clear: false,
        }),
        Some(false) => Ok(ForcedPriceUpdate {
            value: None,
            set: false,
            clear: true,
        }),
        Some(true) => {
            ensure!(
                input.forced_usd_price.is_some(),
                "forcedUsdPrice is required when forcePrice is true"
            );
            Ok(ForcedPriceUpdate {
                value: input.forced_usd_price,
                set: true,
                clear: false,
            })
        }
    }
}

fn effective_ticker_changed(existing: &Asset, input: &UpdateAssetInput) -> bool {
    let identifier = input.identifier.as_deref().unwrap_or(&existing.identifier);
    let ticker = input.tracking_ticker.as_deref().or(existing.tracking_ticker.as_deref());
    effective_portfolio_ticker(&existing.identifier, existing.tracking_ticker.as_deref())
        != effective_portfolio_ticker(identifier, ticker)
}

fn effective_portfolio_ticker(identifier: &str, tracking_ticker: Option<&str>) -> String {
    tracking_ticker
        .map(str::trim)
        .filter(|ticker| !ticker.is_empty())
        .unwrap_or(identifier)
        .trim()
        .to_ascii_uppercase()
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::{
        effective_portfolio_ticker, forced_price_update, revalue_latest_asset_holdings, sweep_unreferenced_assets,
        update_asset,
    };
    use crate::{database::dbtest, schema::UpdateAssetInput};

    #[test]
    fn normalizes_the_portfolio_ticker_and_requires_a_forced_price() {
        assert_eq!(effective_portfolio_ticker(" vti ", Some(" vxus ")), "VXUS");
        let input = UpdateAssetInput {
            id: async_graphql::ID::from("asset"),
            identifier: None,
            name: None,
            classifier: None,
            force_price: Some(true),
            forced_usd_price: None,
            tracking_ticker: None,
            tracking_multiplier: None,
            price_connectivity: None,
            security: None,
            investment_connectivity: None,
        };
        assert_eq!(
            forced_price_update(&input).unwrap_err().to_string(),
            "forcedUsdPrice is required when forcePrice is true"
        );
    }

    #[test]
    fn applies_each_forced_price_mode() {
        let input = |force_price, forced_usd_price| UpdateAssetInput {
            id: async_graphql::ID::from("asset"),
            identifier: None,
            name: None,
            classifier: None,
            force_price,
            forced_usd_price,
            tracking_ticker: None,
            tracking_multiplier: None,
            price_connectivity: None,
            security: None,
            investment_connectivity: None,
        };

        let unchanged = forced_price_update(&input(None, Some(2.0))).unwrap();
        assert!(unchanged.set);
        assert!(!unchanged.clear);
        let cleared = forced_price_update(&input(Some(false), Some(2.0))).unwrap();
        assert!(!cleared.set);
        assert!(cleared.clear);
        let forced = forced_price_update(&input(Some(true), Some(2.0))).unwrap();
        assert_eq!(forced.value, Some(2.0));
    }

    #[tokio::test]
    async fn updates_assets_revalues_latest_holdings_and_sweeps_orphans() -> Result<()> {
        let pool = dbtest::open().await?;
        sqlx::query("INSERT INTO owners (id, name) VALUES (1, 'Owner')")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES (1, 'checking', 1, 'Checking', 'CHECKING')")
            .execute(&pool)
            .await?;
        let asset_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO assets (asset_type, identifier, classifier, last_price, last_price_at) VALUES ('SECURITY', 'VTI', 'PUBLIC', 10, '2026-01-01T00:00:00Z') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        sqlx::query("INSERT INTO account_balance_daily_snapshots (id, account_id, source, date, synced_at, balance_usd_cents, flagged) VALUES (1, 1, 'test', '2026-01-01', '2026-01-01T00:00:00Z', 100, 0)")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO asset_daily_holdings (snapshot_id, account_id, date, asset_id, quantity, value_usd_cents) VALUES (1, 1, '2026-01-01', ?, 2, 100)")
            .bind(asset_id)
            .execute(&pool)
            .await?;
        let input = UpdateAssetInput {
            id: async_graphql::ID::from(asset_id.to_string()),
            identifier: Some("VOO".to_owned()),
            name: Some("Vanguard".to_owned()),
            classifier: None,
            force_price: Some(true),
            forced_usd_price: Some(20.0),
            tracking_ticker: Some("VOO".to_owned()),
            tracking_multiplier: Some(1.5),
            price_connectivity: None,
            security: None,
            investment_connectivity: None,
        };

        let updated = update_asset(&pool, asset_id, &input).await?;
        assert_eq!(
            (updated.identifier, updated.forced_usd_price),
            ("VOO".to_owned(), Some(20.0))
        );
        revalue_latest_asset_holdings(&pool, asset_id, 25.0).await?;
        assert_eq!(
            sqlx::query_as::<_, (i64, i64)>("SELECT value_usd_cents, balance_usd_cents FROM asset_daily_holdings JOIN account_balance_daily_snapshots ON snapshot_id = account_balance_daily_snapshots.id")
                .fetch_one(&pool)
                .await?,
            (5_000, 5_000)
        );
        sqlx::query(
            "INSERT INTO assets (asset_type, identifier, classifier) VALUES ('CRYPTO', 'orphan', 'CRYPTOCURRENCY')",
        )
        .execute(&pool)
        .await?;
        assert_eq!(sweep_unreferenced_assets(&pool).await?, 1);
        Ok(())
    }
}
