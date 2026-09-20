use anyhow::Result;

use crate::database::{dbtest, queries};

use super::time;

async fn insert_fixture(pool: &sqlx::SqlitePool) -> Result<()> {
    sqlx::query("INSERT INTO owners (id, name) VALUES (100, 'Owner'), (101, 'Other')")
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO accounts (id, external_id, owner_id, name, type, subtype, manual) VALUES (100, 'checking', 100, 'Checking', 'CHECKING', 'CHECKING', 1), (101, 'credit', 101, 'Credit', 'CREDIT', NULL, 0)")
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO assets (id, asset_type, identifier, classifier) VALUES (100, 'SECURITY', 'stock', 'Stocks'), (101, 'CRYPTO', 'coin', 'Crypto')")
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO account_balance_daily_snapshots (id, account_id, source, date, synced_at, balance_usd_cents, flagged) VALUES (100, 100, 'test', '2026-01-01', '2026-01-01T00:00:00Z', 100, 0), (101, 100, 'test', '2026-01-02', '2026-01-02T00:00:00Z', 200, 0), (102, 101, 'test', '2026-01-02', '2026-01-02T00:00:00Z', 300, 0)")
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO asset_daily_holdings (snapshot_id, account_id, date, asset_id, quantity, price, value_usd_cents, counts_toward_value, manual) VALUES (100, 100, '2026-01-01', 100, 1, 1, 100, 1, 0), (101, 100, '2026-01-02', 101, 2, 1, 200, 1, 0), (102, 101, '2026-01-02', 100, 3, 1, 300, 1, 0)")
        .execute(pool)
        .await?;
    Ok(())
}

#[tokio::test]
async fn timestamp_range_omits_or_applies_slices() -> Result<()> {
    let pool = dbtest::open().await?;
    insert_fixture(&pool).await?;
    sqlx::query("INSERT INTO account_balance_daily_snapshots (id, account_id, source, date, synced_at, balance_usd_cents, flagged) VALUES (103, 101, 'test', '2026-01-03', '2026-01-03T00:00:00Z', 400, 0)")
        .execute(&pool)
        .await?;
    let all = queries::account_balance_snapshot_timestamp_range(
        &pool,
        queries::AccountBalanceSnapshotTimestampRangeParams::default(),
    )
    .await?;
    assert_eq!(all.earliest_synced_at, "2026-01-01T00:00:00Z");
    assert_eq!(all.latest_synced_at, "2026-01-03T00:00:00Z");
    let owner_ids = [100];
    let account_ids = [100];
    let filtered = queries::account_balance_snapshot_timestamp_range(
        &pool,
        queries::AccountBalanceSnapshotTimestampRangeParams {
            owner_ids: Some(&owner_ids),
            account_ids: Some(&account_ids),
        },
    )
    .await?;
    assert_eq!(filtered.earliest_synced_at, "2026-01-01T00:00:00Z");
    assert_eq!(filtered.latest_synced_at, "2026-01-02T00:00:00Z");
    Ok(())
}

#[tokio::test]
async fn snapshot_values_omits_or_applies_slices() -> Result<()> {
    let pool = dbtest::open().await?;
    insert_fixture(&pool).await?;
    let start_time = time("2025-01-01T00:00:00Z")?;
    let end_time = time("2027-01-01T00:00:00Z")?;
    let all = queries::account_balance_snapshot_values(
        &pool,
        queries::AccountBalanceSnapshotValuesParams {
            start_time,
            end_time,
            ..Default::default()
        },
    )
    .await?;
    assert_eq!(all.len(), 3);
    let owner_ids = [100];
    let account_ids = [100];
    let rows = queries::account_balance_snapshot_values(
        &pool,
        queries::AccountBalanceSnapshotValuesParams {
            owner_ids: Some(&owner_ids),
            account_ids: Some(&account_ids),
            start_time,
            end_time,
        },
    )
    .await?;
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|row| row.account_id == 100));
    Ok(())
}

#[tokio::test]
async fn snapshots_page_omits_or_applies_cursor() -> Result<()> {
    let pool = dbtest::open().await?;
    insert_fixture(&pool).await?;
    assert_eq!(
        queries::account_balance_snapshots_page(
            &pool,
            queries::AccountBalanceSnapshotsPageParams {
                account_id: 100,
                row_limit: 10,
                ..Default::default()
            },
        )
        .await?
        .len(),
        2
    );
    let rows = queries::account_balance_snapshots_page(
        &pool,
        queries::AccountBalanceSnapshotsPageParams {
            after_date: Some("2026-01-02"),
            account_id: 100,
            row_limit: 10,
        },
    )
    .await?;
    assert_eq!(rows[0].date, "2026-01-01");
    Ok(())
}

#[tokio::test]
async fn classifier_values_omits_or_applies_slices() -> Result<()> {
    let pool = dbtest::open().await?;
    insert_fixture(&pool).await?;
    let start_time = time("2025-01-01T00:00:00Z")?;
    let end_time = time("2027-01-01T00:00:00Z")?;
    assert_eq!(
        queries::classifier_snapshot_values(
            &pool,
            queries::ClassifierSnapshotValuesParams {
                start_time,
                end_time,
                ..Default::default()
            },
        )
        .await?
        .len(),
        3
    );
    let owner_ids = [100];
    let account_ids = [100];
    let rows = queries::classifier_snapshot_values(
        &pool,
        queries::ClassifierSnapshotValuesParams {
            owner_ids: Some(&owner_ids),
            account_ids: Some(&account_ids),
            start_time,
            end_time,
        },
    )
    .await?;
    assert!(rows.iter().all(|row| row.account_id == 100));
    Ok(())
}

#[tokio::test]
async fn latest_snapshot_window_omits_or_applies_window() -> Result<()> {
    let pool = dbtest::open().await?;
    insert_fixture(&pool).await?;
    assert_eq!(
        queries::latest_account_balance_snapshot_in_window(
            &pool,
            queries::LatestAccountBalanceSnapshotInWindowParams {
                account_id: 100,
                ..Default::default()
            },
        )
        .await?
        .id,
        101
    );
    assert_eq!(
        queries::latest_account_balance_snapshot_in_window(
            &pool,
            queries::LatestAccountBalanceSnapshotInWindowParams {
                start_time: Some(time("2026-01-01T00:00:00Z")?),
                end_time: Some(time("2026-01-02T00:00:00Z")?),
                account_id: 100,
            },
        )
        .await?
        .id,
        100
    );
    Ok(())
}

#[tokio::test]
async fn latest_snapshots_for_accounts_handles_empty_and_populated_slices() -> Result<()> {
    let pool = dbtest::open().await?;
    insert_fixture(&pool).await?;
    assert!(
        queries::latest_account_balance_snapshots_for_accounts(
            &pool,
            queries::LatestAccountBalanceSnapshotsForAccountsParams { account_ids: &[] },
        )
        .await?
        .is_empty()
    );
    let rows = queries::latest_account_balance_snapshots_for_accounts(
        &pool,
        queries::LatestAccountBalanceSnapshotsForAccountsParams { account_ids: &[100] },
    )
    .await?;
    assert_eq!(rows[0].id, 101);
    Ok(())
}

#[tokio::test]
async fn current_holdings_omits_or_applies_filters() -> Result<()> {
    let pool = dbtest::open().await?;
    insert_fixture(&pool).await?;
    assert_eq!(
        queries::list_current_account_holdings(&pool, queries::ListCurrentAccountHoldingsParams::default())
            .await?
            .len(),
        2
    );
    let owner_ids = [100];
    let account_ids = [100];
    let asset_ids = [101];
    let rows = queries::list_current_account_holdings(
        &pool,
        queries::ListCurrentAccountHoldingsParams {
            owner_ids: Some(&owner_ids),
            account_ids: Some(&account_ids),
            classifier: Some("Crypto"),
            asset_ids: Some(&asset_ids),
            ..Default::default()
        },
    )
    .await?;
    assert_eq!(rows[0].assets.id, 101);
    Ok(())
}

#[tokio::test]
async fn liability_balances_omits_or_applies_slices() -> Result<()> {
    let pool = dbtest::open().await?;
    insert_fixture(&pool).await?;
    sqlx::query("INSERT INTO accounts (id, external_id, owner_id, name, type, manual) VALUES (102, 'other-credit', 100, 'Other credit', 'CREDIT', 0)")
        .execute(&pool)
        .await?;
    sqlx::query("INSERT INTO account_balance_daily_snapshots (id, account_id, source, date, synced_at, balance_usd_cents, flagged) VALUES (103, 102, 'test', '2026-01-03', '2026-01-03T00:00:00Z', 400, 0)")
        .execute(&pool)
        .await?;
    assert_eq!(
        queries::list_latest_liability_account_balances(
            &pool,
            queries::ListLatestLiabilityAccountBalancesParams::default(),
        )
        .await?
        .len(),
        2
    );
    let rows = queries::list_latest_liability_account_balances(
        &pool,
        queries::ListLatestLiabilityAccountBalancesParams {
            owner_ids: Some(&[101]),
            account_ids: Some(&[101]),
            ..Default::default()
        },
    )
    .await?;
    assert_eq!(rows[0].accounts.id, 101);
    Ok(())
}

#[tokio::test]
async fn snapshot_holdings_handles_empty_and_populated_slices() -> Result<()> {
    let pool = dbtest::open().await?;
    insert_fixture(&pool).await?;
    assert!(
        queries::snapshot_holdings_by_snapshot_ids(
            &pool,
            queries::SnapshotHoldingsBySnapshotIDsParams { snapshot_ids: &[] },
        )
        .await?
        .is_empty()
    );
    let rows = queries::snapshot_holdings_by_snapshot_ids(
        &pool,
        queries::SnapshotHoldingsBySnapshotIDsParams { snapshot_ids: &[101] },
    )
    .await?;
    assert_eq!(rows[0].assets.id, 101);
    Ok(())
}
