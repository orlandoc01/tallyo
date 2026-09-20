use std::str::FromStr;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    accounts::{Account, AccountType},
    ids::Date,
    money::Cents,
    schema::AssetClassifier,
};

use super::{Asset, AssetUpdate, AssetUpsert, SyncerId};

pub use crate::schema::{
    AccountSnapshot, AccountSnapshotConnection, AccountSnapshotEdge, BalanceSnapshotReview, LinkRealEstatePayload,
    PageInfo, RealEstateAssetDetails,
};

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct AdapterSource {
    #[serde(rename = "Adapter")]
    pub adapter: SyncerId,
    #[serde(rename = "SourceID")]
    pub source_id: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CurrentHolding {
    pub account: Account,
    pub asset: Asset,
    pub quantity: Option<f64>,
    pub value_usd: Cents,
    pub manual: bool,
    pub snapshot_date: Date,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AccountBalanceSnapshot {
    pub account_id: i64,
    pub wallet_address: String,
    pub source: String,
    pub date: String,
    pub synced_at: String,
    pub balance_usd: Cents,
    pub raw_payload: Option<String>,
    pub holdings: Vec<AssetDailyHolding>,
    pub flagged: bool,
    pub flag_reason: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BalanceReviewUpsert {
    pub account_id: i64,
    pub first_flagged_date: String,
    pub latest_flagged_date: String,
    pub flagged_snapshot_count: i32,
    pub provider_balance_usd: Cents,
    pub carry_forward_balance_usd: Cents,
    pub flag_reason: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ApprovedBalanceReview {
    pub provider_balance_usd: Cents,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BalanceReviewProviderHolding {
    pub asset_id: i64,
    pub asset: Option<AssetUpsert>,
    pub price_update: Option<AssetUpdate>,
    pub quantity: Option<f64>,
    pub price: Option<f64>,
    pub value_usd: f64,
    pub counts_toward_value: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LastUnflaggedBalanceResult {
    pub found: bool,
    pub amount_usd: Cents,
    pub date: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LastUnflaggedSnapshotResult {
    pub found: bool,
    pub amount_usd: Cents,
    pub date: String,
    pub holdings: Vec<AssetDailyHolding>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AssetDailyHolding {
    pub asset_id: i64,
    pub asset: Option<AssetUpsert>,
    pub adapter_source: Option<AdapterSource>,
    pub adapter_sources: Vec<AdapterSource>,
    pub price_update: Option<AssetUpdate>,
    pub quantity: Option<f64>,
    pub price: Option<f64>,
    pub value_usd: f64,
    pub counts_toward_value: bool,
    pub manual: bool,
    pub line_type: String,
    pub chain_id: String,
    pub project_name: Option<String>,
    pub token_id: String,
    pub identifier: String,
    pub token_symbol: Option<String>,
    pub token_name: Option<String>,
    pub provider_price: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotValue {
    pub account_id: i64,
    pub account_type: AccountType,
    pub account_manual: bool,
    pub account_subtype: Option<String>,
    pub account_closed: bool,
    pub synced_at: DateTime<Utc>,
    pub balance_usd: Cents,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ClassifierSnapshotValue {
    pub account_id: i64,
    pub account_closed: bool,
    pub synced_at: DateTime<Utc>,
    pub classifier: AssetClassifier,
    pub value_usd: Cents,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotTimestampRange {
    pub earliest: Option<DateTime<Utc>>,
    pub latest: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotRow {
    pub id: i64,
    pub account_id: i64,
    pub source: String,
    pub date: String,
    pub synced_at: DateTime<Utc>,
    pub balance_usd: Cents,
    pub flagged: bool,
    pub account_type: AccountType,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotHolding {
    pub asset: Asset,
    pub quantity: Option<f64>,
    pub price: Option<f64>,
    pub value_usd: Cents,
    pub counts_toward_value: bool,
    pub manual: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotEdit {
    pub id: i64,
    pub account_id: i64,
    pub date: String,
    pub balance_usd: Cents,
    pub holdings: Vec<SnapshotEditHolding>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotEditHolding {
    pub asset_id: i64,
    pub quantity: Option<f64>,
    pub price: Option<f64>,
    pub value_usd: Cents,
    pub counts_toward_value: bool,
    pub manual: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ChangeAccountSnapshotResult {
    pub snapshot: AccountSnapshot,
    pub account: Account,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize)]
pub struct RealEstateDetails {
    #[serde(rename = "Street")]
    pub street: Option<String>,
    #[serde(rename = "City")]
    pub city: Option<String>,
    #[serde(rename = "State")]
    pub state: Option<String>,
    #[serde(rename = "ZIP")]
    pub zip: Option<String>,
    #[serde(rename = "HomeType")]
    pub home_type: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct AssetUpsertJson {
    #[serde(rename = "AssetType")]
    asset_type: String,
    #[serde(rename = "Identifier")]
    identifier: String,
    #[serde(rename = "Name")]
    name: Option<String>,
    #[serde(rename = "Classifier")]
    classifier: String,
    #[serde(rename = "UserEdited")]
    user_edited: bool,
    #[serde(rename = "UserCreated")]
    user_created: bool,
    #[serde(rename = "ForcedUSDPrice")]
    forced_usd_price: Option<f64>,
    #[serde(rename = "TrackingTicker")]
    tracking_ticker: Option<String>,
    #[serde(rename = "TrackingMultiplier")]
    tracking_multiplier: f64,
    #[serde(rename = "LastPrice")]
    last_price: Option<f64>,
    #[serde(rename = "LastPriceAt")]
    last_price_at: Option<DateTime<Utc>>,
    #[serde(rename = "AdapterSource")]
    adapter_source: Option<AdapterSource>,
    #[serde(rename = "PlaidSecurityType")]
    plaid_security_type: Option<String>,
    #[serde(rename = "CUSIP")]
    cusip: Option<String>,
    #[serde(rename = "ISIN")]
    isin: Option<String>,
    #[serde(rename = "SimpleFinCostBasis")]
    simple_fin_cost_basis: Option<String>,
    #[serde(rename = "SimpleFinPurchasePrice")]
    simple_fin_purchase_price: Option<String>,
    #[serde(rename = "LineType")]
    line_type: Option<String>,
    #[serde(rename = "ChainID")]
    chain_id: Option<String>,
    #[serde(rename = "TokenID")]
    token_id: Option<String>,
    #[serde(rename = "TokenSymbol")]
    token_symbol: Option<String>,
    #[serde(rename = "TokenName")]
    token_name: Option<String>,
    #[serde(rename = "ProjectName")]
    project_name: Option<String>,
    #[serde(rename = "RealEstate")]
    real_estate: Option<RealEstateDetails>,
}

impl From<&AssetUpsert> for AssetUpsertJson {
    fn from(asset: &AssetUpsert) -> Self {
        Self {
            asset_type: asset.asset_type.to_string(),
            identifier: asset.identifier.clone(),
            name: asset.name.clone(),
            classifier: asset.classifier.to_string(),
            user_edited: asset.user_edited,
            user_created: asset.user_created,
            forced_usd_price: asset.forced_usd_price,
            tracking_ticker: asset.tracking_ticker.clone(),
            tracking_multiplier: asset.tracking_multiplier,
            last_price: asset.last_price,
            last_price_at: asset.last_price_at,
            adapter_source: asset.adapter_source.clone(),
            plaid_security_type: asset.plaid_security_type.clone(),
            cusip: asset.cusip.clone(),
            isin: asset.isin.clone(),
            simple_fin_cost_basis: asset.simple_fin_cost_basis.clone(),
            simple_fin_purchase_price: asset.simple_fin_purchase_price.clone(),
            line_type: asset.line_type.clone(),
            chain_id: asset.chain_id.clone(),
            token_id: asset.token_id.clone(),
            token_symbol: asset.token_symbol.clone(),
            token_name: asset.token_name.clone(),
            project_name: asset.project_name.clone(),
            real_estate: asset.real_estate.clone(),
        }
    }
}

impl TryFrom<AssetUpsertJson> for AssetUpsert {
    type Error = anyhow::Error;

    fn try_from(asset: AssetUpsertJson) -> Result<Self> {
        Ok(Self {
            asset_type: crate::schema::AssetType::from_str(&asset.asset_type)
                .with_context(|| format!("parse asset type {:?}", asset.asset_type))?,
            identifier: asset.identifier,
            name: asset.name,
            classifier: crate::schema::AssetClassifier::from_str(&asset.classifier)
                .with_context(|| format!("parse asset classifier {:?}", asset.classifier))?,
            user_edited: asset.user_edited,
            user_created: asset.user_created,
            forced_usd_price: asset.forced_usd_price,
            tracking_ticker: asset.tracking_ticker,
            tracking_multiplier: asset.tracking_multiplier,
            last_price: asset.last_price,
            last_price_at: asset.last_price_at,
            adapter_source: asset.adapter_source,
            plaid_security_type: asset.plaid_security_type,
            cusip: asset.cusip,
            isin: asset.isin,
            simple_fin_cost_basis: asset.simple_fin_cost_basis,
            simple_fin_purchase_price: asset.simple_fin_purchase_price,
            line_type: asset.line_type,
            chain_id: asset.chain_id,
            token_id: asset.token_id,
            token_symbol: asset.token_symbol,
            token_name: asset.token_name,
            project_name: asset.project_name,
            real_estate: asset.real_estate,
        })
    }
}

#[derive(Deserialize, Serialize)]
struct BalanceReviewProviderHoldingJson {
    asset_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    asset: Option<AssetUpsertJson>,
    #[serde(skip_serializing_if = "Option::is_none")]
    price_update: Option<AssetUpdate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quantity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    price: Option<f64>,
    value_usd: f64,
    counts_toward_value: bool,
}

pub fn marshal_balance_review_provider_holdings(holdings: &[AssetDailyHolding]) -> Result<String> {
    serde_json::to_string(
        &holdings
            .iter()
            .map(|holding| BalanceReviewProviderHoldingJson {
                asset_id: holding.asset_id.to_string(),
                asset: holding.asset.as_ref().map(AssetUpsertJson::from),
                price_update: holding.price_update.clone(),
                quantity: holding.quantity,
                price: holding.price,
                value_usd: holding.value_usd,
                counts_toward_value: holding.counts_toward_value,
            })
            .collect::<Vec<_>>(),
    )
    .context("marshal balance review provider holdings")
}

pub fn balance_review_provider_holdings_from_json(raw: Option<&str>) -> Result<Vec<BalanceReviewProviderHolding>> {
    let Some(raw) = raw.filter(|raw| !raw.is_empty()) else {
        return Ok(Vec::new());
    };
    serde_json::from_str::<Vec<BalanceReviewProviderHoldingJson>>(raw)
        .context("decode balance review provider holdings")?
        .into_iter()
        .map(|holding| {
            Ok(BalanceReviewProviderHolding {
                asset_id: holding
                    .asset_id
                    .parse()
                    .with_context(|| format!("parse provider asset id {:?}", holding.asset_id))?,
                asset: holding.asset.map(AssetUpsert::try_from).transpose()?,
                price_update: holding.price_update,
                quantity: holding.quantity,
                price: holding.price,
                value_usd: holding.value_usd,
                counts_toward_value: holding.counts_toward_value,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::{
        AdapterSource, AssetDailyHolding, balance_review_provider_holdings_from_json,
        marshal_balance_review_provider_holdings,
    };
    use crate::{
        schema::{AssetClassifier, AssetType},
        wealth::{AssetUpsert, SyncerId},
    };

    #[test]
    fn provider_holdings_json_uses_the_existing_storage_shape() -> Result<()> {
        let raw = marshal_balance_review_provider_holdings(&[AssetDailyHolding {
            asset_id: 42,
            asset: Some(AssetUpsert {
                asset_type: AssetType::Crypto,
                identifier: "base:0xtoken".to_owned(),
                name: Some("Provider Token".to_owned()),
                classifier: AssetClassifier::Stablecoin,
                user_edited: false,
                user_created: false,
                forced_usd_price: None,
                tracking_ticker: None,
                tracking_multiplier: 0.0,
                last_price: None,
                last_price_at: None,
                adapter_source: Some(AdapterSource {
                    adapter: SyncerId::Debank,
                    source_id: "base:0xtoken".to_owned(),
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
            }),
            adapter_source: Some(AdapterSource {
                adapter: SyncerId::Debank,
                source_id: "base:0xtoken".to_owned(),
            }),
            adapter_sources: Vec::new(),
            price_update: None,
            quantity: Some(2.0),
            price: Some(25.0),
            value_usd: 50.0,
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
        }])?;

        assert!(raw.contains(r#""asset_id":"42""#));
        assert!(raw.contains(r#""value_usd":50.0"#));
        assert!(raw.contains(r#""AssetType":"CRYPTO""#));
        assert!(raw.contains(r#""Adapter":"debank""#));
        let holdings = balance_review_provider_holdings_from_json(Some(&raw))?;
        assert_eq!(holdings.len(), 1);
        assert_eq!(holdings[0].asset_id, 42);
        assert_eq!(holdings[0].quantity, Some(2.0));
        assert_eq!(
            holdings[0].asset.as_ref().map(|asset| asset.identifier.as_str()),
            Some("base:0xtoken")
        );
        assert!(balance_review_provider_holdings_from_json(None)?.is_empty());
        assert!(balance_review_provider_holdings_from_json(Some("{")).is_err());
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct RealEstate {
    pub asset_id: i64,
    pub account_id: i64,
    pub connection_id: i64,
    pub owner_id: i64,
    pub name: String,
    pub details: RealEstateDetails,
}
