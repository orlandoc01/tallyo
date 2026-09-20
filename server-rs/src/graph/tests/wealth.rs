use anyhow::Result;
use serde_json::{Value, json};

use super::{all_scopes, by_name, code, global_id, path, seed, seed_snapshot};
use crate::{
    auth::Scope,
    ids::GlobalIdType,
    money::Cents,
    testutil::store::{create_owner, seed_manual_account},
    wealth::{AccountBalanceSnapshot, AssetDailyHolding, store as wealth_store},
};

#[tokio::test]
async fn net_worth_executes_with_nested_holdings() -> Result<()> {
    let fixture = seed().await?;
    let (data, errors) = fixture
        .execute(
            r#"{ netWorth(input: {}) {
                currentNetWorthUSD currentAssetsUSD currentLiabilitiesUSD
                classifierBreakdown { classifier label valueUSD percentOfAssets assetCount
                    holdings { totalQuantity valueUSD percentOfClassifier asset { id assetType identifier classifier }
                        holdings { assetId accountId quantity valueUSD manual account { id name type latestSnapshot { balanceUSD } lastSyncedAt owner { id name } } } } }
            } }"#,
            all_scopes(),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    let net_worth = &data["netWorth"];
    assert_eq!(net_worth["currentNetWorthUSD"], 50_120);
    assert_eq!(net_worth["currentLiabilitiesUSD"], 0);
    let public = net_worth["classifierBreakdown"]
        .as_array()
        .unwrap()
        .iter()
        .find(|breakdown| breakdown["classifier"] == "PUBLIC")
        .unwrap();
    assert_eq!(public["label"], "Public Assets");
    let rollup = &public["holdings"][0];
    assert_eq!(rollup["asset"]["identifier"], "VTI");
    assert_eq!(rollup["holdings"][0]["account"]["name"], "Checking");
    assert_eq!(rollup["holdings"][0]["account"]["owner"]["name"], "Alex");
    assert_eq!(rollup["holdings"][0]["valueUSD"], 120);
    Ok(())
}

#[tokio::test]
async fn holdings_under_net_worth_require_their_own_scopes() -> Result<()> {
    let fixture = seed().await?;
    let query = r#"{ netWorth(input: {}) { currentNetWorthUSD classifierBreakdown { valueUSD holdings { valueUSD holdings { valueUSD account { id } } asset { latestSnapshot { asOfDate totalHeldValueUSD holdings { valueUSD } } } } } } }"#;

    let (data, errors) = fixture.execute(query, vec![Scope::ReadWealth]).await?;
    assert_eq!(data["netWorth"]["currentNetWorthUSD"], 50_120);
    let rollup = &data["netWorth"]["classifierBreakdown"][0]["holdings"][0];
    assert!(rollup["valueUSD"].is_number());
    assert_eq!(rollup["holdings"], Value::Null);
    assert_eq!(rollup["asset"]["latestSnapshot"], Value::Null);
    assert!(
        errors
            .iter()
            .any(|error| error.message == "forbidden: read:holdings access required")
    );
    assert!(
        errors
            .iter()
            .any(|error| error.message == "forbidden: read:assets access required")
    );

    let (data, errors) = fixture
        .execute(query, vec![Scope::ReadWealth, Scope::ReadAssets])
        .await?;
    let snapshot = &data["netWorth"]["classifierBreakdown"][0]["holdings"][0]["asset"]["latestSnapshot"];
    assert!(snapshot["totalHeldValueUSD"].is_number());
    assert_eq!(snapshot["holdings"], Value::Null);
    assert!(
        errors
            .iter()
            .all(|error| error.message == "forbidden: read:holdings access required")
    );

    let (data, errors) = fixture
        .execute(query, vec![Scope::ReadWealth, Scope::ReadAssets, Scope::ReadHoldings])
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    let rollups = data["netWorth"]["classifierBreakdown"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|breakdown| breakdown["holdings"].as_array().unwrap().clone())
        .collect::<Vec<_>>();
    assert!(
        rollups
            .iter()
            .all(|rollup| rollup["holdings"].as_array().unwrap().len() == 1)
    );
    assert!(
        rollups
            .iter()
            .all(|rollup| rollup["asset"]["latestSnapshot"]["holdings"].is_array())
    );
    Ok(())
}

#[tokio::test]
async fn account_query_and_snapshot_fields() -> Result<()> {
    let fixture = seed().await?;
    let account = global_id(GlobalIdType::Account, fixture.plaid_account_id);
    let (data, errors) = fixture
        .execute_with(
            "query($id: ID!) { account(id: $id) { name latestSnapshot { balanceUSD holdings { valueUSD } } } }",
            vec![Scope::ReadAccounts, Scope::ReadWealth],
            json!({"id": account}),
        )
        .await?;
    assert_eq!(data["account"]["name"], "Checking");
    assert_eq!(data["account"]["latestSnapshot"]["balanceUSD"], 120);
    assert_eq!(data["account"]["latestSnapshot"]["holdings"], Value::Null);
    assert!(
        errors
            .iter()
            .any(|error| error.message == "forbidden: read:holdings access required")
    );

    let (data, errors) = fixture
        .execute_with(
            "query($id: ID!) { account(id: $id) { latestSnapshot { holdings { valueUSD } } } }",
            all_scopes(),
            json!({"id": account}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        data["account"]["latestSnapshot"]["holdings"],
        json!([{"valueUSD": 120}])
    );

    let (data, errors) = fixture
        .execute_with(
            "query($id: ID!) { account(id: $id) { name } }",
            all_scopes(),
            json!({"id": global_id(GlobalIdType::Account, 999_999)}),
        )
        .await?;
    assert_eq!(data, Value::Null);
    assert!(errors[0].message.ends_with("not found"), "{}", errors[0].message);
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");
    Ok(())
}

#[tokio::test]
async fn net_worth_as_of_a_past_date_reports_that_day() -> Result<()> {
    let fixture = seed().await?;
    seed_snapshot(
        &fixture.pool,
        fixture.plaid_account_id,
        fixture.stock_asset_id,
        "2026-03-01",
        300.0,
    )
    .await?;
    sqlx::query(
        "INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES (900, 'card', ?1, 'Card', 'CREDIT')",
    )
    .bind(fixture.owner.id)
    .execute(&fixture.pool)
    .await?;
    sqlx::query("INSERT INTO account_balance_daily_snapshots (account_id, source, date, synced_at, balance_usd_cents, flagged) VALUES (900, 'test', '2026-01-01', '2026-01-01T12:00:00Z', 5000, 0), (900, 'test', '2026-02-01', '2026-02-01T12:00:00Z', 8000, 0)")
        .execute(&fixture.pool)
        .await?;
    let query = |input: &str| {
        format!(
            r#"{{ netWorth(input: {{{input}}}) {{ asOfDate currentLiabilitiesUSD
                classifierBreakdown {{ classifier valueUSD }}
                liabilityBreakdown {{ valueUSD balances {{ balanceUSD account {{ name latestSnapshot {{ balanceUSD }} }} }} }}
            }} }}"#
        )
    };

    let (data, errors) = fixture
        .execute(&query(r#"asOfDate: "2026-01-15""#), all_scopes())
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    let report = &data["netWorth"];
    assert_eq!(report["asOfDate"], "2026-01-15");
    assert_eq!(report["currentLiabilitiesUSD"], 50);
    let card = &report["liabilityBreakdown"][0];
    assert_eq!(card["valueUSD"], 50);
    assert_eq!(card["balances"][0]["balanceUSD"], 50);
    assert_eq!(card["balances"][0]["account"]["name"], "Card");
    // The Account entity itself stays live so cached accounts are never rewritten with historical values.
    assert_eq!(card["balances"][0]["account"]["latestSnapshot"]["balanceUSD"], 80);
    let public = report["classifierBreakdown"]
        .as_array()
        .unwrap()
        .iter()
        .find(|breakdown| breakdown["classifier"] == "PUBLIC")
        .unwrap();
    assert_eq!(public["valueUSD"], 120, "the January snapshot, not March");

    let (data, errors) = fixture.execute(&query(""), all_scopes()).await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["netWorth"]["currentLiabilitiesUSD"], 80);
    assert_eq!(
        data["netWorth"]["liabilityBreakdown"][0]["balances"][0]["balanceUSD"],
        80
    );
    Ok(())
}

#[tokio::test]
async fn accounts_latest_snapshot_is_per_account() -> Result<()> {
    let fixture = seed().await?;
    let owner = create_owner(&fixture.pool, "Sam").await?;
    let first = seed_manual_account(&fixture.pool, &owner, "Cash One").await?;
    let second = seed_manual_account(&fixture.pool, &owner, "Cash Two").await?;
    seed_snapshot(&fixture.pool, first.id, fixture.stock_asset_id, "2026-06-01", 111.0).await?;
    seed_snapshot(&fixture.pool, second.id, fixture.stock_asset_id, "2026-06-02", 222.0).await?;

    let (data, errors) = fixture
        .execute(
            "{ accounts { items { name latestSnapshot { balanceUSD date } } } }",
            vec![Scope::ReadAccounts, Scope::ReadWealth],
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    let one = by_name(&data["accounts"]["items"], "Cash One");
    assert_eq!(one["latestSnapshot"], json!({"balanceUSD": 111, "date": "2026-06-01"}));
    let two = by_name(&data["accounts"]["items"], "Cash Two");
    assert_eq!(two["latestSnapshot"], json!({"balanceUSD": 222, "date": "2026-06-02"}));
    Ok(())
}

#[tokio::test]
async fn unknown_quantities_stay_null() -> Result<()> {
    let fixture = seed().await?;
    let owner = create_owner(&fixture.pool, "Sam").await?;
    let wallet = seed_manual_account(&fixture.pool, &owner, "Stables").await?;
    let asset_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO assets (asset_type, identifier, classifier) VALUES ('CRYPTO', 'base:moo-aero', 'STABLECOIN') RETURNING id",
    )
    .fetch_one(&fixture.pool)
    .await?;
    let date = (chrono::Utc::now() - chrono::Duration::days(7))
        .format("%F")
        .to_string();
    wealth_store::replace_account_balance_snapshot(
        &fixture.pool,
        AccountBalanceSnapshot {
            account_id: wallet.id,
            wallet_address: String::new(),
            source: "debank".to_owned(),
            date: date.clone(),
            synced_at: format!("{date}T12:00:00Z"),
            balance_usd: Cents::from_dollars(76_714.93),
            raw_payload: None,
            holdings: vec![AssetDailyHolding {
                asset_id,
                asset: None,
                adapter_source: None,
                adapter_sources: Vec::new(),
                price_update: None,
                quantity: None,
                price: None,
                value_usd: 76_714.93,
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
            }],
            flagged: false,
            flag_reason: String::new(),
        },
    )
    .await?;

    let (data, errors) = fixture
        .execute_with(
            "query($id: ID!) { account(id: $id) { latestSnapshot { holdings { quantity } } } netWorth(input: {}) { classifierBreakdown { classifier holdings { totalQuantity } } } historicalNetWorth(input: { range: ONE_MONTH }) { classifierSeries { classifier } } }",
            all_scopes(),
            json!({"id": global_id(GlobalIdType::Account, wallet.id)}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        data["account"]["latestSnapshot"]["holdings"],
        json!([{"quantity": Value::Null}])
    );
    let stablecoin = data["netWorth"]["classifierBreakdown"]
        .as_array()
        .unwrap()
        .iter()
        .find(|breakdown| breakdown["classifier"] == "STABLECOIN")
        .unwrap();
    assert_eq!(stablecoin["holdings"], json!([{"totalQuantity": Value::Null}]));
    assert!(
        !data["historicalNetWorth"]["classifierSeries"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    Ok(())
}

#[tokio::test]
async fn account_snapshots_reject_invalid_page_args_and_page() -> Result<()> {
    let fixture = seed().await?;
    let account = global_id(GlobalIdType::Account, fixture.plaid_account_id);
    let cursor = |json: &str| base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, json);
    for (name, input) in [
        (
            "non-positive first",
            format!("{{accountId: {:?}, first: 0}}", account.as_str()),
        ),
        (
            "first above max",
            format!("{{accountId: {:?}, first: 1000}}", account.as_str()),
        ),
        (
            "malformed base64 cursor",
            format!("{{accountId: {:?}, after: \"not-valid-base64!!\"}}", account.as_str()),
        ),
        (
            "invalid date cursor",
            format!(
                "{{accountId: {:?}, after: {:?}}}",
                account.as_str(),
                cursor(r#"{"date":"not-a-date"}"#)
            ),
        ),
    ] {
        let (_, errors) = fixture
            .execute(
                &format!("{{ accountSnapshots(input: {input}) {{ totalCount }} }}"),
                all_scopes(),
            )
            .await?;
        assert_eq!(errors.len(), 1, "{name}: {errors:?}");
        assert_eq!(code(&errors[0]), "BAD_USER_INPUT", "{name}: {errors:?}");
    }

    let (data, errors) = fixture
        .execute_with(
            "query($id: ID!) { accountSnapshots(input: { accountId: $id, first: 10 }) { totalCount edges { node { date balanceUSD } } } accountSnapshot(input: { accountId: $id }) { date } balanceSnapshotReviews { items { id } } }",
            all_scopes(),
            json!({"id": account}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["accountSnapshots"]["totalCount"], 1);
    assert_eq!(data["accountSnapshots"]["edges"][0]["node"]["date"], "2026-01-02");
    assert_eq!(data["accountSnapshot"]["date"], "2026-01-02");
    assert_eq!(data["balanceSnapshotReviews"]["items"], json!([]));
    Ok(())
}

#[tokio::test]
async fn create_and_update_asset_execute() -> Result<()> {
    let fixture = seed().await?;
    let (data, errors) = fixture
        .execute(
            r#"mutation { createAsset(input: { assetType: SECURITY, identifier: "TrustII_VFFVX", name: "SPDR S&P 500 ETF", classifier: PUBLIC, forcedUsdPrice: 500.25, trackingTicker: "VFFVX", trackingMultiplier: 1.5155, security: { cusip: "78462F103", isin: "US78462F1030" } }) {
                asset { id assetType identifier name classifier forcedUsdPrice trackingTicker trackingMultiplier }
            } }"#,
            all_scopes(),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    let asset = &data["createAsset"]["asset"];
    assert_eq!(asset["assetType"], "SECURITY");
    assert_eq!(asset["identifier"], "TrustII_VFFVX");
    assert_eq!(asset["name"], "SPDR S&P 500 ETF");
    assert_eq!(asset["forcedUsdPrice"], 500.25);
    assert_eq!(asset["trackingTicker"], "VFFVX");
    assert_eq!(asset["trackingMultiplier"], 1.5155);
    let id = asset["id"].as_str().unwrap().to_owned();

    let (data, errors) = fixture
        .execute_with(
            r#"mutation($id: ID!) { updateAsset(input: { id: $id, identifier: "APPL", name: "Apple Incorporated", forcePrice: true, forcedUsdPrice: 123.45, security: { isin: "US0378331005" } }) { asset { identifier name forcedUsdPrice } } }"#,
            all_scopes(),
            json!({"id": id}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        data["updateAsset"]["asset"],
        json!({"identifier": "APPL", "name": "Apple Incorporated", "forcedUsdPrice": 123.45})
    );

    let (data, errors) = fixture
        .execute_with(
            "mutation($id: ID!) { updateAsset(input: { id: $id, forcePrice: false }) { asset { forcedUsdPrice } } }",
            all_scopes(),
            json!({"id": id}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["updateAsset"]["asset"]["forcedUsdPrice"], Value::Null);

    let (_, errors) = fixture
        .execute_with(
            "mutation($id: ID!) { updateAsset(input: { id: $id }) { asset { id } } mergeAsset(input: { sourceAdapter: PLAID, sourceId: \"x\", assetId: $id }) { asset { id } } }",
            all_scopes(),
            json!({"id": global_id(GlobalIdType::Owner, 1)}),
        )
        .await?;
    assert_eq!(errors.len(), 2, "{errors:?}");
    assert!(errors.iter().all(|error| code(error) == "BAD_USER_INPUT"));
    assert!(errors.iter().any(|error| path(error) == "mergeAsset"));
    Ok(())
}

#[tokio::test]
async fn change_account_snapshot_and_reviews_validate_ids() -> Result<()> {
    let fixture = seed().await?;
    let snapshot_id =
        sqlx::query_scalar::<_, i64>("SELECT id FROM account_balance_daily_snapshots WHERE account_id = ?")
            .bind(fixture.plaid_account_id)
            .fetch_one(&fixture.pool)
            .await?;
    let (data, errors) = fixture
        .execute_with(
            "mutation($snapshot: ID!, $asset: ID!) { changeAccountSnapshot(input: { snapshotId: $snapshot, holdings: [{ assetId: $asset, quantity: 3, valueUSD: 180 }] }) { snapshot { balanceUSD holdings { quantity } } account { name } } }",
            all_scopes(),
            json!({"snapshot": global_id(GlobalIdType::AccountSnapshot, snapshot_id), "asset": global_id(GlobalIdType::Asset, fixture.stock_asset_id)}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["changeAccountSnapshot"]["snapshot"]["balanceUSD"], 180);
    assert_eq!(data["changeAccountSnapshot"]["account"]["name"], "Checking");

    let wrong = global_id(GlobalIdType::Owner, 1);
    let (_, errors) = fixture
        .execute_with(
            "mutation($wrong: ID!, $snapshot: ID!) { a: changeAccountSnapshot(input: { snapshotId: $wrong, holdings: [] }) { account { id } } b: changeAccountSnapshot(input: { snapshotId: $snapshot, holdings: [{ assetId: $wrong, valueUSD: 1 }] }) { account { id } } c: resolveBalanceReview(input: { id: $wrong, action: APPROVE_CHANGES }) { success } }",
            all_scopes(),
            json!({"wrong": wrong, "snapshot": global_id(GlobalIdType::AccountSnapshot, snapshot_id)}),
        )
        .await?;
    assert_eq!(errors.len(), 3, "{errors:?}");
    assert!(errors.iter().all(|error| code(error) == "BAD_USER_INPUT"), "{errors:?}");
    Ok(())
}
