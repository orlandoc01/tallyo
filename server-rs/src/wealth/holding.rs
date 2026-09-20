use std::collections::HashMap;

use crate::{
    ids::{GlobalId, GlobalIdType},
    money::Cents,
};

use super::{AccountFilter, AssetSnapshot, CurrentHolding, Holding, HoldingRollup, WealthService, store};

impl WealthService {
    pub async fn asset_snapshots_by_ids(&self, asset_ids: &[i64]) -> anyhow::Result<HashMap<i64, AssetSnapshot>> {
        let holdings = store::current_holdings(
            &self.pool,
            &AccountFilter {
                asset_ids: asset_ids.to_vec(),
                ..Default::default()
            },
        )
        .await?;
        Ok(asset_snapshots(holdings))
    }
}

pub(super) fn holding_rollups(holdings: Vec<CurrentHolding>) -> Vec<HoldingRollup> {
    let total: Cents = holdings.iter().map(|holding| holding.value_usd).sum();
    let mut rollups = group_by_asset(holdings)
        .into_values()
        .map(|holdings| {
            let value_usd = holdings.iter().map(|holding| holding.value_usd).sum();
            HoldingRollup {
                asset: holdings[0].asset.clone(),
                total_quantity: total_quantity(&holdings),
                value_usd,
                percent_of_classifier: percent(value_usd, total),
                holdings: Some(sorted_models(holdings)),
            }
        })
        .collect::<Vec<_>>();
    rollups.sort_by_key(|rollup| (-rollup.value_usd.0, rollup.asset.id));
    rollups
}

pub(super) fn holding_to_model(holding: CurrentHolding) -> Holding {
    Holding {
        asset_id: global_id(GlobalIdType::Asset, holding.asset.id),
        account_id: global_id(GlobalIdType::Account, holding.account.id),
        asset: holding.asset,
        quantity: holding.quantity,
        value_usd: holding.value_usd,
        manual: holding.manual,
    }
}

pub(super) fn global_id(typ: GlobalIdType, id: i64) -> async_graphql::ID {
    GlobalId::new(typ, id).encoded_string().into()
}

fn asset_snapshots(holdings: Vec<CurrentHolding>) -> HashMap<i64, AssetSnapshot> {
    group_by_asset(holdings)
        .into_iter()
        .map(|(asset_id, holdings)| {
            let snapshot = AssetSnapshot {
                as_of_date: holdings
                    .iter()
                    .map(|holding| &holding.snapshot_date)
                    .max_by(|left, right| left.as_str().cmp(right.as_str()))
                    .expect("asset groups are non-empty")
                    .clone(),
                total_held_quantity: total_quantity(&holdings),
                total_held_value_usd: holdings.iter().map(|holding| holding.value_usd).sum(),
                holdings: Some(sorted_models(holdings)),
            };
            (asset_id, snapshot)
        })
        .collect()
}

fn group_by_asset(holdings: Vec<CurrentHolding>) -> HashMap<i64, Vec<CurrentHolding>> {
    holdings.into_iter().fold(HashMap::new(), |mut grouped, holding| {
        grouped.entry(holding.asset.id).or_insert_with(Vec::new).push(holding);
        grouped
    })
}

// A single unknown quantity poisons the total, matching Go's addQuantity.
fn total_quantity(holdings: &[CurrentHolding]) -> Option<f64> {
    holdings
        .iter()
        .try_fold(0.0, |total, holding| holding.quantity.map(|quantity| total + quantity))
}

fn sorted_models(mut holdings: Vec<CurrentHolding>) -> Vec<Holding> {
    holdings.sort_by_key(|holding| (-holding.value_usd.0, holding.account.id));
    holdings.into_iter().map(holding_to_model).collect()
}

fn percent(value: Cents, total: Cents) -> f64 {
    if total == Cents::default() { 0.0 } else { value.dollars() / total.dollars() * 100.0 }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::{asset_snapshots, global_id, holding_rollups, percent};
    use crate::{
        accounts::{Account, AccountType, Owner},
        ids::{Date, GlobalIdType},
        money::Cents,
        schema::{AssetClassifier, AssetType, ConnectivityStatus},
        wealth::{Asset, CurrentHolding},
    };

    #[test]
    fn groups_sorts_and_percentages_holdings() {
        let rollups = holding_rollups(vec![
            holding(1, 20, Some(2.0), 500, "2026-06-01"),
            holding(1, 10, None, 1_000, "2026-06-02"),
            holding(2, 30, Some(3.0), 1_000, "2026-06-01"),
        ]);

        assert_eq!(rollups.len(), 2);
        assert_eq!(rollups[0].asset.id, 1);
        assert_eq!(rollups[0].total_quantity, None);
        assert_eq!(rollups[0].value_usd, Cents(1_500));
        assert_eq!(rollups[0].percent_of_classifier, 60.0);
        let holdings = rollups[0].holdings.as_ref().unwrap();
        assert_eq!(holdings[0].account_id, global_id(GlobalIdType::Account, 10));
        assert_eq!(holdings[0].asset_id, global_id(GlobalIdType::Asset, 1));
        assert_eq!(rollups[1].asset.id, 2);
        assert_eq!(percent(Cents::default(), Cents::default()), 0.0);
    }

    #[test]
    fn collects_asset_snapshots_at_the_latest_date() {
        let snapshots = asset_snapshots(vec![
            holding(1, 20, Some(2.0), 500, "2026-06-01"),
            holding(1, 10, Some(3.0), 1_000, "2026-06-02"),
        ]);
        let snapshot = &snapshots[&1];

        assert_eq!(snapshot.as_of_date.as_str(), "2026-06-02");
        assert_eq!(snapshot.total_held_quantity, Some(5.0));
        assert_eq!(snapshot.total_held_value_usd, Cents(1_500));
        assert_eq!(
            snapshot.holdings.as_ref().unwrap()[0].account_id,
            global_id(GlobalIdType::Account, 10)
        );
    }

    fn holding(asset_id: i64, account_id: i64, quantity: Option<f64>, value_usd: i64, date: &str) -> CurrentHolding {
        CurrentHolding {
            account: Account {
                id: account_id,
                owner: Owner {
                    id: 1,
                    ..Default::default()
                },
                name: format!("Account {account_id}"),
                r#type: AccountType::Investment,
                subtype: None,
                mask: None,
                notes: None,
                closed: false,
                hidden: false,
                needs_review: false,
                manual: false,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
            asset: Asset {
                id: asset_id,
                asset_type: AssetType::Security,
                identifier: format!("Asset {asset_id}"),
                name: None,
                classifier: AssetClassifier::Public,
                current_price: None,
                forced_usd_price: None,
                tracking_ticker: None,
                tracking_multiplier: 1.0,
                price_connectivity: ConnectivityStatus::Healthy,
                investment_connectivity: ConnectivityStatus::Healthy,
            },
            quantity,
            value_usd: Cents(value_usd),
            manual: false,
            snapshot_date: Date::new(date).unwrap(),
        }
    }
}
