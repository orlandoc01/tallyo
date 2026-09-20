use std::sync::Arc;

use chrono::{DateTime, Utc};

use crate::{
    money::Cents,
    schema::{AssetClassifier, AssetType},
    utils::future::BoxFuture,
};

use super::{LastUnflaggedBalanceResult, SyncerId};

pub use crate::schema::{
    Address, Asset, AssetAdapterSource, AssetDetails, AssetQuote, AssetSnapshot, ClassifierBreakdown,
    ClassifierHistoryPoint, HistoricalNetWorthReport, Holding, HoldingRollup, LiabilityAccountBalance,
    LiabilityBreakdown, LiabilityHistoryPoint, NetWorthPoint, NetWorthReport,
};

#[derive(Clone, Debug, PartialEq)]
pub struct AssetRecord {
    pub asset: Asset,
    pub address: Option<Address>,
    pub security: Option<SecurityAssetDetails>,
    pub crypto: Option<CryptoAssetDetails>,
    pub user_edited: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SecurityAssetDetails {
    pub cusip: Option<String>,
    pub isin: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct CryptoAssetDetails {
    pub chain_id: Option<String>,
    pub token_symbol: Option<String>,
    pub token_name: Option<String>,
    pub project_name: Option<String>,
}

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct AssetUpdate {
    #[serde(rename = "AssetID")]
    pub asset_id: i64,
    #[serde(rename = "Price")]
    pub price: f64,
    #[serde(rename = "PriceAt")]
    pub price_at: DateTime<Utc>,
    #[serde(rename = "TrackingMultiplier")]
    pub tracking_multiplier: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ConnectionRef {
    pub connection_id: i64,
    pub source_table: crate::accounts::SourceTable,
    pub source_id: i64,
}

pub trait SyncAdapter: Send + Sync {
    fn source(&self) -> SyncerId;
    fn handles(&self, connection: &ConnectionRef) -> bool;
    fn sync_due<'a>(&'a self, sink: Arc<dyn PersistSink>) -> BoxFuture<'a, anyhow::Result<()>>;
    fn sync_connection_into<'a>(
        &'a self,
        connection: ConnectionRef,
        sink: &'a dyn PersistSink,
    ) -> BoxFuture<'a, anyhow::Result<()>>;
}

pub trait PersistSink: Send + Sync {
    fn now(&self) -> DateTime<Utc>;
    fn today(&self) -> &str;
    fn persist<'a>(&'a self, event: PersistEvent) -> BoxFuture<'a, anyhow::Result<()>>;
}

#[derive(Clone, Debug, PartialEq)]
pub enum PersistEvent {
    Snapshot(Box<SnapshotDraft>),
    Asset(AssetUpdate),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SnapshotDecision {
    Clean,
    Flagged,
    ApprovedCarryForward,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotDraft {
    pub snapshot: crate::wealth::AccountBalanceSnapshot,
    pub decision: SnapshotDecision,
    pub anchor: LastUnflaggedBalanceResult,
    pub review: Option<crate::wealth::BalanceReviewUpsert>,
    pub provider_state: Option<SnapshotProviderState>,
    pub carry_usd: Cents,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotPersist {
    pub snapshot: crate::wealth::AccountBalanceSnapshot,
    pub synced_at: DateTime<Utc>,
    pub expire_review: bool,
    pub recovery: Option<SnapshotRecovery>,
    pub review: Option<crate::wealth::BalanceReviewUpsert>,
    pub provider_state: Option<SnapshotProviderState>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotProviderState {
    pub provider_balance_usd: Cents,
    pub provider_holdings_json: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotRecovery {
    pub account_id: i64,
    pub after_date: String,
    pub before_date: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct AccountFilter {
    pub owner_ids: Vec<i64>,
    pub account_ids: Vec<i64>,
    pub asset_ids: Vec<i64>,
    pub exclude_liabilities: bool,
    pub as_of: Option<LocalDayWindow>,
}

// UTC bounds of one calendar day in the household timezone; snapshots synced
// before `end` belong to that day or earlier, matching the series' forward fill.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LocalDayWindow {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AssetUpsert {
    pub asset_type: AssetType,
    pub identifier: String,
    pub name: Option<String>,
    pub classifier: AssetClassifier,
    pub user_edited: bool,
    pub user_created: bool,
    pub forced_usd_price: Option<f64>,
    pub tracking_ticker: Option<String>,
    pub tracking_multiplier: f64,
    pub last_price: Option<f64>,
    pub last_price_at: Option<DateTime<Utc>>,
    pub adapter_source: Option<crate::wealth::AdapterSource>,
    pub plaid_security_type: Option<String>,
    pub cusip: Option<String>,
    pub isin: Option<String>,
    pub simple_fin_cost_basis: Option<String>,
    pub simple_fin_purchase_price: Option<String>,
    pub line_type: Option<String>,
    pub chain_id: Option<String>,
    pub token_id: Option<String>,
    pub token_symbol: Option<String>,
    pub token_name: Option<String>,
    pub project_name: Option<String>,
    pub real_estate: Option<crate::wealth::RealEstateDetails>,
}
