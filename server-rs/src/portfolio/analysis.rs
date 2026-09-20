use std::collections::{HashMap, HashSet};

use anyhow::{Context, Result};
use sqlx::SqlitePool;

mod accumulator;

use crate::{
    portfolio::{
        AnalysisHolding, AnalysisReport, HoldingsFilter,
        store::{self, reports},
        types::{AssetReport, UNASSIGNED_LABEL, UNCLASSIFIED_LABEL},
    },
    schema::AnalysisView,
};

pub async fn analyze(pool: &SqlitePool, view: AnalysisView, filter: HoldingsFilter) -> Result<AnalysisReport> {
    let holdings = store::holdings::current_public_holdings(pool, &filter)
        .await
        .context("current public holdings")?;
    let reports = reports::reports_by_asset_ids(pool, &distinct_asset_ids(&holdings))
        .await
        .context("analysis reports")?;
    Ok(analyze_holdings(view, holdings, reports))
}

fn analyze_holdings(
    view: AnalysisView,
    holdings: Vec<AnalysisHolding>,
    reports: HashMap<i64, AssetReport>,
) -> AnalysisReport {
    let total = holdings.iter().map(|holding| holding.value_usd.dollars()).sum();
    let mut slices = HashMap::new();
    for holding in &holdings {
        let Some(report) = reports.get(&holding.asset.id) else {
            accumulator::add_contribution(&mut slices, UNCLASSIFIED_LABEL, holding, holding.value_usd.dollars());
            continue;
        };
        match view {
            AnalysisView::Composition => accumulator::add_weighted_contributions(
                &mut slices,
                holding,
                accumulator::composition_components(report),
            ),
            AnalysisView::MorningstarCategory => {
                accumulator::add_contribution(
                    &mut slices,
                    &category_label(report),
                    holding,
                    holding.value_usd.dollars(),
                );
            }
            AnalysisView::MorningstarGroup => {
                accumulator::add_contribution(
                    &mut slices,
                    fallback_label(&report.group_name),
                    holding,
                    holding.value_usd.dollars(),
                );
            }
            AnalysisView::Sectors => match report
                .equity_sector
                .as_deref()
                .map(str::trim)
                .filter(|sector| !sector.is_empty())
            {
                Some(sector) => {
                    accumulator::add_contribution(&mut slices, sector, holding, holding.value_usd.dollars())
                }
                None => accumulator::add_weighted_contributions(
                    &mut slices,
                    holding,
                    accumulator::sector_components(report),
                ),
            },
        }
    }
    AnalysisReport {
        view,
        total_value_usd: crate::money::Cents::from_dollars(total),
        slices: accumulator::finalize_slices(slices, total),
    }
}

fn distinct_asset_ids(holdings: &[AnalysisHolding]) -> Vec<i64> {
    holdings
        .iter()
        .filter_map({
            let mut seen = HashSet::new();
            move |holding| seen.insert(holding.asset.id).then_some(holding.asset.id)
        })
        .collect()
}

fn fallback_label(label: &str) -> &str {
    let label = label.trim();
    if label.is_empty() { UNASSIGNED_LABEL } else { label }
}

fn category_label(report: &AssetReport) -> String {
    let category = report.category.trim();
    let group = report.group_name.trim();
    match (category.is_empty(), group.is_empty()) {
        (true, _) => UNASSIGNED_LABEL.to_owned(),
        (false, true) => category.to_owned(),
        (false, false) => format!("{group}: {category}"),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::{
        clients::yfinance::FundReport,
        money::Cents,
        portfolio::{
            AnalysisHolding,
            types::{AssetReport, UNASSIGNED_LABEL, UNCLASSIFIED_LABEL},
        },
        schema::{AnalysisView, AssetClassifier, AssetType, ConnectivityStatus},
        wealth::Asset,
    };

    use super::analyze_holdings;

    #[test]
    fn analyzes_all_views_and_unknown_labels() {
        struct Case {
            view: AnalysisView,
            holdings: Vec<AnalysisHolding>,
            reports: Vec<AssetReport>,
            slices: Vec<(&'static str, i64)>,
        }
        let sector = Some("Technology".to_owned());
        let cases = vec![
            Case {
                view: AnalysisView::Composition,
                holdings: vec![holding(1, 100.0), holding(2, 50.0)],
                reports: vec![report(
                    1,
                    FundReport {
                        stock_position: 0.6,
                        bond_position: 0.4,
                        ..Default::default()
                    },
                )],
                slices: vec![("Stock", 6000), ("Bond", 4000), (UNCLASSIFIED_LABEL, 5000)],
            },
            Case {
                view: AnalysisView::Sectors,
                holdings: vec![holding(1, 100.0), holding(2, 50.0)],
                reports: vec![
                    report(
                        1,
                        FundReport {
                            sector_technology: 0.7,
                            sector_healthcare: 0.3,
                            ..Default::default()
                        },
                    ),
                    AssetReport {
                        equity_sector: sector,
                        ..report(2, FundReport::default())
                    },
                ],
                slices: vec![("Technology", 12000), ("Healthcare", 3000)],
            },
            Case {
                view: AnalysisView::MorningstarCategory,
                holdings: vec![holding(1, 100.0), holding(2, 60.0), holding(3, 40.0)],
                reports: vec![
                    report(
                        1,
                        FundReport {
                            category: "Large Blend".to_owned(),
                            group: "US Equity".to_owned(),
                            ..Default::default()
                        },
                    ),
                    report(
                        2,
                        FundReport {
                            category: "Small Growth".to_owned(),
                            group: "US Equity".to_owned(),
                            ..Default::default()
                        },
                    ),
                    report(3, FundReport::default()),
                ],
                slices: vec![
                    ("US Equity: Large Blend", 10000),
                    ("US Equity: Small Growth", 6000),
                    (UNASSIGNED_LABEL, 4000),
                ],
            },
            Case {
                view: AnalysisView::Sectors,
                holdings: vec![holding(1, 80.0), holding(2, 20.0)],
                reports: vec![
                    AssetReport {
                        equity_sector: Some("Technology".to_owned()),
                        ..report(1, FundReport::default())
                    },
                    report(2, FundReport::default()),
                ],
                slices: vec![("Technology", 8000), (UNASSIGNED_LABEL, 2000)],
            },
            Case {
                view: AnalysisView::MorningstarGroup,
                holdings: vec![holding(1, 100.0), holding(2, 40.0)],
                reports: vec![
                    report(
                        1,
                        FundReport {
                            group: "US Equity".to_owned(),
                            ..Default::default()
                        },
                    ),
                    report(2, FundReport::default()),
                ],
                slices: vec![("US Equity", 10_000), (UNASSIGNED_LABEL, 4_000)],
            },
            Case {
                view: AnalysisView::MorningstarGroup,
                holdings: Vec::new(),
                reports: Vec::new(),
                slices: Vec::new(),
            },
        ];

        for case in cases {
            let total = case.holdings.iter().map(|holding| holding.value_usd.0).sum::<i64>();
            let report = analyze_holdings(
                case.view,
                case.holdings,
                case.reports
                    .into_iter()
                    .map(|report| (report.asset_id, report))
                    .collect(),
            );
            assert_eq!(report.total_value_usd.0, total);
            assert_eq!(
                report
                    .slices
                    .iter()
                    .map(|slice| (slice.label.as_str(), slice.value_usd.0))
                    .collect::<Vec<_>>(),
                case.slices
            );
        }
    }

    #[test]
    fn folds_duplicate_assets_and_rounds_once() {
        let report = analyze_holdings(
            AnalysisView::Composition,
            vec![holding(1, 0.01), holding(1, 0.01)],
            HashMap::from([(
                1,
                report(
                    1,
                    FundReport {
                        stock_position: 0.5,
                        bond_position: 0.5,
                        ..Default::default()
                    },
                ),
            )]),
        );

        assert_eq!(report.total_value_usd, Cents(2));
        for slice in report.slices {
            assert_eq!(slice.value_usd, Cents(1));
            assert_eq!(slice.holdings.len(), 1);
            assert_eq!(slice.holdings[0].value_usd, Cents(1));
            assert_eq!(slice.holdings[0].percent, 100.0);
        }
    }

    fn report(asset_id: i64, report: FundReport) -> AssetReport {
        AssetReport::from((asset_id, "2026-09-06T12:00:00Z".parse().unwrap(), report))
    }

    fn holding(asset_id: i64, dollars: f64) -> AnalysisHolding {
        AnalysisHolding {
            asset: Asset {
                id: asset_id,
                asset_type: AssetType::Security,
                identifier: format!("asset-{asset_id}"),
                name: None,
                classifier: AssetClassifier::Public,
                current_price: None,
                forced_usd_price: None,
                tracking_ticker: None,
                tracking_multiplier: 1.0,
                price_connectivity: ConnectivityStatus::Healthy,
                investment_connectivity: ConnectivityStatus::Healthy,
            },
            value_usd: Cents::from_dollars(dollars),
            percent: 0.0,
        }
    }
}
