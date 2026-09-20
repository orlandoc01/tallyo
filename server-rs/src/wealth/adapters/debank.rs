use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, Result, anyhow, ensure};
use sqlx::SqlitePool;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::{
    accounts::{EvmWallet, SourceTable, store as accounts_store},
    clients::debank::{Debank, Project, ProjectItem, TokenBalance, TokenMetadata},
    money::Cents,
    schema::{AssetClassifier, AssetType},
    utils::future::BoxFuture,
    wealth::{
        AccountBalanceSnapshot, AdapterSource, AssetDailyHolding, AssetUpsert, ConnectionRef, PersistSink, SyncAdapter,
        SyncerId, flagging, next_balance_sync_after, sanity, store,
    },
};

use super::debank_retry::{FLAG_RETRY_WINDOW, next_flag_retry_delay};

const NEW_ASSET_DUST_THRESHOLD_USD: f64 = 0.05;
const WALLET_SYNC_STAGGER: Duration = Duration::from_secs(2);
const WALLET_SYNC_MAX_CONCURRENT: usize = 4;

#[derive(Clone)]
pub struct DebankSyncAdapter {
    pool: SqlitePool,
    client: Debank,
    cancellation: CancellationToken,
}

struct WalletTokens {
    tokens: Vec<TokenBalance>,
    projects: Vec<Project>,
    raw_payload: String,
}

impl DebankSyncAdapter {
    pub fn new(pool: SqlitePool) -> Result<Self> {
        Ok(Self::with_client(pool, Debank::new()?))
    }

    pub fn with_client(pool: SqlitePool, client: Debank) -> Self {
        Self::with_client_and_cancellation(pool, client, CancellationToken::new())
    }

    pub fn with_client_and_cancellation(pool: SqlitePool, client: Debank, cancellation: CancellationToken) -> Self {
        Self {
            pool,
            client,
            cancellation,
        }
    }

    async fn sync_wallet(&self, wallet: &EvmWallet, cron: &str, sink: &dyn PersistSink) -> Result<()> {
        let account_id = accounts_store::evm_wallet_account_id(&self.pool, wallet.id)
            .await?
            .ok_or_else(|| anyhow!("lookup account {}: not found", wallet.address))?;
        let mut retry_count = 0;
        let mut pending_since = None;
        loop {
            if self.cancellation.is_cancelled() {
                return Err(anyhow!("wallet sync canceled"));
            }
            let WalletTokens {
                tokens,
                projects,
                raw_payload,
            } = self.wallet_tokens(wallet).await?;
            let snapshot = self
                .build_snapshot(account_id, wallet, tokens, projects, raw_payload, sink)
                .await?;
            let anchor = store::latest_unflagged_snapshot_with_holdings(&self.pool, account_id, &snapshot.date).await?;
            let deviation = sanity::holding_price_deviates(
                &anchor.holdings,
                &snapshot.holdings,
                sanity::HOLDING_PRICE_DEVIATION_RATIO,
            );
            if deviation.is_none()
                || flagging::approved_review_matches(&self.pool, account_id, snapshot.balance_usd).await?
            {
                flagging::emit_with_price_check(&self.pool, sink, snapshot).await?;
                break;
            }
            let now = sink.now();
            let deadline = *pending_since.get_or_insert(now) + chrono::Duration::from_std(FLAG_RETRY_WINDOW)?;
            if now >= deadline {
                flagging::emit_with_price_check(&self.pool, sink, snapshot).await?;
                break;
            }
            let remaining = (deadline - now).to_std().unwrap_or_default();
            let delay = next_flag_retry_delay(retry_count).min(remaining);
            tracing::warn!(
                address = wallet.address,
                retry_count,
                next_retry_at = ?(now + chrono::Duration::from_std(delay).unwrap_or_default()),
                ?deadline,
                "evmchain: snapshot deviation detected, retrying after backoff"
            );
            tokio::select! {
                _ = self.cancellation.cancelled() => return Err(anyhow!("wallet sync canceled")),
                _ = tokio::time::sleep(delay) => retry_count += 1,
            }
        }
        accounts_store::set_evm_wallet_balance_synced(&self.pool, wallet.id, next_balance_sync_after(cron, sink.now())?)
            .await
    }

    async fn wallet_tokens(&self, wallet: &EvmWallet) -> Result<WalletTokens> {
        if wallet.chain_ids.is_empty() {
            tracing::warn!(
                address = wallet.address,
                "evmchain: no selected chains; skipping wallet token balances"
            );
            return Ok(WalletTokens {
                tokens: Vec::new(),
                projects: Vec::new(),
                raw_payload: String::new(),
            });
        }
        let mut tokens = Vec::new();
        for chain_id in &wallet.chain_ids {
            tokens.extend(
                self.client
                    .balance_list(&wallet.address, chain_id)
                    .await
                    .with_context(|| format!("fetch token balances for {} chain {chain_id}", wallet.address))?,
            );
        }
        let (projects, project_raw) = self.client.project_list(&wallet.address).await?;
        let projects_raw = serde_json::from_str::<serde_json::Value>(&project_raw).unwrap_or(serde_json::Value::Null);
        let raw_payload = serde_json::to_string(&serde_json::json!({"tokens": tokens, "projects": projects_raw}))
            .context("marshal debank snapshot payload")?;
        Ok(WalletTokens {
            tokens,
            projects,
            raw_payload,
        })
    }

    async fn build_snapshot(
        &self,
        account_id: i64,
        wallet: &EvmWallet,
        tokens: Vec<TokenBalance>,
        projects: Vec<Project>,
        raw_payload: String,
        sink: &dyn PersistSink,
    ) -> Result<AccountBalanceSnapshot> {
        let selected = wallet.chain_ids.iter().map(String::as_str).collect::<HashSet<_>>();
        let mut holdings = tokens
            .into_iter()
            .filter(|token| !token.id.is_empty())
            .map(token_holding)
            .collect::<Vec<_>>();
        for project in projects {
            for item in &project.portfolio_items {
                let chain_id = project_item_chain_id(&project, item);
                if !chain_id.is_empty() && !selected.contains(chain_id.as_str()) {
                    continue;
                }
                let Some(mut holding) = project_holding(&project, item)? else {
                    continue;
                };
                match self.client.token(&holding.chain_id, &holding.token_id).await {
                    Ok(metadata) => apply_project_metadata(&mut holding, metadata),
                    Err(error) => {
                        tracing::debug!(identifier = holding.identifier.as_str(), %error, "evmchain: project token metadata unavailable");
                    }
                }
                holdings.push(holding);
            }
        }
        let holdings = self.filter_known_or_discoverable_holdings(holdings).await?;
        let balance_usd = Cents::from_dollars(
            holdings
                .iter()
                .filter(|holding| holding.counts_toward_value)
                .map(|holding| holding.value_usd)
                .sum(),
        );
        Ok(AccountBalanceSnapshot {
            account_id,
            wallet_address: wallet.address.to_ascii_lowercase(),
            source: self.source().to_string(),
            date: sink.today().to_owned(),
            synced_at: sink.now().to_rfc3339(),
            balance_usd,
            raw_payload: (!raw_payload.is_empty()).then_some(raw_payload),
            holdings,
            flagged: false,
            flag_reason: String::new(),
        })
    }

    async fn filter_known_or_discoverable_holdings(
        &self,
        holdings: Vec<AssetDailyHolding>,
    ) -> Result<Vec<AssetDailyHolding>> {
        let values = holdings
            .iter()
            .fold(HashMap::<String, f64>::new(), |mut values, holding| {
                *values.entry(holding.identifier.clone()).or_default() += holding.value_usd;
                values
            });
        let mut keep = HashMap::new();
        for (identifier, value_usd) in values {
            let known = if value_usd.abs() >= NEW_ASSET_DUST_THRESHOLD_USD {
                true
            } else {
                let source = AdapterSource {
                    adapter: SyncerId::Debank,
                    source_id: identifier.clone(),
                };
                store::asset_by_adapter_source(&self.pool, &source).await?.is_some()
                    || store::asset_by_key(&self.pool, AssetType::Crypto, &identifier)
                        .await?
                        .is_some()
            };
            keep.insert(identifier, known);
        }
        Ok(holdings
            .into_iter()
            .filter(|holding| keep[holding.identifier.as_str()])
            .collect())
    }
}

impl SyncAdapter for DebankSyncAdapter {
    fn source(&self) -> SyncerId {
        SyncerId::Debank
    }

    fn handles(&self, connection: &ConnectionRef) -> bool {
        connection.source_table == SourceTable::EvmWallets
    }

    fn sync_due<'a>(&'a self, sink: Arc<dyn PersistSink>) -> BoxFuture<'a, Result<()>> {
        Box::pin(async move {
            let wallets = accounts_store::evm_wallets_due_for_balance_sync(&self.pool, sink.now()).await?;
            let cron = store::balance_sync_schedule_cron(&self.pool, self.source())
                .await?
                .ok_or_else(|| anyhow!("balance sync schedule {} not found", self.source()))?;
            let semaphore = Arc::new(tokio::sync::Semaphore::new(WALLET_SYNC_MAX_CONCURRENT));
            let mut tasks = JoinSet::new();
            let wallet_count = wallets.len();
            for (index, wallet) in wallets.into_iter().enumerate() {
                let permit = tokio::select! {
                    _ = self.cancellation.cancelled() => break,
                    permit = Arc::clone(&semaphore).acquire_owned() => permit.context("acquire wallet sync permit")?,
                };
                let adapter = self.clone();
                let sink = Arc::clone(&sink);
                let cron = cron.clone();
                tasks.spawn(async move {
                    let _permit = permit;
                    if let Err(error) = adapter.sync_wallet(&wallet, &cron, sink.as_ref()).await {
                        tracing::error!(address = wallet.address, %error, "evmchain balance sync wallet failed");
                    }
                });
                if index + 1 < wallet_count {
                    tokio::select! {
                        _ = self.cancellation.cancelled() => break,
                        _ = tokio::time::sleep(WALLET_SYNC_STAGGER) => {}
                    }
                }
            }
            while let Some(result) = tasks.join_next().await {
                if let Err(error) = result {
                    tracing::error!(%error, "evmchain wallet sync task failed");
                }
            }
            Ok(())
        })
    }

    fn sync_connection_into<'a>(
        &'a self,
        connection: ConnectionRef,
        sink: &'a dyn PersistSink,
    ) -> BoxFuture<'a, Result<()>> {
        Box::pin(async move {
            let wallet = accounts_store::evm_wallet_by_connection_id(&self.pool, connection.connection_id)
                .await?
                .ok_or_else(|| anyhow!("evm wallet for connection {} not found", connection.connection_id))?;
            let cron = store::balance_sync_schedule_cron(&self.pool, self.source())
                .await?
                .ok_or_else(|| anyhow!("balance sync schedule {} not found", self.source()))?;
            self.sync_wallet(&wallet, &cron, sink).await
        })
    }
}

fn token_holding(token: TokenBalance) -> AssetDailyHolding {
    let symbol = first_non_empty([&token.symbol, &token.optimized_symbol, &token.display_symbol, &token.id]);
    let name = (!token.name.is_empty())
        .then_some(token.name)
        .or_else(|| Some(symbol.clone()));
    let value_usd =
        if token.usd_value_present || token.usd_value != 0.0 { token.usd_value } else { token.amount * token.price };
    holding(HoldingInput {
        line_type: "WALLET_TOKEN",
        identifier: format!("{}:{}", token.chain, token.id),
        chain_id: token.chain,
        token_id: token.id,
        quantity: Some(token.amount),
        value_usd,
        provider_price: (token.price > 0.0).then_some(token.price),
        token_symbol: Some(symbol),
        token_name: name,
        project_name: None,
    })
}

fn project_holding(project: &Project, item: &ProjectItem) -> Result<Option<AssetDailyHolding>> {
    let chain_id = project_item_chain_id(project, item);
    let token_id = first_non_empty([&item.pool.id, &item.pool.controller]);
    if chain_id.is_empty() || token_id.is_empty() {
        return Ok(None);
    }
    ensure!(
        item.stats.net_usd_value_present || item.stats.net_usd_value != 0.0,
        "project {:?} item {:?} missing net_usd_value",
        project.id,
        token_id
    );
    let project_name = first_non_empty([&project.name, &project.id]);
    Ok(Some(holding(HoldingInput {
        line_type: "PROJECT_TOKEN",
        identifier: format!("{chain_id}:{token_id}"),
        chain_id,
        token_id: token_id.clone(),
        quantity: None,
        value_usd: item.stats.net_usd_value,
        provider_price: None,
        token_symbol: Some(project_symbol(item)),
        token_name: Some(project_name.clone()),
        project_name: Some(project_name),
    })))
}

fn project_item_chain_id(project: &Project, item: &ProjectItem) -> String {
    first_non_empty([&project.chain, &item.pool.chain])
}

fn project_symbol(item: &ProjectItem) -> String {
    token_like(&item.detail.description)
        .then(|| item.detail.description.trim().to_owned())
        .or_else(|| {
            let symbols = supplied_token_symbols(item);
            (!symbols.is_empty()).then(|| symbols.join("-"))
        })
        .unwrap_or_else(|| first_non_empty([&item.pool.id, &item.pool.controller]))
}

fn supplied_token_symbols(item: &ProjectItem) -> Vec<String> {
    let mut seen = HashSet::new();
    item.detail
        .supply_token_list
        .iter()
        .filter(|token| {
            !token.symbol.is_empty() && token.amount.is_some() && token.price.is_some() && seen.insert(&token.symbol)
        })
        .map(|token| token.symbol.clone())
        .collect()
}

fn token_like(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty() && !value.contains(' ') && value.len() <= 24
}

fn apply_project_metadata(holding: &mut AssetDailyHolding, metadata: TokenMetadata) {
    let symbol = first_non_empty([
        &metadata.symbol,
        &metadata.optimized_symbol,
        holding.token_symbol.as_deref().unwrap_or_default(),
    ]);
    let name = first_non_empty([
        &metadata.name,
        holding.token_name.as_deref().unwrap_or_default(),
        &symbol,
    ]);
    holding.token_symbol = Some(symbol.clone());
    holding.token_name = Some(name.clone());
    if metadata.price > 0.0 {
        holding.provider_price = Some(metadata.price);
        holding.price = Some(metadata.price);
    }
    let last_price = holding.provider_price.or_else(|| price_from_holding(holding));
    if let Some(asset) = holding.asset.as_mut() {
        asset.name = Some(name);
        asset.last_price = last_price;
        asset.token_symbol = Some(symbol);
        asset.token_name = holding.token_name.clone();
    }
}

struct HoldingInput {
    line_type: &'static str,
    identifier: String,
    chain_id: String,
    token_id: String,
    quantity: Option<f64>,
    value_usd: f64,
    provider_price: Option<f64>,
    token_symbol: Option<String>,
    token_name: Option<String>,
    project_name: Option<String>,
}

fn holding(input: HoldingInput) -> AssetDailyHolding {
    let price = input.provider_price.or_else(|| {
        input
            .quantity
            .filter(|quantity| *quantity != 0.0)
            .map(|quantity| input.value_usd / quantity)
            .filter(|price| price.is_finite() && *price > 0.0)
    });
    let classifier = if stable_symbol(input.token_symbol.as_deref()) {
        AssetClassifier::Stablecoin
    } else {
        AssetClassifier::Cryptocurrency
    };
    let last_price = input.provider_price.or(price);
    AssetDailyHolding {
        asset_id: 0,
        asset: Some(AssetUpsert {
            asset_type: AssetType::Crypto,
            identifier: input.identifier.clone(),
            name: input.token_name.clone().or(input.token_symbol.clone()),
            classifier,
            user_edited: false,
            user_created: false,
            forced_usd_price: None,
            tracking_ticker: None,
            tracking_multiplier: 1.0,
            last_price,
            last_price_at: None,
            adapter_source: Some(AdapterSource {
                adapter: SyncerId::Debank,
                source_id: input.identifier.clone(),
            }),
            plaid_security_type: None,
            cusip: None,
            isin: None,
            simple_fin_cost_basis: None,
            simple_fin_purchase_price: None,
            line_type: Some(input.line_type.to_owned()),
            chain_id: Some(input.chain_id.clone()),
            token_id: Some(input.token_id.clone()),
            token_symbol: input.token_symbol.clone(),
            token_name: input.token_name.clone(),
            project_name: input.project_name.clone(),
            real_estate: None,
        }),
        adapter_source: Some(AdapterSource {
            adapter: SyncerId::Debank,
            source_id: input.identifier.clone(),
        }),
        adapter_sources: Vec::new(),
        price_update: None,
        quantity: input.quantity,
        price,
        value_usd: input.value_usd,
        counts_toward_value: true,
        manual: false,
        line_type: input.line_type.to_owned(),
        chain_id: input.chain_id,
        project_name: input.project_name,
        token_id: input.token_id,
        identifier: input.identifier,
        token_symbol: input.token_symbol,
        token_name: input.token_name,
        provider_price: input.provider_price,
    }
}

fn price_from_holding(holding: &AssetDailyHolding) -> Option<f64> {
    holding
        .quantity
        .filter(|quantity| *quantity != 0.0)
        .map(|quantity| holding.value_usd / quantity)
        .filter(|price| price.is_finite() && *price > 0.0)
}

fn stable_symbol(symbol: Option<&str>) -> bool {
    symbol.is_some_and(|symbol| {
        !symbol.is_empty()
            && symbol.split(['-', '/', '_']).all(|part| {
                ["USDT0", "MSUSD", "USDC", "USDT", "AUSD", "DAI"]
                    .iter()
                    .any(|suffix| part.to_ascii_uppercase().ends_with(suffix))
            })
    })
}

fn first_non_empty<const N: usize>(values: [&str; N]) -> String {
    values
        .into_iter()
        .find(|value| !value.is_empty())
        .unwrap_or_default()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use crate::{
        accounts::EvmWallet,
        clients::debank::{
            Debank, Project, ProjectDetail, ProjectItem, ProjectPool, ProjectStats, ProjectSupplyToken, TokenBalance,
        },
        database::dbtest,
        utils::future::BoxFuture,
        wealth::{PersistEvent, PersistSink},
    };
    use chrono::{DateTime, TimeZone, Utc};
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path, query_param},
    };

    use super::{DebankSyncAdapter, project_holding, stable_symbol, token_holding};

    #[test]
    fn maps_wallet_tokens_and_stablecoin_symbols() {
        let holding = token_holding(TokenBalance {
            chain: "base".to_owned(),
            id: "0xtoken".to_owned(),
            optimized_symbol: "USDC".to_owned(),
            amount: 2.0,
            price: 1.0,
            ..Default::default()
        });
        assert_eq!(holding.identifier, "base:0xtoken");
        assert_eq!(holding.token_symbol.as_deref(), Some("USDC"));
        assert_eq!(holding.value_usd, 2.0);
        assert!(stable_symbol(Some("USDC-DAI")));
        assert!(!stable_symbol(Some("USDC-ETH")));
    }

    #[test]
    fn classifies_the_full_stablecoin_symbol_table() {
        for (symbol, stable) in [
            ("USDC", true),
            ("USDT0-AUSD", true),
            ("msUSD-USDC", true),
            ("mooBalancerMonadwnUSDT0-wnAUSD-wnUSDC", true),
            ("ETH", false),
            ("rETH", false),
            ("USDC-PENDLE", false),
            ("", false),
        ] {
            assert_eq!(stable_symbol(Some(symbol)), stable, "{symbol}");
        }
    }

    #[test]
    fn maps_project_fallbacks_without_synthetic_quantity_or_price() {
        let holding = project_holding(
            &Project {
                chain: "base".to_owned(),
                id: "project".to_owned(),
                ..Default::default()
            },
            &ProjectItem {
                pool: ProjectPool {
                    controller: "0xcontroller".to_owned(),
                    ..Default::default()
                },
                detail: ProjectDetail {
                    description: "LP position with a long description".to_owned(),
                    supply_token_list: vec![
                        ProjectSupplyToken {
                            symbol: "ETH".to_owned(),
                            amount: Some(1.0),
                            price: Some(2.0),
                        },
                        ProjectSupplyToken {
                            symbol: "USDC".to_owned(),
                            amount: Some(2.0),
                            price: Some(1.0),
                        },
                    ],
                },
                stats: ProjectStats {
                    net_usd_value: 12.0,
                    net_usd_value_present: true,
                },
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(holding.identifier, "base:0xcontroller");
        assert_eq!(holding.project_name.as_deref(), Some("project"));
        assert_eq!(holding.token_symbol.as_deref(), Some("ETH-USDC"));
        assert_eq!(holding.quantity, None);
        assert_eq!(holding.price, None);
        assert_eq!(holding.provider_price, None);
    }

    #[test]
    fn ignores_incomplete_projects_and_rejects_selected_items_without_a_value() {
        let project = Project {
            chain: "eth".to_owned(),
            ..Default::default()
        };
        assert!(project_holding(&project, &ProjectItem::default()).unwrap().is_none());
        assert!(
            project_holding(
                &project,
                &ProjectItem {
                    pool: ProjectPool {
                        id: "0xpool".to_owned(),
                        ..Default::default()
                    },
                    ..Default::default()
                }
            )
            .is_err()
        );
    }

    #[tokio::test]
    async fn drops_unknown_dust_but_keeps_the_threshold_value() -> anyhow::Result<()> {
        let pool = dbtest::open().await?;
        let adapter = DebankSyncAdapter::with_client(pool, Debank::with_base_url("http://localhost")?);
        let holdings = [
            TokenBalance {
                chain: "eth".to_owned(),
                id: "dust".to_owned(),
                amount: 1.0,
                price: 0.04,
                usd_value: 0.04,
                usd_value_present: true,
                ..Default::default()
            },
            TokenBalance {
                chain: "eth".to_owned(),
                id: "kept".to_owned(),
                amount: 1.0,
                price: 0.05,
                usd_value: 0.05,
                usd_value_present: true,
                ..Default::default()
            },
        ]
        .into_iter()
        .map(token_holding)
        .collect();

        assert_eq!(
            adapter
                .filter_known_or_discoverable_holdings(holdings)
                .await?
                .iter()
                .map(|holding| holding.identifier.as_str())
                .collect::<Vec<_>>(),
            ["eth:kept"]
        );
        Ok(())
    }

    #[tokio::test]
    async fn fetches_only_selected_chains_and_ignores_malformed_unselected_projects() -> anyhow::Result<()> {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/token/balance_list"))
            .and(query_param("chain", "eth"))
            .respond_with(ResponseTemplate::new(200).set_body_string(r#"{"data":[]}"#))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/portfolio/project_list"))
            .respond_with(ResponseTemplate::new(200).set_body_string(r#"{"data":[]}"#))
            .mount(&server)
            .await;
        let pool = dbtest::open().await?;
        let adapter = DebankSyncAdapter::with_client(pool, Debank::with_base_url(server.uri())?);
        let wallet = wallet(&["eth"]);
        let wallet_tokens = adapter.wallet_tokens(&wallet).await?;
        assert!(wallet_tokens.tokens.is_empty());
        assert!(wallet_tokens.projects.is_empty());

        let sink = FixedSink {
            now: Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
        };
        let malformed = Project {
            chain: "base".to_owned(),
            portfolio_items: vec![ProjectItem {
                pool: ProjectPool {
                    id: "0xpool".to_owned(),
                    ..Default::default()
                },
                ..Default::default()
            }],
            ..Default::default()
        };
        assert!(
            adapter
                .build_snapshot(1, &wallet, Vec::new(), vec![malformed], String::new(), &sink)
                .await?
                .holdings
                .is_empty()
        );
        Ok(())
    }

    #[tokio::test]
    async fn aborts_malformed_selected_projects_and_accepts_empty_wallets() -> anyhow::Result<()> {
        let pool = dbtest::open().await?;
        let adapter = DebankSyncAdapter::with_client(pool, Debank::with_base_url("http://localhost")?);
        let sink = FixedSink {
            now: Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
        };
        let malformed = Project {
            chain: "eth".to_owned(),
            portfolio_items: vec![ProjectItem {
                pool: ProjectPool {
                    id: "0xpool".to_owned(),
                    ..Default::default()
                },
                ..Default::default()
            }],
            ..Default::default()
        };
        assert!(
            adapter
                .build_snapshot(1, &wallet(&["eth"]), Vec::new(), vec![malformed], String::new(), &sink)
                .await
                .is_err()
        );
        assert_eq!(
            adapter
                .build_snapshot(1, &wallet(&[]), Vec::new(), Vec::new(), String::new(), &sink)
                .await?
                .balance_usd,
            crate::money::Cents::default()
        );
        Ok(())
    }

    struct FixedSink {
        now: DateTime<Utc>,
    }

    impl PersistSink for FixedSink {
        fn now(&self) -> DateTime<Utc> {
            self.now
        }

        fn today(&self) -> &str {
            "2026-09-06"
        }

        fn persist<'a>(&'a self, _: PersistEvent) -> BoxFuture<'a, anyhow::Result<()>> {
            Box::pin(async { Ok(()) })
        }
    }

    fn wallet(chain_ids: &[&str]) -> EvmWallet {
        EvmWallet {
            id: 1,
            address: "0xabc".to_owned(),
            chain_ids: chain_ids.iter().map(ToString::to_string).collect(),
            owner_id: 1,
            label: String::new(),
            created_at: Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
            next_balance_sync_at: None,
        }
    }
}
