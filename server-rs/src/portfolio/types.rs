use chrono::{DateTime, Utc};

use crate::{
    clients::yfinance::{EquityReport, FundReport},
    database::Timestamp,
    schema::ConnectivityStatus,
};

pub(crate) use crate::database::queries::AssetAnalysisReports as AssetReport;

pub(crate) const UNCLASSIFIED_LABEL: &str = "Unclassified";
pub(crate) const UNASSIGNED_LABEL: &str = "Unassigned";

#[derive(Clone, Debug, Default, PartialEq)]
pub struct HoldingsFilter {
    pub owner_ids: Vec<i64>,
    pub account_subtypes: Vec<String>,
    pub account_ids: Vec<i64>,
    pub include_unclassified: bool,
}

pub use crate::schema::{AnalysisHolding, AnalysisReport, AnalysisSlice};

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct AssetStub {
    pub id: i64,
    pub identifier: String,
    pub tracking_ticker: Option<String>,
    pub investment_connectivity: ConnectivityStatus,
}

impl From<(i64, DateTime<Utc>, FundReport)> for AssetReport {
    fn from((asset_id, fetched_at, report): (i64, DateTime<Utc>, FundReport)) -> Self {
        Self {
            asset_id,
            bond_position: report.bond_position,
            cash_position: report.cash_position,
            category: report.category,
            convertible_position: report.convertible_position,
            created_at: Timestamp::from(fetched_at),
            equity_sector: None,
            fetched_at: Timestamp::from(fetched_at),
            group_name: report.group,
            other_position: report.other_position,
            preferred_position: report.preferred_position,
            sector_basic_materials: report.sector_basic_materials,
            sector_communication_services: report.sector_communication_services,
            sector_consumer_cyclical: report.sector_consumer_cyclical,
            sector_consumer_defensive: report.sector_consumer_defensive,
            sector_energy: report.sector_energy,
            sector_financial_services: report.sector_financial_services,
            sector_healthcare: report.sector_healthcare,
            sector_industrials: report.sector_industrials,
            sector_real_estate: report.sector_real_estate,
            sector_technology: report.sector_technology,
            sector_utilities: report.sector_utilities,
            stock_position: report.stock_position,
        }
    }
}

impl From<(i64, DateTime<Utc>, EquityReport)> for AssetReport {
    fn from((asset_id, fetched_at, report): (i64, DateTime<Utc>, EquityReport)) -> Self {
        Self {
            asset_id,
            bond_position: 0.0,
            cash_position: 0.0,
            category: "Individual Equity".to_owned(),
            convertible_position: 0.0,
            created_at: Timestamp::from(fetched_at),
            equity_sector: Some(report.sector.trim().to_owned()),
            fetched_at: Timestamp::from(fetched_at),
            group_name: "Individual Equity".to_owned(),
            other_position: 0.0,
            preferred_position: 0.0,
            sector_basic_materials: 0.0,
            sector_communication_services: 0.0,
            sector_consumer_cyclical: 0.0,
            sector_consumer_defensive: 0.0,
            sector_energy: 0.0,
            sector_financial_services: 0.0,
            sector_healthcare: 0.0,
            sector_industrials: 0.0,
            sector_real_estate: 0.0,
            sector_technology: 0.0,
            sector_utilities: 0.0,
            stock_position: 1.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{AssetReport, EquityReport, FundReport};

    #[test]
    fn builds_reports_from_yahoo_data() {
        let fetched_at = "2026-09-06T12:00:00Z".parse().unwrap();
        let fund = AssetReport::from((
            1,
            fetched_at,
            FundReport {
                category: "Large Blend".to_owned(),
                group: "US Equity".to_owned(),
                stock_position: 0.9,
                sector_technology: 0.3,
                ..Default::default()
            },
        ));
        let equity = AssetReport::from((
            2,
            fetched_at,
            EquityReport {
                sector: " Technology ".to_owned(),
            },
        ));

        assert_eq!(fund.asset_id, 1);
        assert_eq!(fund.group_name, "US Equity");
        assert_eq!(fund.stock_position, 0.9);
        assert_eq!(fund.sector_technology, 0.3);
        assert_eq!(fund.fetched_at.0, fetched_at);
        assert_eq!(equity.asset_id, 2);
        assert_eq!(equity.category, "Individual Equity");
        assert_eq!(equity.group_name, "Individual Equity");
        assert_eq!(equity.stock_position, 1.0);
        assert_eq!(equity.equity_sector.as_deref(), Some("Technology"));
    }
}
