use anyhow::Result;

use super::{
    active_real_estate, asset_adapter_sources_by_asset_ids, asset_by_id, assets_by_ids, create_real_estate,
    delete_real_estate, get_balance_review_by_id, in_review_balance_reviews, merge_asset_by_source, persist_snapshot,
    real_estate_by_connection_id, replace_account_balance_snapshot, update_real_estate, upsert_asset,
    use_provider_balance_review,
};
use crate::{
    database::dbtest,
    money::Cents,
    schema::{AssetClassifier, AssetType},
    wealth::{
        AccountBalanceSnapshot, AdapterSource, AssetUpsert, BalanceReviewUpsert, CreateRealEstate, RealEstateDetails,
        RealEstateValuation, SnapshotPersist, SnapshotProviderState, SyncerId, UpdateRealEstate,
    },
};

#[tokio::test]
async fn upsert_uses_an_adapter_source_and_keeps_the_newest_price() -> Result<()> {
    let pool = dbtest::open().await?;
    let first = upsert_asset(
        &pool,
        crypto_asset("ETH", "0xasset", Some(100.0), "2026-09-06T12:00:00Z".parse()?),
    )
    .await?;
    let second = upsert_asset(
        &pool,
        crypto_asset("ETH", "0xasset", Some(50.0), "2026-09-05T12:00:00Z".parse()?),
    )
    .await?;

    assert_eq!(second.id, first.id);
    assert_eq!(second.current_price, Some(100.0));
    assert_eq!(asset_by_id(&pool, first.id).await?, Some(second));
    assert!(assets_by_ids(&pool, &[]).await?.is_empty());
    Ok(())
}

#[tokio::test]
async fn merging_an_adapter_source_moves_it_to_the_target_asset() -> Result<()> {
    let pool = dbtest::open().await?;
    let target = upsert_asset(
        &pool,
        crypto_asset("ETH", "0xtarget", None, "2026-09-06T12:00:00Z".parse()?),
    )
    .await?;
    let duplicate = upsert_asset(
        &pool,
        crypto_asset("BTC", "0xduplicate", None, "2026-09-06T12:00:00Z".parse()?),
    )
    .await?;

    let merged = merge_asset_by_source(&pool, SyncerId::Debank, "0xduplicate", target.id)
        .await?
        .expect("target asset must exist");

    assert_eq!(merged.id, target.id);
    assert_eq!(asset_by_id(&pool, duplicate.id).await?, None);
    assert_eq!(
        asset_adapter_sources_by_asset_ids(&pool, &[target.id]).await?[&target.id].len(),
        2
    );
    Ok(())
}

#[tokio::test]
async fn snapshot_writes_replace_a_day_and_skip_closed_accounts() -> Result<()> {
    let pool = dbtest::open().await?;
    let owner = crate::testutil::store::create_owner(&pool, "Test").await?;
    let (_, connection) = crate::testutil::store::seed_plaid_item(&pool, &owner, "item").await?;
    let account_id = crate::testutil::store::seed_plaid_account(&pool, &owner, &connection, "account").await?;

    assert!(replace_account_balance_snapshot(&pool, snapshot(account_id, 100)).await?);
    assert!(replace_account_balance_snapshot(&pool, snapshot(account_id, 200)).await?);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT balance_usd_cents FROM account_balance_daily_snapshots WHERE account_id = ?",
        )
        .bind(account_id)
        .fetch_one(&pool)
        .await?,
        200
    );

    sqlx::query("UPDATE accounts SET is_closed = 1 WHERE id = ?")
        .bind(account_id)
        .execute(&pool)
        .await?;
    assert!(!replace_account_balance_snapshot(&pool, snapshot(account_id, 300)).await?);
    Ok(())
}

#[tokio::test]
async fn provider_review_validates_all_states_before_restoring_any_snapshot() -> Result<()> {
    let pool = dbtest::open().await?;
    let owner = crate::testutil::store::create_owner(&pool, "Test").await?;
    let (_, connection) = crate::testutil::store::seed_plaid_item(&pool, &owner, "item").await?;
    let account_id = crate::testutil::store::seed_plaid_account(&pool, &owner, &connection, "account").await?;
    persist_provider_snapshot(&pool, account_id, "2026-07-01", 100).await?;
    persist_provider_snapshot(&pool, account_id, "2026-07-02", 200).await?;

    sqlx::query(
        "DELETE FROM account_balance_snapshot_provider_states WHERE snapshot_id = (SELECT id FROM account_balance_daily_snapshots WHERE account_id = ? AND date = ?)",
    )
    .bind(account_id)
    .bind("2026-07-02")
    .execute(&pool)
    .await?;
    let review = in_review_balance_reviews(&pool)
        .await?
        .pop()
        .expect("review must exist");

    assert_eq!(
        get_balance_review_by_id(&pool, review.id)
            .await?
            .map(|review| review.id),
        Some(review.id)
    );
    assert_eq!(
        use_provider_balance_review(&pool, review.id)
            .await
            .unwrap_err()
            .to_string(),
        format!("balance review {} is missing provider state", review.id)
    );
    assert_eq!(
        sqlx::query_as::<_, (bool, i64)>(
            "SELECT flagged, balance_usd_cents FROM account_balance_daily_snapshots WHERE account_id = ? AND date = ?",
        )
        .bind(account_id)
        .bind("2026-07-01")
        .fetch_one(&pool)
        .await?,
        (true, 50)
    );
    Ok(())
}

#[tokio::test]
async fn real_estate_lifecycle_preserves_linked_records_and_valuations() -> Result<()> {
    let pool = dbtest::open().await?;
    let owner = crate::testutil::store::create_owner(&pool, "Home owner").await?;
    let created = create_real_estate(
        &pool,
        CreateRealEstate {
            owner_id: owner.id,
            label: String::new(),
            details: real_estate_details(Some("1 Main St"), None),
            initial_valuation: Some(valuation("2026-07-01", 100_000)),
        },
    )
    .await?;

    assert_eq!(created.0.source_table, crate::accounts::SourceTable::Assets);
    assert_eq!(created.1.r#type, crate::accounts::AccountType::Property);
    let real_estate = real_estate_by_connection_id(&pool, created.0.connection.id)
        .await?
        .expect("home must exist");
    assert_eq!(real_estate.details.street.as_deref(), Some("1 Main St"));
    assert_eq!(active_real_estate(&pool).await?.len(), 1);

    update_real_estate(
        &pool,
        UpdateRealEstate {
            connection_id: created.0.connection.id,
            name: Some("Renamed home".to_owned()),
            details: real_estate_details(None, Some("Austin")),
            valuation: Some(valuation("2026-07-02", 125_000)),
        },
    )
    .await?;
    let updated = real_estate_by_connection_id(&pool, created.0.connection.id)
        .await?
        .expect("home must exist");
    assert_eq!(updated.name, "Renamed home");
    assert_eq!(updated.details.street.as_deref(), Some("1 Main St"));
    assert_eq!(updated.details.city.as_deref(), Some("Austin"));
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT balance_usd_cents FROM account_balance_daily_snapshots WHERE account_id = ? AND date = ?",
        )
        .bind(updated.account_id)
        .bind("2026-07-02")
        .fetch_one(&pool)
        .await?,
        125_000
    );

    delete_real_estate(&pool, created.0.connection.id).await?;
    assert!(active_real_estate(&pool).await?.is_empty());
    assert_eq!(
        delete_real_estate(&pool, created.0.connection.id)
            .await
            .unwrap_err()
            .to_string(),
        format!("real estate for connection {} not found", created.0.connection.id)
    );
    Ok(())
}

fn snapshot(account_id: i64, balance_usd_cents: i64) -> AccountBalanceSnapshot {
    AccountBalanceSnapshot {
        account_id,
        wallet_address: String::new(),
        source: "plaid".to_owned(),
        date: "2026-09-06".to_owned(),
        synced_at: "2026-09-06T12:00:00Z".to_owned(),
        balance_usd: crate::money::Cents(balance_usd_cents),
        raw_payload: None,
        holdings: Vec::new(),
        flagged: false,
        flag_reason: String::new(),
    }
}

async fn persist_provider_snapshot(
    pool: &sqlx::SqlitePool,
    account_id: i64,
    date: &str,
    provider_balance: i64,
) -> Result<()> {
    persist_snapshot(
        pool,
        SnapshotPersist {
            snapshot: AccountBalanceSnapshot {
                account_id,
                wallet_address: String::new(),
                source: "plaid".to_owned(),
                date: date.to_owned(),
                synced_at: format!("{date}T12:00:00Z"),
                balance_usd: Cents(50),
                raw_payload: None,
                holdings: Vec::new(),
                flagged: true,
                flag_reason: "spike".to_owned(),
            },
            synced_at: format!("{date}T12:00:00Z").parse()?,
            expire_review: false,
            recovery: None,
            review: Some(BalanceReviewUpsert {
                account_id,
                first_flagged_date: date.to_owned(),
                latest_flagged_date: date.to_owned(),
                flagged_snapshot_count: 1,
                provider_balance_usd: Cents(provider_balance),
                carry_forward_balance_usd: Cents(50),
                flag_reason: "spike".to_owned(),
            }),
            provider_state: Some(SnapshotProviderState {
                provider_balance_usd: Cents(provider_balance),
                provider_holdings_json: "[]".to_owned(),
            }),
        },
    )
    .await
}

fn real_estate_details(street: Option<&str>, city: Option<&str>) -> RealEstateDetails {
    RealEstateDetails {
        street: street.map(ToOwned::to_owned),
        city: city.map(ToOwned::to_owned),
        state: None,
        zip: None,
        home_type: None,
    }
}

fn valuation(date: &str, value_usd: i64) -> RealEstateValuation {
    RealEstateValuation {
        value_usd: Cents(value_usd),
        date: date.to_owned(),
        synced_at: format!("{date}T12:00:00Z").parse().unwrap(),
        source: SyncerId::Realestate,
    }
}

fn crypto_asset(
    identifier: &str,
    source_id: &str,
    last_price: Option<f64>,
    last_price_at: chrono::DateTime<chrono::Utc>,
) -> AssetUpsert {
    AssetUpsert {
        asset_type: AssetType::Crypto,
        identifier: identifier.to_owned(),
        name: Some("Ethereum".to_owned()),
        classifier: AssetClassifier::Cryptocurrency,
        user_edited: false,
        user_created: false,
        forced_usd_price: None,
        tracking_ticker: None,
        tracking_multiplier: 1.0,
        last_price,
        last_price_at: Some(last_price_at),
        adapter_source: Some(AdapterSource {
            adapter: SyncerId::Debank,
            source_id: source_id.to_owned(),
        }),
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
