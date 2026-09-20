use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use anyhow::Result;
use async_graphql::dataloader::{DataLoader, Loader};
use serde_json::{Value, json};

use super::{by_name, path, record_batches, request, seed, updates};
use crate::{
    accounts::{self, store as accounts_store},
    auth::Scope,
    graph::{Resolver, loaders::AccountKey},
    money::Cents,
    schema::{CreateRuleInput, TransactionUpdates},
    testutil::transactions::transaction,
    transactions::store as transactions_store,
};

const ACCOUNTS_QUERY: &str = r#"{
    accounts { items {
        name typeLocked lastSyncedAt
        connection { name provider { __typename
            ... on PlaidItem { institutionId credential { clientId } accounts { name } }
            ... on EVMWallet { address chainIds }
            ... on SimpleFinConnection { orgDomain accounts { name } } } }
        latestSnapshot { date balanceUSD netContributionUSD holdings { quantity valueUSD account { name } asset { identifier } } }
        accountWealthProperty { ... on RealEstateAssetDetails { address { street city zip } } }
    } }
}"#;

#[tokio::test]
async fn resolves_account_fields_through_the_loaders() -> Result<()> {
    let fixture = seed().await?;
    let (data, errors) = fixture
        .execute(
            ACCOUNTS_QUERY,
            vec![Scope::ReadAccounts, Scope::ReadWealth, Scope::ReadHoldings],
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    let accounts = &data["accounts"]["items"];

    let checking = by_name(accounts, "Checking");
    assert_eq!(checking["typeLocked"], false);
    assert_eq!(checking["lastSyncedAt"], "2026-01-02T12:00:00+00:00");
    assert_eq!(checking["connection"]["name"], "Institution");
    assert_eq!(checking["connection"]["provider"]["__typename"], "PlaidItem");
    assert_eq!(checking["connection"]["provider"]["institutionId"], "ins");
    assert_eq!(checking["connection"]["provider"]["credential"]["clientId"], "client");
    assert_eq!(
        checking["connection"]["provider"]["accounts"],
        json!([{"name": "Checking"}])
    );
    assert_eq!(
        checking["latestSnapshot"],
        json!({
            "date": "2026-01-02",
            "balanceUSD": 120,
            "netContributionUSD": 120,
            "holdings": [{"quantity": 2.0, "valueUSD": 120, "account": {"name": "Checking"}, "asset": {"identifier": "VTI"}}]
        })
    );
    assert_eq!(checking["accountWealthProperty"], Value::Null);

    let cash = by_name(accounts, "Cash");
    assert_eq!(cash["connection"], Value::Null);
    assert_eq!(cash["lastSyncedAt"], Value::Null);
    assert_eq!(cash["typeLocked"], false);

    let wallet = by_name(accounts, "Wallet");
    assert_eq!(wallet["typeLocked"], true);
    assert_eq!(
        wallet["connection"]["provider"],
        json!({"__typename": "EVMWallet", "address": "0x1111111111111111111111111111111111111111", "chainIds": ["eth"]})
    );

    let home = by_name(accounts, "Home");
    assert_eq!(home["typeLocked"], true);
    assert_eq!(home["connection"]["provider"], Value::Null);
    assert_eq!(
        home["accountWealthProperty"],
        json!({"address": {"street": "1 Main", "city": "Austin", "zip": Value::Null}})
    );
    assert_eq!(home["latestSnapshot"]["balanceUSD"], 50_000);

    let savings = by_name(accounts, "Bank savings");
    assert_eq!(savings["connection"]["provider"]["__typename"], "SimpleFinConnection");
    assert_eq!(savings["connection"]["provider"]["orgDomain"], "bank.example");
    assert_eq!(
        savings["connection"]["provider"]["accounts"],
        json!([{"name": "Bank savings"}])
    );
    Ok(())
}

#[tokio::test]
async fn guarded_fields_resolve_to_null_with_a_pathed_forbidden_error() -> Result<()> {
    let fixture = seed().await?;
    let (data, errors) = fixture.execute(ACCOUNTS_QUERY, vec![Scope::ReadAccounts]).await?;

    let accounts = data["accounts"]["items"].as_array().unwrap();
    assert_eq!(accounts.len(), 5);
    assert!(accounts.iter().all(|account| account["latestSnapshot"].is_null()));
    assert!(
        accounts
            .iter()
            .all(|account| account["accountWealthProperty"].is_null())
    );
    assert_eq!(
        by_name(&data["accounts"]["items"], "Checking")["connection"]["name"],
        "Institution"
    );
    assert_eq!(errors.len(), 10);
    assert!(
        errors
            .iter()
            .all(|error| error.message == "forbidden: read:wealth access required")
    );
    assert!(
        errors
            .iter()
            .any(|error| path(error) == "accounts.items.0.latestSnapshot")
    );
    assert!(
        errors
            .iter()
            .any(|error| path(error) == "accounts.items.0.accountWealthProperty")
    );

    let (data, errors) = fixture
        .execute(
            "{ accounts { items { name latestSnapshot { date holdings { quantity } } } } }",
            vec![Scope::ReadAccounts, Scope::ReadWealth],
        )
        .await?;
    let checking = by_name(&data["accounts"]["items"], "Checking");
    assert_eq!(checking["latestSnapshot"]["date"], "2026-01-02");
    assert_eq!(checking["latestSnapshot"]["holdings"], Value::Null);
    assert!(
        errors
            .iter()
            .any(|error| error.message == "forbidden: read:holdings access required"
                && path(error).ends_with(".latestSnapshot.holdings"))
    );
    Ok(())
}

#[tokio::test]
async fn resolves_provider_item_token_rule_and_transaction_relations() -> Result<()> {
    let fixture = seed().await?;
    let (data, errors) = fixture
        .execute(
            r#"{
                connections { items { name provider { __typename } } }
                plaidItems { items { institutionId credential { clientId environment } accounts { name } } }
                simpleFinAccessTokens { items { label owner { name } connections { orgDomain accounts { name } } } }
                rules { items { merchantPattern tags { name } accounts { name } } }
                transactions { edges { node { merchantName tags { name color } account { name owner { name } } category { name } } } }
            }"#,
            vec![Scope::ReadAccounts, Scope::ReadRules, Scope::ReadTransactions],
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");

    let providers = data["connections"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|connection| {
            (
                connection["name"].as_str().unwrap().to_owned(),
                connection["provider"]["__typename"].clone(),
            )
        })
        .collect::<Vec<_>>();
    assert!(providers.contains(&("Institution".to_owned(), json!("PlaidItem"))));
    assert!(providers.contains(&("Bank".to_owned(), json!("SimpleFinConnection"))));
    assert!(providers.contains(&("Wallet".to_owned(), json!("EVMWallet"))));
    assert_eq!(providers.len(), 3, "asset-backed connections are not listed");

    assert_eq!(
        data["plaidItems"]["items"],
        json!([{"institutionId": "ins", "credential": {"clientId": "client", "environment": "SANDBOX"}, "accounts": [{"name": "Checking"}]}])
    );
    assert_eq!(
        data["simpleFinAccessTokens"]["items"],
        json!([{"label": "Bridge", "owner": {"name": "Alex"}, "connections": [{"orgDomain": "bank.example", "accounts": [{"name": "Bank savings"}]}]}])
    );
    assert_eq!(
        data["rules"]["items"],
        json!([{"merchantPattern": "coffee", "tags": [{"name": "Household"}], "accounts": [{"name": "Checking"}]}])
    );
    assert_eq!(
        data["transactions"]["edges"],
        json!([{"node": {"merchantName": "coffee", "tags": [{"name": "Household", "color": "#AABBCC"}], "account": {"name": "Checking", "owner": {"name": "Alex"}}, "category": {"name": "uncategorized"}}}])
    );
    Ok(())
}

#[tokio::test]
async fn empty_relations_resolve_to_empty_lists() -> Result<()> {
    let fixture = seed().await?;
    transactions_store::delete_rule(&fixture.pool, fixture.rule_id).await?;
    transactions_store::create_rule(
        &fixture.pool,
        CreateRuleInput {
            merchant_pattern: Some("bare".to_owned()),
            original_pattern: None,
            changes: TransactionUpdates {
                merchant_name: Some("Bare".to_owned()),
                ..updates()
            },
            account_ids: None,
            amount_min: None,
            amount_max: None,
            priority: None,
            apply_retroactively: None,
        },
    )
    .await?;
    transactions_store::delete_transaction(&fixture.pool, fixture.tagged_transaction_id).await?;
    transaction(
        &fixture.pool,
        "plain",
        fixture.plaid_account_id,
        0,
        Cents(100),
        "2026-01-03T12:00:00Z".parse()?,
    )
    .await?;

    let (data, errors) = fixture
        .execute(
            "{ rules { items { tags { name } accounts { name } } } transactions { edges { node { tags { name } } } } }",
            vec![Scope::ReadRules, Scope::ReadTransactions],
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["rules"]["items"], json!([{"tags": [], "accounts": []}]));
    assert_eq!(data["transactions"]["edges"], json!([{"node": {"tags": []}}]));
    Ok(())
}

#[tokio::test]
async fn resolves_asset_fields_and_holding_accounts() -> Result<()> {
    let fixture = seed().await?;
    let query = r#"{
        assets(input: { includeHistorical: true }) { items { identifier assetType
            details { ... on RealEstateAssetDetails { address { street } } }
            adapterSources { sourceAdapter sourceId }
            latestSnapshot { asOfDate totalHeldQuantity totalHeldValueUSD holdings { quantity account { name } } } } }
    }"#;
    let (data, errors) = fixture
        .execute(query, vec![Scope::ReadAssets, Scope::ReadHoldings])
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    let assets = data["assets"]["items"].as_array().unwrap();
    let stock = assets.iter().find(|asset| asset["identifier"] == "VTI").unwrap();
    assert_eq!(stock["details"], Value::Null);
    assert_eq!(
        stock["adapterSources"],
        json!([{"sourceAdapter": "PLAID", "sourceId": "sec-1"}])
    );
    assert_eq!(
        stock["latestSnapshot"],
        json!({"asOfDate": "2026-01-02", "totalHeldQuantity": 2.0, "totalHeldValueUSD": 120, "holdings": [{"quantity": 2.0, "account": {"name": "Checking"}}]})
    );
    let home = assets.iter().find(|asset| asset["assetType"] == "REAL_ESTATE").unwrap();
    assert_eq!(home["details"], json!({"address": {"street": "1 Main"}}));
    assert_eq!(home["adapterSources"], json!([]));
    assert_eq!(home["latestSnapshot"]["holdings"][0]["account"]["name"], "Home");

    let (data, errors) = fixture.execute(query, vec![Scope::ReadHoldings]).await?;
    assert!(data["assets"].is_null());
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].message, "forbidden: read:assets access required");

    let (data, errors) = fixture.execute(query, vec![Scope::ReadAssets]).await?;
    let assets = data["assets"]["items"].as_array().unwrap();
    let stock = assets.iter().find(|asset| asset["identifier"] == "VTI").unwrap();
    assert_eq!(stock["latestSnapshot"]["asOfDate"], "2026-01-02");
    assert!(assets.iter().all(|asset| asset["latestSnapshot"]["holdings"].is_null()));
    assert!(
        errors
            .iter()
            .all(|error| error.message == "forbidden: read:holdings access required")
    );
    assert!(
        errors
            .iter()
            .any(|error| path(error) == "assets.items.0.latestSnapshot.holdings")
    );
    Ok(())
}

struct CountingLoader {
    resolver: Resolver,
    batches: Arc<AtomicUsize>,
}

impl Loader<AccountKey> for CountingLoader {
    type Value = accounts::AccountRecord;
    type Error = async_graphql::Error;

    async fn load(
        &self,
        keys: &[AccountKey],
    ) -> std::result::Result<std::collections::HashMap<AccountKey, Self::Value>, Self::Error> {
        self.batches.fetch_add(1, Ordering::SeqCst);
        self.resolver.load(keys).await
    }
}

#[tokio::test]
async fn concurrent_loads_share_one_batch() -> Result<()> {
    let fixture = seed().await?;
    let accounts = accounts_store::accounts(&fixture.pool).await?;
    let batches = Arc::new(AtomicUsize::new(0));
    let loader = DataLoader::new(
        CountingLoader {
            resolver: fixture.resolver(),
            batches: batches.clone(),
        },
        tokio::spawn,
    );

    let (first, second, third, missing) = tokio::join!(
        loader.load_one(AccountKey(accounts[0].id)),
        loader.load_one(AccountKey(accounts[1].id)),
        loader.load_one(AccountKey(accounts[2].id)),
        loader.load_one(AccountKey(9_999)),
    );

    assert_eq!(batches.load(Ordering::SeqCst), 1);
    assert_eq!(first.unwrap().unwrap().account, accounts[0]);
    assert_eq!(second.unwrap().unwrap().account, accounts[1]);
    assert_eq!(third.unwrap().unwrap().account.owner, fixture.owner);
    assert_eq!(missing.unwrap(), None);
    Ok(())
}

#[tokio::test]
async fn request_loaders_batch_each_key_type_once() -> Result<()> {
    let fixture = seed().await?;
    let schema = fixture.schema();
    let query = "{ accounts { items { name connection { name } latestSnapshot { date } } } }";
    let (response, mut batches) =
        record_batches(schema.execute(request(query, vec![Scope::ReadAccounts, Scope::ReadWealth]))).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json()?["accounts"]["items"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    batches.sort_unstable();
    assert_eq!(
        batches,
        ["AccountKey", "AccountLatestSnapshotKey", "ConnectionKey"],
        "one batch per loader key type, not per account"
    );
    Ok(())
}
