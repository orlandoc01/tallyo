use crate::{money::Cents, wealth::AssetDailyHolding};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct InvestmentSnapshotDraft {
    pub holdings: Vec<AssetDailyHolding>,
    pub total: f64,
    pub balance_usd: Cents,
}

impl InvestmentSnapshotDraft {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&mut self, holding: AssetDailyHolding) {
        self.total += holding.value_usd;
        self.balance_usd = Cents::from_dollars(self.total);
        if let Some(existing) = self
            .holdings
            .iter_mut()
            .find(|existing| holding_key(existing) == holding_key(&holding))
        {
            existing.quantity = existing
                .quantity
                .zip(holding.quantity)
                .map(|(left, right)| left + right);
            existing.value_usd += holding.value_usd;
            existing.price = existing.price.or(holding.price);
            return;
        }
        self.holdings.push(holding);
    }
}

fn holding_key(holding: &AssetDailyHolding) -> String {
    holding
        .asset
        .as_ref()
        .map_or_else(|| holding.asset_id.to_string(), |asset| asset.identifier.clone())
}

#[cfg(test)]
mod tests {
    use super::InvestmentSnapshotDraft;
    use crate::wealth::AssetDailyHolding;

    #[test]
    fn folds_matching_lots_and_retains_distinct_holdings() {
        for (holdings, quantities, values) in [
            (
                vec![
                    holding(1, "one", Some(2.0), 10.0, Some(5.0)),
                    holding(1, "one", Some(3.0), 18.0, Some(6.0)),
                ],
                vec![Some(5.0)],
                vec![28.0],
            ),
            (
                vec![
                    holding(1, "one", Some(2.0), 10.0, Some(5.0)),
                    holding(1, "one", None, 18.0, Some(6.0)),
                ],
                vec![None],
                vec![28.0],
            ),
            (
                vec![
                    holding(1, "one", None, 10.0, Some(5.0)),
                    holding(1, "one", Some(3.0), 18.0, Some(6.0)),
                ],
                vec![None],
                vec![28.0],
            ),
            (
                vec![
                    holding(1, "one", None, 10.0, Some(5.0)),
                    holding(1, "one", None, 18.0, Some(6.0)),
                ],
                vec![None],
                vec![28.0],
            ),
            (
                vec![
                    holding(1, "one", Some(2.0), 10.0, Some(5.0)),
                    holding(2, "two", Some(3.0), 4.0, None),
                ],
                vec![Some(2.0), Some(3.0)],
                vec![10.0, 4.0],
            ),
        ] {
            let mut draft = InvestmentSnapshotDraft::new();
            for holding in holdings {
                draft.add(holding);
            }
            assert_eq!(
                draft
                    .holdings
                    .iter()
                    .map(|holding| holding.quantity)
                    .collect::<Vec<_>>(),
                quantities
            );
            assert_eq!(
                draft
                    .holdings
                    .iter()
                    .map(|holding| holding.value_usd)
                    .collect::<Vec<_>>(),
                values
            );
        }
    }

    fn holding(
        asset_id: i64,
        identifier: &str,
        quantity: Option<f64>,
        value_usd: f64,
        price: Option<f64>,
    ) -> AssetDailyHolding {
        AssetDailyHolding {
            asset_id,
            asset: None,
            adapter_source: None,
            adapter_sources: Vec::new(),
            price_update: None,
            quantity,
            price,
            value_usd,
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
}
