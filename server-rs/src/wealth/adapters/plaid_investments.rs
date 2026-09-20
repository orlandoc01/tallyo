use std::collections::HashMap;

use anyhow::{Context, Result, anyhow};
use chrono::TimeZone;

use crate::{
    accounts::{AccountType, store as accounts_store, type_from_plaid},
    clients::plaid::{AccountBase, Holding, InvestmentsHoldingsGetResponse, Security},
    schema::{AssetClassifier, AssetType, ConnectivityStatus},
    wealth::{
        AccountBalanceSnapshot, AdapterSource, Asset, AssetDailyHolding, AssetUpsert, PersistSink, SyncerId, flagging,
        investment_draft::InvestmentSnapshotDraft, store,
    },
};

use super::{
    plaid::PlaidSyncAdapter, plaid_dedupe::dedupe_aggregate_holdings, plaid_investment_valuation::RecalibrationEntry,
};

struct InvestmentAccountDraft {
    account_id: i64,
    draft: InvestmentSnapshotDraft,
    recalibrations: Vec<RecalibrationEntry>,
}

impl PlaidSyncAdapter {
    pub(super) async fn sync_investments(
        &self,
        response: &InvestmentsHoldingsGetResponse,
        balance_accounts: &[AccountBase],
        sink: &dyn PersistSink,
    ) -> Result<()> {
        let raw_payload = serde_json::to_string(response).context("marshal plaid investment payload")?;
        let securities = response
            .securities
            .iter()
            .map(|security| (security.security_id.as_str(), security))
            .collect::<HashMap<_, _>>();
        let mut drafts = self.investment_account_drafts(&response.accounts).await?;
        let target_balances = investment_account_balances(&response.accounts);
        let balance_accounts = investment_account_balances(balance_accounts);

        for holding in dedupe_aggregate_holdings(&response.holdings, &target_balances) {
            let Some(account) = self.draft_for_holding(&mut drafts, &holding).await? else {
                continue;
            };
            let security = securities
                .get(holding.security_id.as_str())
                .copied()
                .cloned()
                .unwrap_or_else(|| Security {
                    security_id: holding.security_id.clone(),
                    ..Default::default()
                });
            let asset = asset_from_security(&security, sink.now());
            let pricing_asset = self.pricing_asset_for_holding(&asset).await?;
            let (price, institution_price_used) = self
                .investment_holding_price(&pricing_asset, &holding, &security, sink.today())
                .await?;
            if institution_price_used {
                account.recalibrations.push(RecalibrationEntry {
                    asset: pricing_asset,
                    institution_price: holding.institution_price,
                    source_id: holding.security_id.clone(),
                });
            }
            account.draft.add(AssetDailyHolding {
                asset_id: 0,
                asset: Some(asset.clone()),
                adapter_source: asset.adapter_source.clone(),
                adapter_sources: Vec::new(),
                price_update: None,
                quantity: Some(holding.quantity),
                price,
                value_usd: holding.quantity * price.unwrap_or_default(),
                counts_toward_value: true,
                manual: false,
                line_type: String::new(),
                chain_id: String::new(),
                project_name: None,
                token_id: String::new(),
                identifier: asset.identifier,
                token_symbol: None,
                token_name: None,
                provider_price: None,
            });
        }

        for (external_id, mut account) in drafts {
            if account.draft.holdings.is_empty() {
                self.handle_empty_investment_holdings(
                    account.account_id,
                    balance_accounts.get(&external_id).copied(),
                    sink,
                    &raw_payload,
                )
                .await?;
                continue;
            }
            let updates = self
                .post_snapshot_recalibration(&account.recalibrations, sink.today())
                .await;
            for holding in &mut account.draft.holdings {
                if let Some(source) = holding.asset.as_ref().and_then(|asset| asset.adapter_source.as_ref()) {
                    holding.price_update = updates.get(&source.source_id).cloned();
                }
            }
            flagging::emit_with_price_check(
                &self.pool,
                sink,
                AccountBalanceSnapshot {
                    account_id: account.account_id,
                    wallet_address: String::new(),
                    source: SyncerId::Plaid.to_string(),
                    date: sink.today().to_owned(),
                    synced_at: sink.now().to_rfc3339(),
                    balance_usd: account.draft.balance_usd,
                    raw_payload: Some(raw_payload.clone()),
                    holdings: account.draft.holdings,
                    flagged: false,
                    flag_reason: String::new(),
                },
            )
            .await?;
        }
        Ok(())
    }

    async fn investment_account_drafts(
        &self,
        accounts: &[AccountBase],
    ) -> Result<HashMap<String, InvestmentAccountDraft>> {
        let mut drafts = HashMap::new();
        for account in accounts {
            let Some(account) = self.investment_account(account).await? else {
                continue;
            };
            drafts.insert(account.0, account.1);
        }
        Ok(drafts)
    }

    async fn draft_for_holding<'a>(
        &self,
        drafts: &'a mut HashMap<String, InvestmentAccountDraft>,
        holding: &Holding,
    ) -> Result<Option<&'a mut InvestmentAccountDraft>> {
        if !drafts.contains_key(&holding.account_id) {
            let account = AccountBase {
                account_id: holding.account_id.clone(),
                account_type: "investment".to_owned(),
                ..Default::default()
            };
            let Some((external_id, draft)) = self.investment_account(&account).await? else {
                return Ok(None);
            };
            drafts.insert(external_id, draft);
        }
        Ok(drafts.get_mut(&holding.account_id))
    }

    async fn investment_account(&self, account: &AccountBase) -> Result<Option<(String, InvestmentAccountDraft)>> {
        let persisted = accounts_store::account_by_external_id(&self.pool, &account.account_id).await?;
        let account_type = persisted
            .as_ref()
            .map_or_else(|| type_from_plaid(&account.account_type), |account| account.r#type);
        if account_type != AccountType::Investment {
            return Ok(None);
        }
        let account_id = persisted
            .map(|account| account.id)
            .ok_or_else(|| anyhow!("lookup account {}: not found", account.account_id))?;
        Ok(Some((
            account.account_id.clone(),
            InvestmentAccountDraft {
                account_id,
                draft: InvestmentSnapshotDraft::default(),
                recalibrations: Vec::new(),
            },
        )))
    }

    async fn pricing_asset_for_holding(&self, asset: &AssetUpsert) -> Result<Asset> {
        let persisted = match asset.adapter_source.as_ref() {
            Some(source) => store::asset_by_adapter_source(&self.pool, source).await?,
            None => None,
        };
        Ok(persisted.unwrap_or_else(|| transient_asset(asset)))
    }
}

fn investment_account_balances(accounts: &[AccountBase]) -> HashMap<String, f64> {
    accounts
        .iter()
        .filter(|account| type_from_plaid(&account.account_type) == AccountType::Investment)
        .filter_map(|account| {
            account
                .balances
                .current
                .map(|balance| (account.account_id.clone(), balance))
        })
        .collect()
}

fn asset_from_security(security: &Security, now: chrono::DateTime<chrono::Utc>) -> AssetUpsert {
    let identifier = security
        .ticker_symbol
        .as_deref()
        .filter(|ticker| !ticker.is_empty())
        .map_or_else(|| format!("plaid:{}", security.security_id), ToOwned::to_owned)
        .to_ascii_uppercase();
    let close_price = security.close_price.filter(|price| *price > 0.0);
    let last_price_at = close_price.and_then(|_| {
        security
            .close_price_as_of
            .as_deref()
            .and_then(|date| chrono::NaiveDate::parse_from_str(date, "%F").ok())
            .and_then(|date| date.and_hms_opt(0, 0, 0))
            .map(|date| chrono::Utc.from_utc_datetime(&date))
            .or(Some(now))
    });
    AssetUpsert {
        asset_type: AssetType::Security,
        identifier,
        name: security.name.clone().filter(|name| !name.is_empty()),
        classifier: if security.is_cash_equivalent.unwrap_or(false)
            || security
                .security_type
                .as_deref()
                .is_some_and(|security_type| security_type.to_ascii_lowercase().contains("cash"))
        {
            AssetClassifier::Cash
        } else {
            AssetClassifier::Public
        },
        user_edited: false,
        user_created: false,
        forced_usd_price: None,
        tracking_ticker: None,
        tracking_multiplier: 1.0,
        last_price: close_price,
        last_price_at,
        adapter_source: (!security.security_id.is_empty()).then(|| AdapterSource {
            adapter: SyncerId::Plaid,
            source_id: security.security_id.clone(),
        }),
        plaid_security_type: security.security_type.clone().filter(|kind| !kind.is_empty()),
        cusip: security.cusip.clone().filter(|cusip| !cusip.is_empty()),
        isin: security.isin.clone().filter(|isin| !isin.is_empty()),
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

fn transient_asset(asset: &AssetUpsert) -> Asset {
    Asset {
        id: 0,
        asset_type: asset.asset_type,
        identifier: asset.identifier.clone(),
        name: asset.name.clone(),
        classifier: asset.classifier,
        current_price: asset.last_price,
        forced_usd_price: asset.forced_usd_price,
        tracking_ticker: asset.tracking_ticker.clone(),
        tracking_multiplier: asset.tracking_multiplier,
        price_connectivity: ConnectivityStatus::Healthy,
        investment_connectivity: ConnectivityStatus::Healthy,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use anyhow::Result;
    use chrono::{DateTime, TimeZone, Utc};

    use super::{PlaidSyncAdapter, asset_from_security, investment_account_balances};
    use crate::{
        accounts::{AccountType, PlaidClientFactory, store as accounts_store},
        clients::{
            plaid::{AccountBalance, AccountBase, Holding, InvestmentsHoldingsGetResponse, Security},
            yahoo::Yahoo,
        },
        database::dbtest,
        money::Cents,
        testutil::store::{create_owner, linked_account, seed_plaid_item},
        utils::future::BoxFuture,
        wealth::{
            AccountBalanceSnapshot, AssetDailyHolding, PersistEvent, PersistSink, SnapshotDecision, SyncerId,
            YahooPriceProvider, store,
        },
    };
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path_regex},
    };

    struct RecordingSink {
        now: DateTime<Utc>,
        events: Mutex<Vec<PersistEvent>>,
    }

    impl PersistSink for RecordingSink {
        fn now(&self) -> DateTime<Utc> {
            self.now
        }

        fn today(&self) -> &str {
            "2026-09-06"
        }

        fn persist<'a>(&'a self, event: PersistEvent) -> BoxFuture<'a, Result<()>> {
            self.events.lock().unwrap().push(event);
            Box::pin(async { Ok(()) })
        }
    }

    #[test]
    fn maps_security_identity_classifier_and_close_timestamp() {
        let asset = asset_from_security(
            &Security {
                security_id: "security".to_owned(),
                ticker_symbol: Some("vti".to_owned()),
                security_type: Some("cash fund".to_owned()),
                close_price: Some(4.0),
                close_price_as_of: Some("2026-09-05".to_owned()),
                ..Default::default()
            },
            Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
        );
        assert_eq!(asset.identifier, "VTI");
        assert_eq!(asset.classifier, crate::schema::AssetClassifier::Cash);
        assert_eq!(asset.last_price, Some(4.0));
        assert_eq!(
            asset.last_price_at.unwrap(),
            Utc.with_ymd_and_hms(2026, 9, 5, 0, 0, 0).unwrap()
        );
        assert_eq!(asset.adapter_source.unwrap().source_id, "security");
    }

    #[test]
    fn selects_only_investment_account_balances() {
        let balances = investment_account_balances(&[
            AccountBase {
                account_id: "investment".to_owned(),
                account_type: "investment".to_owned(),
                balances: AccountBalance {
                    current: Some(12.0),
                    ..Default::default()
                },
                ..Default::default()
            },
            AccountBase {
                account_id: "cash".to_owned(),
                account_type: "depository".to_owned(),
                balances: AccountBalance {
                    current: Some(99.0),
                    ..Default::default()
                },
                ..Default::default()
            },
        ]);
        assert_eq!(balances.len(), 1);
        assert_eq!(balances["investment"], 12.0);
    }

    #[tokio::test]
    async fn writes_investment_raw_payload_and_a_zero_holdings_snapshot() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "Owner").await?;
        let (_, connection) = seed_plaid_item(&pool, &owner, "item").await?;
        let mut account = linked_account(&owner, connection.id, "investment");
        account.account_type = AccountType::Investment;
        let account_id = accounts_store::upsert_account(&pool, &account).await?;
        let adapter = PlaidSyncAdapter::new(pool.clone(), PlaidClientFactory::new(pool))?;
        let sink = RecordingSink {
            now: Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
            events: Mutex::new(Vec::new()),
        };

        let account = AccountBase {
            account_id: "investment".to_owned(),
            account_type: "investment".to_owned(),
            balances: AccountBalance {
                current: Some(10.0),
                ..Default::default()
            },
            ..Default::default()
        };
        adapter
            .sync_investments(
                &InvestmentsHoldingsGetResponse {
                    accounts: vec![account.clone()],
                    holdings: vec![Holding {
                        account_id: "investment".to_owned(),
                        security_id: "security".to_owned(),
                        quantity: 2.0,
                        institution_price: 5.0,
                        ..Default::default()
                    }],
                    securities: vec![Security {
                        security_id: "security".to_owned(),
                        ticker_symbol: Some("vti".to_owned()),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                &[account],
                &sink,
            )
            .await?;
        {
            let events = sink.events.lock().unwrap();
            let PersistEvent::Snapshot(snapshot) = &events[0] else {
                panic!("expected investment snapshot");
            };
            assert_eq!(snapshot.snapshot.account_id, account_id);
            assert_eq!(snapshot.snapshot.holdings[0].value_usd, 10.0);
            assert!(
                snapshot
                    .snapshot
                    .raw_payload
                    .as_deref()
                    .is_some_and(|raw| raw.contains("security"))
            );
        }

        adapter
            .sync_investments(
                &InvestmentsHoldingsGetResponse {
                    accounts: vec![AccountBase {
                        account_id: "investment".to_owned(),
                        account_type: "investment".to_owned(),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                &[AccountBase {
                    account_id: "investment".to_owned(),
                    account_type: "investment".to_owned(),
                    balances: AccountBalance {
                        current: Some(0.0),
                        ..Default::default()
                    },
                    ..Default::default()
                }],
                &sink,
            )
            .await?;
        let events = sink.events.lock().unwrap();
        let PersistEvent::Snapshot(snapshot) = &events[1] else {
            panic!("expected empty investment snapshot");
        };
        assert_eq!(snapshot.decision, SnapshotDecision::Clean);
        assert_eq!(snapshot.snapshot.balance_usd, Cents::default());
        assert!(snapshot.snapshot.holdings.is_empty());
        Ok(())
    }

    #[tokio::test]
    async fn flags_deviating_investment_prices_and_carries_the_last_clean_snapshot() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "Owner").await?;
        let (_, connection) = seed_plaid_item(&pool, &owner, "item").await?;
        let mut account = linked_account(&owner, connection.id, "investment");
        account.account_type = AccountType::Investment;
        let account_id = accounts_store::upsert_account(&pool, &account).await?;
        let asset_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO assets (asset_type, identifier, classifier, last_price, price_connectivity) VALUES ('SECURITY', 'VTI', 'PUBLIC', 2, 'IGNORE') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        store::replace_account_balance_snapshot(
            &pool,
            AccountBalanceSnapshot {
                account_id,
                wallet_address: String::new(),
                source: SyncerId::Plaid.to_string(),
                date: "2026-09-05".to_owned(),
                synced_at: "2026-09-05T12:00:00Z".to_owned(),
                balance_usd: Cents(2000),
                raw_payload: None,
                holdings: vec![AssetDailyHolding {
                    asset_id,
                    asset: None,
                    adapter_source: None,
                    adapter_sources: Vec::new(),
                    price_update: None,
                    quantity: Some(10.0),
                    price: Some(2.0),
                    value_usd: 20.0,
                    counts_toward_value: true,
                    manual: false,
                    line_type: String::new(),
                    chain_id: String::new(),
                    project_name: None,
                    token_id: String::new(),
                    identifier: "VTI".to_owned(),
                    token_symbol: None,
                    token_name: None,
                    provider_price: None,
                }],
                flagged: false,
                flag_reason: String::new(),
            },
        )
        .await?;
        let adapter = PlaidSyncAdapter::new(pool.clone(), PlaidClientFactory::new(pool))?;
        let sink = RecordingSink {
            now: Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
            events: Mutex::new(Vec::new()),
        };
        let account = AccountBase {
            account_id: "investment".to_owned(),
            account_type: "investment".to_owned(),
            balances: AccountBalance {
                current: Some(2100.0),
                ..Default::default()
            },
            ..Default::default()
        };

        adapter
            .sync_investments(
                &InvestmentsHoldingsGetResponse {
                    accounts: vec![account.clone()],
                    holdings: vec![Holding {
                        account_id: "investment".to_owned(),
                        security_id: "security".to_owned(),
                        quantity: 10.0,
                        institution_price: 210.0,
                        ..Default::default()
                    }],
                    securities: vec![Security {
                        security_id: "security".to_owned(),
                        ticker_symbol: Some("VTI".to_owned()),
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                &[account],
                &sink,
            )
            .await?;
        let events = sink.events.lock().unwrap();
        let PersistEvent::Snapshot(snapshot) = &events[0] else {
            panic!("expected investment snapshot")
        };
        assert_eq!(snapshot.decision, SnapshotDecision::Flagged);
        assert_eq!(snapshot.snapshot.balance_usd, Cents(2000));
        assert_eq!(snapshot.carry_usd, Cents(2000));
        assert!(snapshot.review.is_some());
        assert!(snapshot.provider_state.is_some());
        assert!(snapshot.snapshot.flag_reason.contains("price VTI"));
        Ok(())
    }

    #[tokio::test]
    async fn carries_and_reprices_prior_holdings_when_plaid_returns_none() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "Owner").await?;
        let (_, connection) = seed_plaid_item(&pool, &owner, "item").await?;
        let mut account = linked_account(&owner, connection.id, "investment");
        account.account_type = AccountType::Investment;
        let account_id = accounts_store::upsert_account(&pool, &account).await?;
        let asset_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO assets (asset_type, identifier, classifier, last_price, price_connectivity) VALUES ('SECURITY', 'VTI', 'PUBLIC', 11, 'IGNORE') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        store::replace_account_balance_snapshot(
            &pool,
            AccountBalanceSnapshot {
                account_id,
                wallet_address: String::new(),
                source: SyncerId::Plaid.to_string(),
                date: "2026-09-05".to_owned(),
                synced_at: "2026-09-05T12:00:00Z".to_owned(),
                balance_usd: Cents(800),
                raw_payload: None,
                holdings: vec![AssetDailyHolding {
                    asset_id,
                    asset: None,
                    adapter_source: None,
                    adapter_sources: Vec::new(),
                    price_update: None,
                    quantity: Some(2.0),
                    price: Some(4.0),
                    value_usd: 8.0,
                    counts_toward_value: true,
                    manual: false,
                    line_type: String::new(),
                    chain_id: String::new(),
                    project_name: None,
                    token_id: String::new(),
                    identifier: "VTI".to_owned(),
                    token_symbol: None,
                    token_name: None,
                    provider_price: None,
                }],
                flagged: false,
                flag_reason: String::new(),
            },
        )
        .await?;
        let adapter = PlaidSyncAdapter::new(pool.clone(), PlaidClientFactory::new(pool))?;
        let sink = RecordingSink {
            now: Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
            events: Mutex::new(Vec::new()),
        };

        assert!(
            adapter
                .handle_empty_investment_holdings(account_id, Some(50.0), &sink, "{}")
                .await?
        );
        let events = sink.events.lock().unwrap();
        let PersistEvent::Snapshot(snapshot) = &events[0] else {
            panic!("expected carried investment snapshot");
        };
        assert_eq!(snapshot.decision, SnapshotDecision::Flagged);
        assert_eq!(snapshot.snapshot.balance_usd, Cents(2200));
        assert_eq!(snapshot.snapshot.holdings[0].price, Some(11.0));
        assert_eq!(
            snapshot.snapshot.flag_reason,
            super::super::plaid_investment_valuation::EMPTY_INVESTMENT_HOLDINGS_FLAG_REASON
        );
        Ok(())
    }

    #[tokio::test]
    async fn prefers_a_live_price_to_plaid_close_when_institution_price_is_missing() -> Result<()> {
        let pool = dbtest::open().await?;
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path_regex("/v8/finance/chart/.*"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                r#"{"chart":{"result":[{"meta":{"regularMarketPrice":7,"regularMarketTime":1788696000}}]}}"#,
            ))
            .mount(&server)
            .await;
        let adapter = PlaidSyncAdapter::with_prices(
            pool.clone(),
            PlaidClientFactory::new(pool.clone()),
            YahooPriceProvider::with_client(pool, Yahoo::with_base_url(server.uri())?),
        );
        let security = Security {
            security_id: "security".to_owned(),
            ticker_symbol: Some("VTI".to_owned()),
            close_price: Some(5.0),
            ..Default::default()
        };
        let asset = super::transient_asset(&asset_from_security(
            &security,
            Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
        ));

        let (price, institution_price_used) = adapter
            .investment_holding_price(
                &asset,
                &Holding::default(),
                &security,
                &Utc::now().format("%F").to_string(),
            )
            .await?;
        assert_eq!(price, Some(7.0));
        assert!(!institution_price_used);
        Ok(())
    }
}
