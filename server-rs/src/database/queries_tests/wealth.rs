use anyhow::Result;

use crate::database::{dbtest, queries};

async fn insert_asset_fixture(pool: &sqlx::SqlitePool) -> Result<()> {
    sqlx::query("INSERT INTO owners (id, name) VALUES (100, 'Owner')")
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES (100, 'account', 100, 'Account', 'CHECKING')")
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO assets (id, asset_type, identifier, classifier) VALUES (100, 'SECURITY', 'one', 'Stocks'), (101, 'CRYPTO', 'two', 'Crypto')")
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO asset_adapter_sources (asset_id, source_adapter, source_id) VALUES (100, 'test', 'one'), (101, 'test', 'two')")
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO account_balance_daily_snapshots (id, account_id, source, date, synced_at, balance_usd_cents, flagged) VALUES (100, 100, 'test', '2026-01-01', '2026-01-01T00:00:00Z', 0, 0), (101, 100, 'test', '2026-01-02', '2026-01-02T00:00:00Z', 0, 0)")
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO asset_daily_holdings (snapshot_id, account_id, date, asset_id, quantity, price, value_usd_cents) VALUES (100, 100, '2026-01-01', 100, 2, 1, 200), (101, 100, '2026-01-02', 100, 3, 1, 300)")
        .execute(pool)
        .await?;
    Ok(())
}

#[tokio::test]
async fn asset_adapter_sources_by_asset_ids_handles_empty_and_populated_slices() -> Result<()> {
    let pool = dbtest::open().await?;
    insert_asset_fixture(&pool).await?;
    assert!(
        queries::asset_adapter_sources_by_asset_ids(
            &pool,
            queries::AssetAdapterSourcesByAssetIDsParams { asset_ids: &[] },
        )
        .await?
        .is_empty()
    );
    let rows = queries::asset_adapter_sources_by_asset_ids(
        &pool,
        queries::AssetAdapterSourcesByAssetIDsParams { asset_ids: &[100] },
    )
    .await?;
    assert_eq!(rows[0].asset_id, 100);
    Ok(())
}

#[tokio::test]
async fn asset_records_omits_or_applies_dynamic_filters() -> Result<()> {
    let pool = dbtest::open().await?;
    insert_asset_fixture(&pool).await?;
    assert!(
        queries::asset_records(
            &pool,
            queries::AssetRecordsParams {
                like_name: "",
                like_identifier: "",
                ..Default::default()
            },
        )
        .await?
        .len()
            >= 2
    );
    let filtered = queries::asset_records(
        &pool,
        queries::AssetRecordsParams {
            asset_type: Some("CRYPTO"),
            like_search: true,
            like_name: "",
            like_identifier: "two",
            ..Default::default()
        },
    )
    .await?;
    assert_eq!(filtered[0].assets.id, 101);
    Ok(())
}

#[tokio::test]
async fn assets_omits_or_applies_dynamic_filters() -> Result<()> {
    let pool = dbtest::open().await?;
    insert_asset_fixture(&pool).await?;
    assert!(queries::assets(&pool, queries::AssetsParams::default()).await?.len() >= 2);
    let ids = [101];
    let filtered = queries::assets(
        &pool,
        queries::AssetsParams {
            ids: Some(&ids),
            asset_type: Some("CRYPTO"),
            identifier: Some("two"),
            ..Default::default()
        },
    )
    .await?;
    assert_eq!(filtered[0].assets.id, 101);
    Ok(())
}

#[tokio::test]
async fn recalculate_snapshot_balances_ignores_empty_slices() -> Result<()> {
    let pool = dbtest::open().await?;
    insert_asset_fixture(&pool).await?;
    queries::recalculate_snapshot_balances_by_ids(
        &pool,
        queries::RecalculateSnapshotBalancesByIDsParams { snapshot_ids: &[] },
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT balance_usd_cents FROM account_balance_daily_snapshots WHERE id = 100")
            .fetch_one(&pool)
            .await?,
        0
    );
    queries::recalculate_snapshot_balances_by_ids(
        &pool,
        queries::RecalculateSnapshotBalancesByIDsParams { snapshot_ids: &[100] },
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT balance_usd_cents FROM account_balance_daily_snapshots WHERE id = 100")
            .fetch_one(&pool)
            .await?,
        200
    );
    Ok(())
}

#[tokio::test]
async fn revalue_asset_holdings_ignores_empty_slices() -> Result<()> {
    let pool = dbtest::open().await?;
    insert_asset_fixture(&pool).await?;
    queries::revalue_asset_holdings_by_snapshot_ids(
        &pool,
        queries::RevalueAssetHoldingsBySnapshotIDsParams {
            price: Some(5.0),
            asset_id: 100,
            snapshot_ids: &[],
        },
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT value_usd_cents FROM asset_daily_holdings WHERE snapshot_id = 100")
            .fetch_one(&pool)
            .await?,
        200
    );
    queries::revalue_asset_holdings_by_snapshot_ids(
        &pool,
        queries::RevalueAssetHoldingsBySnapshotIDsParams {
            price: Some(5.0),
            asset_id: 100,
            snapshot_ids: &[100],
        },
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT value_usd_cents FROM asset_daily_holdings WHERE snapshot_id = 100")
            .fetch_one(&pool)
            .await?,
        1000
    );
    Ok(())
}

#[tokio::test]
async fn filters_analysis_reports_by_asset_slice() -> Result<()> {
    let pool = dbtest::open().await?;
    let first_asset_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO assets (asset_type, identifier, classifier) VALUES ('SECURITY', 'one', 'PUBLIC') RETURNING id",
    )
    .fetch_one(&pool)
    .await?;
    let second_asset_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO assets (asset_type, identifier, classifier) VALUES ('SECURITY', 'two', 'PUBLIC') RETURNING id",
    )
    .fetch_one(&pool)
    .await?;
    sqlx::query("INSERT INTO asset_analysis_reports (asset_id, category, group_name) VALUES (?, 'Stock', 'US Equity'), (?, 'Stock', 'US Equity')")
        .bind(first_asset_id)
        .bind(second_asset_id)
        .execute(&pool)
        .await?;
    assert!(
        queries::asset_analysis_reports_by_asset_ids(
            &pool,
            queries::AssetAnalysisReportsByAssetIDsParams { asset_ids: &[] },
        )
        .await?
        .is_empty()
    );
    assert_eq!(
        queries::asset_analysis_reports_by_asset_ids(
            &pool,
            queries::AssetAnalysisReportsByAssetIDsParams {
                asset_ids: &[first_asset_id],
            },
        )
        .await?
        .len(),
        1
    );
    Ok(())
}

#[tokio::test]
async fn filters_active_real_estate_by_connection_and_open_state() -> Result<()> {
    let pool = dbtest::open().await?;
    let owner_id = sqlx::query_scalar::<_, i64>("INSERT INTO owners (name) VALUES ('owner') RETURNING id")
        .fetch_one(&pool)
        .await?;
    let asset_id = sqlx::query_scalar::<_, i64>("INSERT INTO assets (asset_type, identifier, classifier) VALUES ('REAL_ESTATE', 'home', 'REAL_ESTATE') RETURNING id")
        .fetch_one(&pool)
        .await?;
    let connection_id = sqlx::query_scalar::<_, i64>("INSERT INTO connections (source_table, source_id, owner_id, is_active) VALUES ('assets', ?, ?, 1) RETURNING id")
        .bind(asset_id)
        .bind(owner_id)
        .fetch_one(&pool)
        .await?;
    sqlx::query("INSERT INTO accounts (connection_id, external_id, owner_id, name, type, manual, is_closed) VALUES (?, 'property', ?, 'Home', 'PROPERTY', 0, 0)")
        .bind(connection_id)
        .bind(owner_id)
        .execute(&pool)
        .await?;
    let closed_asset_id = sqlx::query_scalar::<_, i64>("INSERT INTO assets (asset_type, identifier, classifier) VALUES ('REAL_ESTATE', 'other-home', 'REAL_ESTATE') RETURNING id")
        .fetch_one(&pool)
        .await?;
    let closed_connection_id = sqlx::query_scalar::<_, i64>("INSERT INTO connections (source_table, source_id, owner_id, is_active) VALUES ('assets', ?, ?, 1) RETURNING id")
        .bind(closed_asset_id)
        .bind(owner_id)
        .fetch_one(&pool)
        .await?;
    sqlx::query("INSERT INTO accounts (connection_id, external_id, owner_id, name, type, manual, is_closed) VALUES (?, 'closed-property', ?, 'Other home', 'PROPERTY', 0, 1)")
        .bind(closed_connection_id)
        .bind(owner_id)
        .execute(&pool)
        .await?;

    assert_eq!(
        queries::active_real_estate(&pool, queries::ActiveRealEstateParams::default())
            .await?
            .len(),
        2
    );
    assert_eq!(
        queries::active_real_estate(
            &pool,
            queries::ActiveRealEstateParams {
                connection_id: Some(connection_id),
                ..Default::default()
            },
        )
        .await?[0]
            .asset_id,
        asset_id
    );
    assert_eq!(
        queries::active_real_estate(
            &pool,
            queries::ActiveRealEstateParams {
                open_only: true,
                ..Default::default()
            },
        )
        .await?[0]
            .asset_id,
        asset_id
    );
    Ok(())
}
