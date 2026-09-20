use std::collections::{HashMap, HashSet};

use crate::clients::plaid::Holding;

const RECONCILE_TOLERANCE: f64 = 0.01;

pub(super) fn dedupe_aggregate_holdings(holdings: &[Holding], account_balances: &HashMap<String, f64>) -> Vec<Holding> {
    let by_account =
        holdings
            .iter()
            .enumerate()
            .fold(HashMap::<&str, Vec<usize>>::new(), |mut grouped, (index, holding)| {
                grouped.entry(&holding.account_id).or_default().push(index);
                grouped
            });
    let dropped = by_account
        .into_iter()
        .flat_map(|(account_id, indexes)| {
            account_balances
                .get(account_id)
                .map(|balance| rollup_rows_to_drop(holdings, &indexes, *balance))
                .unwrap_or_default()
        })
        .collect::<HashSet<_>>();

    holdings
        .iter()
        .enumerate()
        .filter(|(index, _)| !dropped.contains(index))
        .map(|(_, holding)| holding.clone())
        .collect()
}

fn rollup_rows_to_drop(holdings: &[Holding], indexes: &[usize], balance: f64) -> Vec<usize> {
    let by_security = indexes
        .iter()
        .copied()
        .fold(HashMap::<&str, Vec<usize>>::new(), |mut grouped, index| {
            grouped.entry(&holdings[index].security_id).or_default().push(index);
            grouped
        });
    let candidates = by_security
        .values()
        .filter_map(|indexes| aggregate_row_index(holdings, indexes))
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        return Vec::new();
    }

    let dropped = candidates.iter().copied().collect::<HashSet<_>>();
    let deduped_total = indexes
        .iter()
        .filter(|index| !dropped.contains(index))
        .map(|index| holdings[*index].institution_value)
        .sum();
    if within_reconcile_tolerance(deduped_total, balance) { candidates } else { Vec::new() }
}

fn aggregate_row_index(holdings: &[Holding], indexes: &[usize]) -> Option<usize> {
    if indexes.len() < 2 {
        return None;
    }
    let quantity = indexes.iter().map(|index| holdings[*index].quantity).sum();
    let value = indexes.iter().map(|index| holdings[*index].institution_value).sum();
    let cost_basis = indexes
        .iter()
        .map(|index| holdings[*index].cost_basis)
        .collect::<Option<Vec<_>>>();
    let total_cost_basis = cost_basis.as_ref().map(|costs| costs.iter().sum::<f64>());
    let candidates = indexes
        .iter()
        .copied()
        .filter(|index| {
            floats_approx_equal(2.0 * holdings[*index].quantity, quantity)
                && floats_approx_equal(2.0 * holdings[*index].institution_value, value)
                && total_cost_basis.is_none_or(|total| {
                    floats_approx_equal(2.0 * holdings[*index].cost_basis.unwrap_or_default(), total)
                })
        })
        .collect::<Vec<_>>();
    (candidates.len() == 1).then_some(candidates[0])
}

fn floats_approx_equal(left: f64, right: f64) -> bool {
    (left - right).abs() <= 1e-6 * left.abs().max(right.abs()).max(1.0)
}

fn within_reconcile_tolerance(total: f64, target: f64) -> bool {
    (total - target).abs() <= RECONCILE_TOLERANCE * target.abs().max(1.0)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::clients::plaid::Holding;

    use super::dedupe_aggregate_holdings;

    #[test]
    fn drops_only_reconciled_unambiguous_rollups() {
        for (holdings, balances, rows, quantity) in [
            (
                vec![
                    holding("acc", "vgit", 74.0, 4366.0, Some(4451.0)),
                    holding("acc", "vgit", 100.0, 5900.0, Some(6016.0)),
                    holding("acc", "vgit", 121.0, 7139.0, Some(7012.0)),
                    holding("acc", "vgit", 295.0, 17405.0, Some(17479.0)),
                ],
                HashMap::from([("acc".to_owned(), 17405.0)]),
                3,
                295.0,
            ),
            (
                vec![
                    holding("acc", "vti", 100.0, 10000.0, Some(9000.0)),
                    holding("acc", "vti", 200.0, 20000.0, Some(18000.0)),
                    holding("acc", "vti", 300.0, 30000.0, Some(27000.0)),
                ],
                HashMap::from([("acc".to_owned(), 60000.0)]),
                3,
                600.0,
            ),
            (
                vec![
                    holding("acc", "vti", 100.0, 36365.0, Some(30000.0)),
                    holding("acc", "vti", 100.0, 36365.0, Some(30000.0)),
                ],
                HashMap::from([("acc".to_owned(), 72730.0)]),
                2,
                200.0,
            ),
            (
                vec![
                    holding("acc", "vgit", 74.0, 4366.0, None),
                    holding("acc", "vgit", 100.0, 5900.0, None),
                    holding("acc", "vgit", 121.0, 7139.0, None),
                    holding("acc", "vgit", 295.0, 17405.0, None),
                ],
                HashMap::from([("acc".to_owned(), 17405.0)]),
                3,
                295.0,
            ),
        ] {
            let result = dedupe_aggregate_holdings(&holdings, &balances);
            assert_eq!(result.len(), rows);
            assert_eq!(result.iter().map(|holding| holding.quantity).sum::<f64>(), quantity);
        }
    }

    #[test]
    fn keeps_rows_without_an_account_balance_and_isolates_groups() {
        let holdings = vec![
            holding("acc1", "vti", 50.0, 18000.0, Some(15000.0)),
            holding("acc1", "vti", 50.0, 18000.0, Some(16000.0)),
            holding("acc1", "vti", 100.0, 36000.0, Some(31000.0)),
            holding("acc2", "vti", 100.0, 36000.0, Some(31000.0)),
            holding("acc1", "vxus", 30.0, 2500.0, Some(2400.0)),
        ];
        assert_eq!(dedupe_aggregate_holdings(&holdings, &HashMap::new()).len(), 5);

        let result = dedupe_aggregate_holdings(
            &holdings,
            &HashMap::from([("acc1".to_owned(), 38500.0), ("acc2".to_owned(), 36000.0)]),
        );
        assert_eq!(result.len(), 4);
        assert_eq!(
            result
                .iter()
                .filter(|holding| holding.account_id == "acc1" && holding.security_id == "vti")
                .map(|holding| holding.quantity)
                .sum::<f64>(),
            100.0
        );
    }

    fn holding(
        account_id: &str,
        security_id: &str,
        quantity: f64,
        institution_value: f64,
        cost_basis: Option<f64>,
    ) -> Holding {
        Holding {
            account_id: account_id.to_owned(),
            security_id: security_id.to_owned(),
            quantity,
            institution_value,
            cost_basis,
            ..Default::default()
        }
    }
}
