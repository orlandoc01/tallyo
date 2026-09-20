use std::collections::HashMap;

use crate::wealth::{AdapterSource, AssetDailyHolding};

pub const HOLDING_PRICE_DEVIATION_RATIO: f64 = 100.0;

pub fn holding_price_deviates(prior: &[AssetDailyHolding], next: &[AssetDailyHolding], ratio: f64) -> Option<String> {
    let prior_prices = prior_prices_by_match_key(prior);
    next.iter().find_map(|holding| {
        let prior_price = prior_prices
            .get(&holding_match_key(holding))
            .or_else(|| prior_prices.get(&legacy_holding_match_key(holding)))?;
        let next_price = comparable_price(holding)?;
        (price_deviation_ratio(*prior_price, next_price) >= ratio).then(|| {
            format!(
                "price {} {:.2}→{:.2} exceeds {:.1}x deviation threshold",
                holding_identifier(holding),
                prior_price,
                next_price,
                ratio
            )
        })
    })
}

fn prior_prices_by_match_key(prior: &[AssetDailyHolding]) -> HashMap<String, f64> {
    prior.iter().fold(HashMap::new(), |mut prices, holding| {
        let Some(price) = holding.price.filter(|price| finite_positive(*price)) else {
            return prices;
        };
        let source_keys = adapter_source_match_keys(holding);
        if source_keys.is_empty() {
            [holding_match_key(holding), legacy_holding_match_key(holding)]
                .into_iter()
                .filter(|key| !key.is_empty())
                .for_each(|key| {
                    prices.insert(key, price);
                });
        } else {
            source_keys.into_iter().for_each(|key| {
                prices.insert(key, price);
            });
        }
        prices
    })
}

fn adapter_source_match_keys(holding: &AssetDailyHolding) -> Vec<String> {
    holding
        .adapter_sources
        .iter()
        .chain(holding.adapter_source.iter())
        .chain(holding.asset.iter().flat_map(|asset| asset.adapter_source.iter()))
        .filter_map(adapter_source_match_key)
        .collect()
}

fn adapter_source_match_key(source: &AdapterSource) -> Option<String> {
    (!source.source_id.trim().is_empty()).then(|| format!("{}:{}", source.adapter, source.source_id))
}

fn holding_match_key(holding: &AssetDailyHolding) -> String {
    adapter_source_match_keys(holding)
        .into_iter()
        .next()
        .or_else(|| (holding.asset_id > 0).then(|| format!("asset:{}", holding.asset_id)))
        .unwrap_or_else(|| legacy_holding_match_key(holding))
}

fn legacy_holding_match_key(holding: &AssetDailyHolding) -> String {
    let identifier = holding_identifier(holding);
    if identifier.is_empty() { String::new() } else { format!("identifier:{identifier}") }
}

fn holding_identifier(holding: &AssetDailyHolding) -> &str {
    if !holding.identifier.is_empty() {
        &holding.identifier
    } else {
        holding
            .asset
            .as_ref()
            .map(|asset| asset.identifier.as_str())
            .unwrap_or_default()
    }
}

fn comparable_price(holding: &AssetDailyHolding) -> Option<f64> {
    holding
        .provider_price
        .filter(|price| finite_positive(*price))
        .or_else(|| holding.price.filter(|price| finite_positive(*price)))
        .or_else(|| {
            holding
                .quantity
                .map(|quantity| holding.value_usd / quantity)
                .filter(|price| finite_positive(*price))
        })
}

fn finite_positive(value: f64) -> bool {
    value.is_finite() && value > 0.0
}

fn price_deviation_ratio(prior: f64, next: f64) -> f64 {
    (next / prior).max(prior / next)
}

#[cfg(test)]
mod tests {
    use super::{HOLDING_PRICE_DEVIATION_RATIO, holding_price_deviates};
    use crate::wealth::{AdapterSource, AssetDailyHolding, SyncerId};

    #[test]
    fn detects_only_matching_prices_at_the_threshold() {
        let prior = holding("ticker", Some(1.0));
        let cases = [
            ("spike", holding("ticker", Some(100.0)), true),
            ("drop", holding("ticker", Some(0.01)), true),
            ("below", holding("ticker", Some(99.99)), false),
            ("new", holding("other", Some(1_000.0)), false),
            ("missing", holding("ticker", None), false),
            ("invalid", holding("ticker", Some(f64::INFINITY)), false),
        ];

        for (name, next, expected) in cases {
            assert_eq!(
                holding_price_deviates(std::slice::from_ref(&prior), &[next], HOLDING_PRICE_DEVIATION_RATIO).is_some(),
                expected,
                "{name}"
            );
        }
    }

    #[test]
    fn matches_stable_sources_then_asset_ids_and_uses_valid_fallback_prices() {
        let mut prior = holding("edited", Some(1.0));
        prior.adapter_source = Some(AdapterSource {
            adapter: SyncerId::Plaid,
            source_id: "security".to_owned(),
        });
        let mut next = holding("renamed", Some(1.0));
        next.adapter_source = prior.adapter_source.clone();
        next.provider_price = Some(100.0);
        assert!(holding_price_deviates(&[prior], &[next], HOLDING_PRICE_DEVIATION_RATIO).is_some());

        let mut prior = holding("", Some(1.0));
        prior.asset_id = 1;
        let mut next = holding("renamed", Some(100.0));
        next.asset_id = 1;
        next.provider_price = Some(f64::INFINITY);
        assert!(holding_price_deviates(&[prior], &[next], HOLDING_PRICE_DEVIATION_RATIO).is_some());
    }

    #[test]
    fn keeps_source_scoped_assets_separate_and_uses_asset_upsert_identifiers() {
        let mut prior = holding("USDC", Some(1.0));
        prior.adapter_source = Some(AdapterSource {
            adapter: SyncerId::Debank,
            source_id: "base:usdc".to_owned(),
        });
        let mut other_chain = holding("USDC", Some(150.0));
        other_chain.adapter_source = Some(AdapterSource {
            adapter: SyncerId::Debank,
            source_id: "polygon:usdc".to_owned(),
        });
        assert!(holding_price_deviates(&[prior.clone()], &[other_chain], HOLDING_PRICE_DEVIATION_RATIO).is_none());

        let mut upsert_identifier = holding("", Some(250.0));
        upsert_identifier.asset = Some(crate::wealth::AssetUpsert {
            identifier: "VTI".to_owned(),
            ..asset_upsert()
        });
        assert!(
            holding_price_deviates(
                &[holding("VTI", Some(2.0))],
                &[upsert_identifier],
                HOLDING_PRICE_DEVIATION_RATIO
            )
            .is_some()
        );
    }

    #[test]
    fn skips_every_invalid_implied_price() {
        for value in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            let mut next = holding("token", None);
            next.value_usd = value;
            assert!(
                holding_price_deviates(&[holding("token", Some(1.0))], &[next], HOLDING_PRICE_DEVIATION_RATIO)
                    .is_none()
            );
        }
    }

    fn holding(identifier: &str, price: Option<f64>) -> AssetDailyHolding {
        AssetDailyHolding {
            asset_id: 0,
            asset: None,
            adapter_source: None,
            adapter_sources: Vec::new(),
            price_update: None,
            quantity: Some(1.0),
            price,
            value_usd: price.unwrap_or_default(),
            counts_toward_value: true,
            manual: false,
            line_type: String::new(),
            chain_id: String::new(),
            project_name: None,
            token_id: String::new(),
            identifier: identifier.to_owned(),
            token_symbol: None,
            token_name: None,
            provider_price: None,
        }
    }

    fn asset_upsert() -> crate::wealth::AssetUpsert {
        crate::wealth::AssetUpsert {
            asset_type: crate::schema::AssetType::Security,
            identifier: String::new(),
            name: None,
            classifier: crate::schema::AssetClassifier::Public,
            user_edited: false,
            user_created: false,
            forced_usd_price: None,
            tracking_ticker: None,
            tracking_multiplier: 1.0,
            last_price: None,
            last_price_at: None,
            adapter_source: None,
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
        }
    }
}
