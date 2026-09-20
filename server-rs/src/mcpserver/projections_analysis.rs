use serde::Serialize;

use super::projections::{LeanAsset, map_asset};
use crate::{
    money::Cents,
    schema::{AnalysisHolding, AnalysisReport, AnalysisSlice, AnalysisView},
};

#[derive(Debug, PartialEq, Serialize)]
pub(super) struct LeanAnalysisHolding {
    pub(super) asset: LeanAsset,
    #[serde(rename = "valueUSD")]
    pub(super) value_usd: Cents,
    pub(super) percent: f64,
}

#[derive(Debug, PartialEq, Serialize)]
pub(super) struct LeanAnalysisSlice {
    pub(super) label: String,
    #[serde(rename = "valueUSD")]
    pub(super) value_usd: Cents,
    pub(super) percent: f64,
    pub(super) holdings: Vec<LeanAnalysisHolding>,
}

#[derive(Debug, PartialEq, Serialize)]
pub(super) struct LeanAnalysisReport {
    pub(super) view: AnalysisView,
    #[serde(rename = "totalValueUSD")]
    pub(super) total_value_usd: Cents,
    pub(super) slices: Vec<LeanAnalysisSlice>,
}

pub(super) fn map_analysis_report(report: AnalysisReport) -> LeanAnalysisReport {
    let to_holding = |holding: AnalysisHolding| LeanAnalysisHolding {
        asset: map_asset(holding.asset),
        value_usd: holding.value_usd,
        percent: holding.percent,
    };
    let to_slice = |slice: AnalysisSlice| LeanAnalysisSlice {
        label: slice.label,
        value_usd: slice.value_usd,
        percent: slice.percent,
        holdings: slice.holdings.into_iter().map(to_holding).collect(),
    };
    LeanAnalysisReport {
        view: report.view,
        total_value_usd: report.total_value_usd,
        slices: report.slices.into_iter().map(to_slice).collect(),
    }
}
