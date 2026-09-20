use std::time::Duration;

use anyhow::Result;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

use super::{
    HoldingsFilter, ReportSyncer, analyze,
    store::{assets, holdings, reports},
    types::AssetReport,
};
use crate::{
    accounts::{AccountType, UpsertAccount, store as accounts_store},
    clients::yfinance::{FundReport, YFinance},
    database::dbtest,
    money::Cents,
    schema::{AnalysisView, AssetClassifier, AssetType, ConnectivityStatus},
    testutil::store as test_store,
    wealth::{AccountBalanceSnapshot, AssetDailyHolding, AssetUpsert, store as wealth_store},
};

#[tokio::test]
async fn stores_reports_and_current_public_holdings() -> Result<()> {
    let pool = dbtest::open().await?;
    let (owner, account_id) = investment_account(&pool).await?;
    let vti = public_asset(&pool, "VTI").await?;
    let missing = public_asset(&pool, "MISSING").await?;
    let zero = public_asset(&pool, "ZERO").await?;
    wealth_store::replace_account_balance_snapshot(
        &pool,
        snapshot(
            account_id,
            vec![
                holding(vti.id, 100.0),
                holding(missing.id, 50.0),
                holding(zero.id, 25.0),
            ],
        ),
    )
    .await?;
    let stale = "2026-05-01T00:00:00Z".parse()?;
    let mut vti_report = AssetReport::from((
        vti.id,
        stale,
        FundReport {
            category: "Large Blend".to_owned(),
            group: "US Equity".to_owned(),
            stock_position: 1.0,
            sector_technology: 0.25,
            ..Default::default()
        },
    ));
    reports::upsert_report(&pool, &vti_report).await?;
    reports::upsert_report(
        &pool,
        &AssetReport::from((
            zero.id,
            stale,
            FundReport {
                category: "Stable Value".to_owned(),
                group: "Other".to_owned(),
                ..Default::default()
            },
        )),
    )
    .await?;

    let needing = assets::public_assets_needing_report(&pool, "2026-06-01T00:00:00Z".parse()?).await?;
    assert_eq!(
        needing
            .iter()
            .map(|asset| asset.identifier.as_str())
            .collect::<Vec<_>>(),
        ["MISSING", "VTI", "ZERO"]
    );
    vti_report.fetched_at = "2026-07-01T00:00:00Z".parse::<chrono::DateTime<chrono::Utc>>()?.into();
    reports::upsert_report(&pool, &vti_report).await?;
    wealth_store::update_asset_investment_connectivity(&pool, missing.id, ConnectivityStatus::NotFound).await?;
    wealth_store::update_asset_investment_connectivity(&pool, zero.id, ConnectivityStatus::Ignore).await?;
    assert!(
        assets::public_assets_needing_report(&pool, "2026-06-01T00:00:00Z".parse()?)
            .await?
            .is_empty()
    );
    assert_eq!(
        reports::reports_by_asset_ids(&pool, &[vti.id]).await?[&vti.id].sector_technology,
        0.25
    );

    let filtered = holdings::current_public_holdings(
        &pool,
        &HoldingsFilter {
            owner_ids: vec![owner.id],
            account_subtypes: vec!["401k".to_owned()],
            account_ids: vec![account_id],
            include_unclassified: false,
        },
    )
    .await?;
    assert_eq!(
        filtered
            .iter()
            .map(|holding| (holding.asset.id, holding.value_usd))
            .collect::<Vec<_>>(),
        [(vti.id, Cents(10_000)), (zero.id, Cents(2_500))]
    );
    let report = analyze(
        &pool,
        AnalysisView::Sectors,
        HoldingsFilter {
            account_ids: vec![account_id],
            include_unclassified: false,
            ..Default::default()
        },
    )
    .await?;
    assert!(report.slices.iter().all(|slice| slice.label != "Unclassified"));
    assert!(report.slices.iter().any(|slice| slice.label == "Unassigned"));
    assert_eq!(
        holdings::current_public_holdings(
            &pool,
            &HoldingsFilter {
                account_ids: vec![account_id],
                include_unclassified: true,
                ..Default::default()
            },
        )
        .await?
        .len(),
        3
    );
    assert!(
        holdings::current_public_holdings(
            &pool,
            &HoldingsFilter {
                owner_ids: vec![999],
                ..Default::default()
            },
        )
        .await?
        .is_empty()
    );
    let empty = analyze(
        &pool,
        AnalysisView::MorningstarGroup,
        HoldingsFilter {
            owner_ids: vec![999],
            ..Default::default()
        },
    )
    .await?;
    assert_eq!(empty.total_value_usd, Cents(0));
    assert!(empty.slices.is_empty());
    Ok(())
}

#[tokio::test]
async fn syncs_a_wealth_asset_report_with_yahoo() -> Result<()> {
    let server = MockServer::start().await;
    mount_auth(&server).await;
    Mock::given(method("GET"))
        .and(path("/quoteSummary/VTI"))
        .respond_with(ResponseTemplate::new(200).set_body_string(
            r#"{"quoteSummary":{"result":[{"fundProfile":{"categoryName":"Large Blend"},"topHoldings":{"stockPosition":1}}],"error":null}}"#,
        ))
        .mount(&server)
        .await;
    let pool = dbtest::open().await?;
    let _ = investment_account(&pool).await?;
    let asset = public_asset(&pool, "VTI").await?;

    ReportSyncer::new(
        pool.clone(),
        YFinance::with_urls(
            format!("{}/cookie", server.uri()),
            format!("{}/crumb", server.uri()),
            format!("{}/quoteSummary", server.uri()),
        )?,
    )
    .with_pause(Duration::ZERO)
    .sync_all("2026-06-01T12:00:00Z".parse()?)
    .await?;

    assert_eq!(
        reports::reports_by_asset_ids(&pool, &[asset.id]).await?[&asset.id].category,
        "Large Blend"
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT investment_connectivity FROM assets WHERE id = ?")
            .bind(asset.id)
            .fetch_one(&pool)
            .await?,
        "HEALTHY"
    );
    Ok(())
}

async fn investment_account(pool: &sqlx::SqlitePool) -> Result<(crate::accounts::Owner, i64)> {
    let owner = test_store::create_owner(pool, "Alex").await?;
    let (_, connection) = test_store::seed_plaid_item(pool, &owner, "item").await?;
    let account_id = accounts_store::upsert_account(
        pool,
        &UpsertAccount {
            external_id: "invest".to_owned(),
            connection_id: Some(connection.id),
            owner_id: owner.id,
            name: "401k".to_owned(),
            account_type: AccountType::Investment,
            subtype: Some("401k".to_owned()),
            mask: None,
            notes: None,
            closed: false,
            hidden: false,
            needs_review: false,
        },
    )
    .await?;
    Ok((owner, account_id))
}

async fn public_asset(pool: &sqlx::SqlitePool, identifier: &str) -> Result<crate::wealth::Asset> {
    wealth_store::upsert_asset(
        pool,
        AssetUpsert {
            asset_type: AssetType::Security,
            identifier: identifier.to_owned(),
            name: None,
            classifier: AssetClassifier::Public,
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
        },
    )
    .await
}

fn snapshot(account_id: i64, holdings: Vec<AssetDailyHolding>) -> AccountBalanceSnapshot {
    AccountBalanceSnapshot {
        account_id,
        wallet_address: String::new(),
        source: "test".to_owned(),
        date: "2026-06-01".to_owned(),
        synced_at: "2026-06-01T12:00:00Z".to_owned(),
        balance_usd: Cents(17_500),
        raw_payload: None,
        holdings,
        flagged: false,
        flag_reason: String::new(),
    }
}

fn holding(asset_id: i64, value_usd: f64) -> AssetDailyHolding {
    AssetDailyHolding {
        asset_id,
        asset: None,
        adapter_source: None,
        adapter_sources: Vec::new(),
        price_update: None,
        quantity: Some(2.0),
        price: Some(value_usd / 2.0),
        value_usd,
        counts_toward_value: true,
        manual: false,
        line_type: String::new(),
        chain_id: String::new(),
        project_name: None,
        token_id: String::new(),
        identifier: String::new(),
        token_symbol: None,
        token_name: None,
        provider_price: None,
    }
}

async fn mount_auth(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path("/cookie"))
        .respond_with(ResponseTemplate::new(200).insert_header("set-cookie", "A3=session; Max-Age=3600"))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path("/crumb"))
        .respond_with(ResponseTemplate::new(200).set_body_string("crumb"))
        .mount(server)
        .await;
}
