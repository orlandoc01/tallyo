use std::{cmp::Ordering, collections::HashMap};

use crate::{
    money::Cents,
    portfolio::{
        AnalysisHolding, AnalysisSlice,
        types::{AssetReport, UNASSIGNED_LABEL, UNCLASSIFIED_LABEL},
    },
    wealth::Asset,
};

const EPSILON: f64 = 0.0000001;

pub(super) struct SliceAccumulator {
    value_usd: f64,
    holdings: HashMap<i64, AssetContribution>,
}

struct AssetContribution {
    asset: Asset,
    value_usd: f64,
}

pub(super) fn add_weighted_contributions(
    slices: &mut HashMap<String, SliceAccumulator>,
    holding: &AnalysisHolding,
    components: impl IntoIterator<Item = (&'static str, f64)>,
) {
    let contributed = components
        .into_iter()
        .filter_map(|(label, fraction)| (fraction > 0.0 && !label.is_empty()).then_some((label, fraction)))
        .map(|(label, fraction)| (label, holding.value_usd.dollars() * fraction))
        .filter(|(_, value)| value.abs() >= EPSILON)
        .inspect(|(label, value)| add_contribution(slices, label, holding, *value))
        .map(|(_, value)| value)
        .sum::<f64>();
    if contributed.abs() < EPSILON && holding.value_usd.0 != 0 {
        add_contribution(slices, UNASSIGNED_LABEL, holding, holding.value_usd.dollars());
    }
}

pub(super) fn add_contribution(
    slices: &mut HashMap<String, SliceAccumulator>,
    label: &str,
    holding: &AnalysisHolding,
    value_usd: f64,
) {
    if value_usd.abs() < EPSILON {
        return;
    }
    let slice = slices.entry(label.to_owned()).or_insert_with(|| SliceAccumulator {
        value_usd: 0.0,
        holdings: HashMap::new(),
    });
    slice.value_usd += value_usd;
    slice
        .holdings
        .entry(holding.asset.id)
        .and_modify(|contribution| contribution.value_usd += value_usd)
        .or_insert_with(|| AssetContribution {
            asset: holding.asset.clone(),
            value_usd,
        });
}

pub(super) fn finalize_slices(slices: HashMap<String, SliceAccumulator>, total: f64) -> Vec<AnalysisSlice> {
    let mut finalized = slices
        .into_iter()
        .filter(|(_, slice)| slice.value_usd.abs() >= EPSILON)
        .map(|(label, slice)| AnalysisSlice {
            label,
            value_usd: Cents::from_dollars(slice.value_usd),
            percent: percent(slice.value_usd, total),
            holdings: finalize_holdings(slice),
        })
        .collect::<Vec<_>>();
    finalized.sort_by(slice_order);
    finalized
}

fn slice_order(left: &AnalysisSlice, right: &AnalysisSlice) -> Ordering {
    let priority = |label: &str| match label {
        UNCLASSIFIED_LABEL => 2,
        UNASSIGNED_LABEL => 1,
        _ => 0,
    };
    match priority(left.label.as_str()).cmp(&priority(right.label.as_str())) {
        Ordering::Equal => right.value_usd.cmp(&left.value_usd),
        order => order,
    }
}

fn finalize_holdings(slice: SliceAccumulator) -> Vec<AnalysisHolding> {
    let mut holdings = slice.holdings.into_iter().collect::<Vec<_>>();
    holdings.sort_by(|(left_id, left), (right_id, right)| {
        right
            .value_usd
            .total_cmp(&left.value_usd)
            .then_with(|| left_id.cmp(right_id))
    });
    holdings
        .into_iter()
        .map(|(_, contribution)| AnalysisHolding {
            asset: contribution.asset,
            value_usd: Cents::from_dollars(contribution.value_usd),
            percent: percent(contribution.value_usd, slice.value_usd),
        })
        .collect()
}

fn percent(value: f64, total: f64) -> f64 {
    if total.abs() < EPSILON { 0.0 } else { value / total * 100.0 }
}

pub(super) fn composition_components(report: &AssetReport) -> [(&'static str, f64); 6] {
    [
        ("Cash", report.cash_position),
        ("Stock", report.stock_position),
        ("Bond", report.bond_position),
        ("Preferred", report.preferred_position),
        ("Convertible", report.convertible_position),
        ("Other", report.other_position),
    ]
}

pub(super) fn sector_components(report: &AssetReport) -> [(&'static str, f64); 11] {
    [
        ("Real Estate", report.sector_real_estate),
        ("Consumer Cyclical", report.sector_consumer_cyclical),
        ("Basic Materials", report.sector_basic_materials),
        ("Consumer Defensive", report.sector_consumer_defensive),
        ("Technology", report.sector_technology),
        ("Communication Services", report.sector_communication_services),
        ("Financial Services", report.sector_financial_services),
        ("Utilities", report.sector_utilities),
        ("Industrials", report.sector_industrials),
        ("Energy", report.sector_energy),
        ("Healthcare", report.sector_healthcare),
    ]
}

#[cfg(test)]
mod tests {
    use std::cmp::Ordering;

    use crate::{
        money::Cents,
        portfolio::{
            AnalysisSlice,
            types::{UNASSIGNED_LABEL, UNCLASSIFIED_LABEL},
        },
    };

    use super::{percent, slice_order};

    #[test]
    fn sorts_unknown_labels_last_and_guards_zero_percentages() {
        let slice = |label: &str, value_usd| AnalysisSlice {
            label: label.to_owned(),
            value_usd: Cents(value_usd),
            percent: 0.0,
            holdings: Vec::new(),
        };

        assert_eq!(
            slice_order(&slice(UNCLASSIFIED_LABEL, 1), &slice(UNASSIGNED_LABEL, 1)),
            Ordering::Greater
        );
        assert_eq!(
            slice_order(&slice(UNASSIGNED_LABEL, 1), &slice("Stock", 1)),
            Ordering::Greater
        );
        assert_eq!(slice_order(&slice("Stock", 1), &slice("Bond", 2)), Ordering::Greater);
        assert_eq!(percent(10.0, 0.0), 0.0);
    }
}
