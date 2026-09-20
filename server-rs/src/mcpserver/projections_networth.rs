use serde::Serialize;

use super::projections::{LeanAccount, LeanAsset, map_accounts, map_asset};
use crate::{
    auth::{Identity, Scope},
    ids::Date,
    money::Cents,
    schema::{
        AssetClassifier, ClassifierBreakdown, Holding, HoldingRollup, LiabilityBreakdown, LiabilityCategory,
        NetWorthReport,
    },
};

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanHolding {
    pub(super) asset_id: String,
    pub(super) account_id: String,
    pub(super) quantity: Option<f64>,
    #[serde(rename = "valueUSD")]
    pub(super) value_usd: Cents,
    pub(super) manual: bool,
}

fn map_holding(holding: Holding) -> LeanHolding {
    LeanHolding {
        asset_id: holding.asset_id.to_string(),
        account_id: holding.account_id.to_string(),
        quantity: holding.quantity,
        value_usd: holding.value_usd,
        manual: holding.manual,
    }
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanHoldingRollup {
    pub(super) asset: LeanAsset,
    pub(super) total_quantity: Option<f64>,
    #[serde(rename = "valueUSD")]
    pub(super) value_usd: Cents,
    pub(super) percent_of_classifier: f64,
    // Omitted (not empty) without read:holdings: an empty list would read as "held in zero accounts".
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(super) holdings: Vec<LeanHolding>,
}

pub(super) fn map_holding_rollups(identity: &Identity, rollups: Vec<HoldingRollup>) -> Vec<LeanHoldingRollup> {
    let include_holdings = identity.has_scope(Scope::ReadHoldings);
    rollups
        .into_iter()
        .map(|rollup| LeanHoldingRollup {
            asset: map_asset(rollup.asset),
            total_quantity: rollup.total_quantity,
            value_usd: rollup.value_usd,
            percent_of_classifier: rollup.percent_of_classifier,
            holdings: rollup
                .holdings
                .filter(|_| include_holdings)
                .unwrap_or_default()
                .into_iter()
                .map(map_holding)
                .collect(),
        })
        .collect()
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanClassifierBreakdown {
    pub(super) classifier: AssetClassifier,
    pub(super) label: String,
    #[serde(rename = "valueUSD")]
    pub(super) value_usd: Cents,
    pub(super) percent_of_assets: f64,
    pub(super) asset_count: i32,
    pub(super) holdings: Vec<LeanHoldingRollup>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanLiabilityBreakdown {
    pub(super) category: LiabilityCategory,
    pub(super) label: String,
    #[serde(rename = "valueUSD")]
    pub(super) value_usd: Cents,
    pub(super) percent_of_liabilities: f64,
    pub(super) account_count: i32,
    pub(super) accounts: Vec<LeanAccount>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanNetWorthReport {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) as_of_date: Option<Date>,
    #[serde(rename = "currentNetWorthUSD")]
    pub(super) current_net_worth_usd: Cents,
    #[serde(rename = "currentAssetsUSD")]
    pub(super) current_assets_usd: Cents,
    #[serde(rename = "currentLiabilitiesUSD")]
    pub(super) current_liabilities_usd: Cents,
    pub(super) classifier_breakdown: Vec<LeanClassifierBreakdown>,
    pub(super) liability_breakdown: Vec<LeanLiabilityBreakdown>,
}

pub(super) fn map_net_worth_report(identity: &Identity, report: NetWorthReport) -> LeanNetWorthReport {
    let to_classifier = |breakdown: ClassifierBreakdown| LeanClassifierBreakdown {
        classifier: breakdown.classifier,
        label: breakdown.label,
        value_usd: breakdown.value_usd,
        percent_of_assets: breakdown.percent_of_assets,
        asset_count: breakdown.asset_count,
        holdings: map_holding_rollups(identity, breakdown.holdings),
    };
    let to_liability = |breakdown: LiabilityBreakdown| LeanLiabilityBreakdown {
        category: breakdown.category,
        label: breakdown.label,
        value_usd: breakdown.value_usd,
        percent_of_liabilities: breakdown.percent_of_liabilities,
        account_count: breakdown.account_count,
        accounts: map_accounts(breakdown.balances.into_iter().map(|balance| balance.account).collect()),
    };
    LeanNetWorthReport {
        as_of_date: report.as_of_date,
        current_net_worth_usd: report.current_net_worth_usd,
        current_assets_usd: report.current_assets_usd,
        current_liabilities_usd: report.current_liabilities_usd,
        classifier_breakdown: report.classifier_breakdown.into_iter().map(to_classifier).collect(),
        liability_breakdown: report.liability_breakdown.into_iter().map(to_liability).collect(),
    }
}
