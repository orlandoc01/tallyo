use std::sync::Arc;

use anyhow::{Context, Result, anyhow, ensure};
use chrono::{DateTime, TimeZone, Utc};
use sqlx::SqlitePool;

use crate::{
    accounts::{AccountType, SimpleFinTokenSecretKind, SourceTable, store as accounts_store},
    clients::simplefin::{GetAccountsOpts, SimpleFinAccount, SimpleFinClient, SimpleFinHolding},
    money::Cents,
    schema::{AssetClassifier, AssetType},
    utils::future::BoxFuture,
    wealth::{
        AccountBalanceSnapshot, AdapterSource, AssetDailyHolding, AssetUpsert, ConnectionRef, PersistSink, SyncAdapter,
        SyncerId, flagging, next_balance_sync_after, store,
    },
};

pub struct SimpleFinSyncAdapter {
    pool: SqlitePool,
    client: SimpleFinClient,
}

impl SimpleFinSyncAdapter {
    pub fn with_client(pool: SqlitePool, client: SimpleFinClient) -> Self {
        Self { pool, client }
    }

    async fn sync_token(&self, token_id: i64, access_url: &str, sink: &dyn PersistSink) -> Result<()> {
        let cron = store::balance_sync_schedule_cron(&self.pool, self.source())
            .await?
            .ok_or_else(|| anyhow!("balance sync schedule {} not found", self.source()))?;
        let next_sync_at = next_balance_sync_after(&cron, sink.now())?;
        let accounts = self
            .client
            .get_accounts(access_url, GetAccountsOpts::default())
            .await
            .context("simplefin accounts get")?;
        let synced_at = sink.now();
        let usd = store::asset_by_id(&self.pool, 1)
            .await?
            .ok_or_else(|| anyhow!("USD asset not found"))?;
        for account in &accounts.accounts {
            let persisted = accounts_store::account_by_external_id(&self.pool, &account.id)
                .await?
                .ok_or_else(|| anyhow!("lookup account {}: not found", account.id))?;
            let snapshot = if account.holdings.is_empty() {
                balance_snapshot(
                    account,
                    persisted.r#type,
                    persisted.id,
                    usd.id,
                    &usd.identifier,
                    sink,
                    synced_at,
                )?
            } else {
                investment_snapshot(account, persisted.id, usd.id, &usd.identifier, sink, synced_at)?
            };
            flagging::emit_with_price_check(&self.pool, sink, snapshot).await?;
        }
        accounts_store::set_simple_fin_token_balance_synced(&self.pool, token_id, next_sync_at).await
    }
}

impl SyncAdapter for SimpleFinSyncAdapter {
    fn source(&self) -> SyncerId {
        SyncerId::Simplefin
    }

    fn handles(&self, connection: &ConnectionRef) -> bool {
        connection.source_table == SourceTable::SimpleFinConnections
    }

    fn sync_due<'a>(&'a self, sink: Arc<dyn PersistSink>) -> BoxFuture<'a, Result<()>> {
        Box::pin(async move {
            for token in
                accounts_store::simple_fin_token_secrets_due(&self.pool, SimpleFinTokenSecretKind::Balance, sink.now())
                    .await?
            {
                if let Err(error) = self.sync_token(token.id, &token.access_url, sink.as_ref()).await {
                    tracing::error!(token_id = token.id, %error, "simplefin balance sync token failed");
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
            let token = accounts_store::simple_fin_token_secret_by_conn_id(&self.pool, connection.source_id)
                .await?
                .ok_or_else(|| anyhow!("simplefin connection {} not found", connection.source_id))?;
            self.sync_token(token.id, &token.access_url, sink).await
        })
    }
}

fn balance_snapshot(
    account: &SimpleFinAccount,
    account_type: AccountType,
    account_id: i64,
    usd_id: i64,
    usd_identifier: &str,
    sink: &dyn PersistSink,
    synced_at: DateTime<Utc>,
) -> Result<AccountBalanceSnapshot> {
    let mut balance =
        simplefin_money(&account.balance).with_context(|| format!("parse simplefin balance for {}", account.id))?;
    if account_type == AccountType::Credit || account_type == AccountType::Loan {
        balance = -balance;
    }
    Ok(snapshot(
        account_id,
        Cents::from_dollars_checked(balance).with_context(|| format!("parse simplefin balance for {}", account.id))?,
        vec![AssetDailyHolding {
            asset_id: usd_id,
            asset: None,
            adapter_source: None,
            adapter_sources: Vec::new(),
            price_update: None,
            quantity: Some(balance),
            price: Some(1.0),
            value_usd: balance,
            counts_toward_value: true,
            manual: false,
            line_type: String::new(),
            chain_id: String::new(),
            project_name: None,
            token_id: String::new(),
            identifier: usd_identifier.to_owned(),
            token_symbol: None,
            token_name: None,
            provider_price: None,
        }],
        raw_payload(account)?,
        sink,
        synced_at,
    ))
}

fn investment_snapshot(
    account: &SimpleFinAccount,
    account_id: i64,
    usd_id: i64,
    usd_identifier: &str,
    sink: &dyn PersistSink,
    synced_at: DateTime<Utc>,
) -> Result<AccountBalanceSnapshot> {
    let balance =
        simplefin_money(&account.balance).with_context(|| format!("parse simplefin balance for {}", account.id))?;
    let mut holdings = account
        .holdings
        .iter()
        .map(|holding| holding_line(holding, balance_time(account, synced_at)))
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    let held_value = holdings.iter().map(|holding| holding.value_usd).sum::<f64>();
    let residual = balance - held_value;
    if residual > 0.01 {
        holdings.push(AssetDailyHolding {
            asset_id: usd_id,
            asset: None,
            adapter_source: None,
            adapter_sources: Vec::new(),
            price_update: None,
            quantity: Some(residual),
            price: Some(1.0),
            value_usd: residual,
            counts_toward_value: true,
            manual: false,
            line_type: String::new(),
            chain_id: String::new(),
            project_name: None,
            token_id: String::new(),
            identifier: usd_identifier.to_owned(),
            token_symbol: None,
            token_name: None,
            provider_price: None,
        });
    }
    let balance_usd = Cents::from_dollars_checked(holdings.iter().map(|holding| holding.value_usd).sum())
        .with_context(|| format!("parse simplefin investment balance for {}", account.id))?;
    Ok(snapshot(
        account_id,
        balance_usd,
        holdings,
        raw_payload(account)?,
        sink,
        synced_at,
    ))
}

fn holding_line(holding: &SimpleFinHolding, price_at: DateTime<Utc>) -> Result<Option<AssetDailyHolding>> {
    let shares = simplefin_amount(&holding.shares)?;
    let value_usd = simplefin_money(&holding.market_value)?;
    if shares == 0.0 || value_usd == 0.0 {
        return Ok(None);
    }
    let price = value_usd / shares;
    Cents::from_dollars_checked(price)
        .with_context(|| format!("simplefin holding {} has an invalid price", holding.id))?;
    let symbol = holding.symbol.trim().to_ascii_uppercase();
    let identifier = identifier_for_holding(&symbol, holding);
    let adapter_source = adapter_source_for_holding(&holding.id);
    Ok(Some(AssetDailyHolding {
        asset_id: 0,
        asset: Some(AssetUpsert {
            asset_type: AssetType::Security,
            identifier: identifier.clone(),
            name: (!holding.description.trim().is_empty()).then(|| holding.description.trim().to_owned()),
            classifier: classifier_for_holding(&symbol, &holding.description),
            user_edited: false,
            user_created: false,
            forced_usd_price: None,
            tracking_ticker: None,
            tracking_multiplier: 1.0,
            last_price: Some(price),
            last_price_at: Some(price_at),
            adapter_source: adapter_source.clone(),
            plaid_security_type: None,
            cusip: None,
            isin: None,
            simple_fin_cost_basis: (!holding.cost_basis.is_empty()).then(|| holding.cost_basis.clone()),
            simple_fin_purchase_price: (!holding.purchase_price.is_empty()).then(|| holding.purchase_price.clone()),
            line_type: None,
            chain_id: None,
            token_id: None,
            token_symbol: None,
            token_name: None,
            project_name: None,
            real_estate: None,
        }),
        adapter_source,
        adapter_sources: Vec::new(),
        price_update: None,
        quantity: Some(shares),
        price: Some(price),
        value_usd,
        counts_toward_value: true,
        manual: false,
        line_type: String::new(),
        chain_id: String::new(),
        project_name: None,
        token_id: String::new(),
        identifier,
        token_symbol: None,
        token_name: None,
        provider_price: Some(price),
    }))
}

fn snapshot(
    account_id: i64,
    balance_usd: Cents,
    holdings: Vec<AssetDailyHolding>,
    raw_payload: String,
    sink: &dyn PersistSink,
    synced_at: DateTime<Utc>,
) -> AccountBalanceSnapshot {
    AccountBalanceSnapshot {
        account_id,
        wallet_address: String::new(),
        source: SyncerId::Simplefin.to_string(),
        date: sink.today().to_owned(),
        synced_at: synced_at.to_rfc3339(),
        balance_usd,
        raw_payload: Some(raw_payload),
        holdings,
        flagged: false,
        flag_reason: String::new(),
    }
}

fn simplefin_amount(value: &str) -> Result<f64> {
    let value = value.trim();
    let value: f64 = if value.is_empty() { 0.0 } else { value.parse().context("parse simplefin amount")? };
    ensure!(value.is_finite(), "parse simplefin amount: not a finite number");
    Ok(value)
}

fn simplefin_money(value: &str) -> Result<f64> {
    let value = simplefin_amount(value)?;
    Cents::from_dollars_checked(value).context("parse simplefin money")?;
    Ok(value)
}

fn identifier_for_holding(symbol: &str, holding: &SimpleFinHolding) -> String {
    if !symbol.is_empty() {
        return symbol.to_owned();
    }
    let id = holding.id.trim();
    if !id.is_empty() {
        return format!("simplefin:{id}");
    }
    let slug = slugify(&holding.description);
    if slug.is_empty() { "simplefin:unknown-holding".to_owned() } else { format!("simplefin:{slug}") }
}

fn adapter_source_for_holding(id: &str) -> Option<AdapterSource> {
    let id = id.trim();
    (!id.is_empty()).then(|| AdapterSource {
        adapter: SyncerId::Simplefin,
        source_id: id.to_owned(),
    })
}

fn classifier_for_holding(symbol: &str, description: &str) -> AssetClassifier {
    let description = format!("{symbol}{description}")
        .to_ascii_lowercase()
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>();
    if ["SPAXX", "FDRXX", "FFLDX"].contains(&symbol)
        || [
            "moneymarket",
            "cashreserve",
            "cashreserves",
            "govcash",
            "govtcash",
            "governmentcash",
            "treasurymoney",
        ]
        .iter()
        .any(|term| description.contains(term))
    {
        AssetClassifier::Cash
    } else {
        AssetClassifier::Public
    }
}

fn balance_time(account: &SimpleFinAccount, fallback: DateTime<Utc>) -> DateTime<Utc> {
    (account.balance_date != 0)
        .then(|| Utc.timestamp_opt(account.balance_date, 0).single())
        .flatten()
        .unwrap_or(fallback)
}

fn raw_payload(account: &SimpleFinAccount) -> Result<String> {
    serde_json::to_string(account).context("marshal simplefin account payload")
}

fn slugify(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .fold((String::new(), false), |(mut slug, last_dash), character| {
            if character.is_alphanumeric() {
                slug.push(character);
                (slug, false)
            } else if slug.is_empty() || last_dash {
                (slug, last_dash)
            } else {
                slug.push('-');
                (slug, true)
            }
        })
        .0
        .trim_end_matches('-')
        .to_owned()
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use crate::{clients::simplefin::SimpleFinHolding, schema::AssetClassifier, utils::future::BoxFuture};

    use super::*;

    #[test]
    fn parses_simplefin_values_and_stably_identifies_holdings() {
        for (value, money, expected) in [
            ("", false, Some(0.0)),
            (" 1e2 ", false, Some(100.0)),
            ("NaN", false, None),
            ("Inf", false, None),
            ("-Inf", false, None),
            ("12.345", true, Some(12.345)),
            ("1e300", true, None),
        ] {
            let result = if money { simplefin_money(value) } else { simplefin_amount(value) };
            assert_eq!(result.ok(), expected, "{value}");
        }

        for (holding, expected) in [
            (
                SimpleFinHolding {
                    id: "id".to_owned(),
                    ..Default::default()
                },
                "simplefin:id",
            ),
            (
                SimpleFinHolding {
                    description: "Private Fund".to_owned(),
                    ..Default::default()
                },
                "simplefin:private-fund",
            ),
            (SimpleFinHolding::default(), "simplefin:unknown-holding"),
        ] {
            assert_eq!(identifier_for_holding("", &holding), expected);
        }
        assert_eq!(classifier_for_holding("", "Money Market Fund"), AssetClassifier::Cash);
        assert_eq!(classifier_for_holding("", "Gov cash"), AssetClassifier::Cash);
    }

    #[test]
    fn maps_balances_and_investment_holdings() {
        let now = Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap();
        let sink = TestSink { now };
        let usd = "USD";
        let credit = balance_snapshot(
            &SimpleFinAccount {
                id: "credit".to_owned(),
                balance: "-42.50".to_owned(),
                ..Default::default()
            },
            AccountType::Credit,
            1,
            1,
            usd,
            &sink,
            now,
        )
        .unwrap();
        assert_eq!(credit.balance_usd, Cents(4250));

        let investment = investment_snapshot(
            &SimpleFinAccount {
                id: "investment".to_owned(),
                balance: "15".to_owned(),
                balance_date: 1_700_000_000,
                holdings: vec![
                    SimpleFinHolding {
                        id: "vti".to_owned(),
                        symbol: "VTI".to_owned(),
                        description: "Index Fund".to_owned(),
                        shares: "2".to_owned(),
                        market_value: "10".to_owned(),
                        ..Default::default()
                    },
                    SimpleFinHolding {
                        id: "closed".to_owned(),
                        shares: "0".to_owned(),
                        market_value: "0".to_owned(),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            },
            2,
            1,
            usd,
            &sink,
            now,
        )
        .unwrap();
        assert_eq!(investment.balance_usd, Cents(1500));
        assert_eq!(investment.holdings.len(), 2);
        assert_eq!(
            investment.holdings[0].asset.as_ref().unwrap().last_price_at,
            Utc.timestamp_opt(1_700_000_000, 0).single()
        );
        assert_eq!(investment.holdings[1].identifier, "USD");
    }

    #[test]
    fn rejects_infinite_holding_prices() {
        assert!(
            holding_line(
                &SimpleFinHolding {
                    shares: f64::MIN_POSITIVE.to_string(),
                    market_value: "1".to_owned(),
                    ..Default::default()
                },
                Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap()
            )
            .is_err()
        );
    }

    struct TestSink {
        now: chrono::DateTime<Utc>,
    }

    impl PersistSink for TestSink {
        fn now(&self) -> chrono::DateTime<Utc> {
            self.now
        }

        fn today(&self) -> &str {
            "2026-09-06"
        }

        fn persist<'a>(&'a self, _: crate::wealth::PersistEvent) -> BoxFuture<'a, anyhow::Result<()>> {
            Box::pin(async { Ok(()) })
        }
    }
}
