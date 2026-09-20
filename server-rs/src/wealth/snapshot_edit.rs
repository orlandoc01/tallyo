use std::collections::HashMap;

use anyhow::Result;
use sqlx::SqlitePool;

use crate::{
    apierror::ApiError,
    ids::{GlobalId, GlobalIdType},
    money::Cents,
    schema::SnapshotHoldingInput,
};

use super::{SnapshotEdit, SnapshotEditHolding, SnapshotHolding, SnapshotRow, store};

pub(super) async fn snapshot_edit_holdings(
    pool: &SqlitePool,
    inputs: &[SnapshotHoldingInput],
    previous: &[SnapshotHolding],
) -> Result<Vec<SnapshotEditHolding>> {
    let counts_by_asset = previous
        .iter()
        .map(|holding| (holding.asset.id, holding.counts_toward_value))
        .collect::<HashMap<_, _>>();
    let assets_by_id = previous
        .iter()
        .map(|holding| (holding.asset.id, holding.asset.clone()))
        .collect::<HashMap<_, _>>();
    let mut holdings = Vec::with_capacity(inputs.len());
    for input in inputs {
        let asset_id = GlobalId::decode(input.asset_id.as_str())?.i64_of_type(GlobalIdType::Asset)?;
        let asset = match assets_by_id.get(&asset_id) {
            Some(asset) => asset.clone(),
            None => store::asset_by_id(pool, asset_id)
                .await?
                .ok_or_else(|| ApiError::bad_input(format!("asset {asset_id} not found")))?,
        };
        let quantity = if asset.classifier == crate::schema::AssetClassifier::Cash {
            Some(input.quantity.unwrap_or_else(|| input.value_usd.dollars()))
        } else {
            input.quantity
        };
        holdings.push(SnapshotEditHolding {
            asset_id,
            quantity,
            price: (asset.classifier == crate::schema::AssetClassifier::Cash)
                .then_some(1.0)
                .or_else(|| {
                    quantity
                        .filter(|quantity| *quantity != 0.0)
                        .map(|quantity| input.value_usd.dollars() / quantity)
                }),
            value_usd: input.value_usd,
            counts_toward_value: counts_by_asset.get(&asset_id).copied().unwrap_or(true),
            manual: false,
        });
    }
    Ok(holdings)
}

pub(super) async fn propagated_manual_snapshot_edits(
    pool: &SqlitePool,
    edited_row: &SnapshotRow,
    previous_holdings: &[SnapshotHolding],
    edited_holdings: &[SnapshotEditHolding],
) -> Result<Vec<SnapshotEdit>> {
    let newer = store::newer_snapshots_for_account(pool, edited_row.account_id, &edited_row.date).await?;
    if newer.is_empty() {
        return Ok(Vec::new());
    }
    let ids = newer.iter().map(|row| row.id).collect::<Vec<_>>();
    let holdings = store::snapshot_holdings_by_snapshot_ids(pool, &ids).await?;
    let edited_balance = super::snapshot_editor::snapshot_edit_balance_usd(edited_holdings);
    let mut edits = Vec::new();
    for row in newer {
        let newer_holdings = holdings.get(&row.id).map(Vec::as_slice).unwrap_or_default();
        if !is_pure_carry_forward(
            previous_holdings,
            edited_row.balance_usd,
            newer_holdings,
            row.balance_usd,
        ) {
            break;
        }
        let holdings = propagate_holdings_with_stored_prices(edited_holdings, newer_holdings);
        let balance_usd = if holdings.is_empty() {
            edited_balance
        } else {
            super::snapshot_editor::snapshot_edit_balance_usd(&holdings)
        };
        edits.push(SnapshotEdit {
            id: row.id,
            account_id: row.account_id,
            date: row.date,
            balance_usd,
            holdings,
        });
    }
    Ok(edits)
}

pub(super) fn is_manual_snapshot_source(source: &str) -> bool {
    matches!(source, "manual" | "realestate")
}

fn is_pure_carry_forward(
    previous: &[SnapshotHolding],
    previous_balance: Cents,
    next: &[SnapshotHolding],
    next_balance: Cents,
) -> bool {
    if previous.is_empty() && next.is_empty() {
        return previous_balance == next_balance;
    }
    previous.len() == next.len()
        && next.iter().all(|holding| {
            previous
                .iter()
                .find(|previous| previous.asset.id == holding.asset.id)
                .is_some_and(|previous| previous.quantity == holding.quantity)
        })
}

fn propagate_holdings_with_stored_prices(
    edited: &[SnapshotEditHolding],
    carried: &[SnapshotHolding],
) -> Vec<SnapshotEditHolding> {
    let prices = carried
        .iter()
        .map(|holding| (holding.asset.id, holding.price))
        .collect::<HashMap<_, _>>();
    edited
        .iter()
        .map(|holding| {
            let price = prices.get(&holding.asset_id).copied().flatten().or(holding.price);
            SnapshotEditHolding {
                price,
                value_usd: price
                    .zip(holding.quantity)
                    .map(|(price, quantity)| Cents::from_dollars(price * quantity))
                    .unwrap_or(holding.value_usd),
                ..holding.clone()
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use crate::{
        database::dbtest,
        ids::{GlobalId, GlobalIdType},
        money::Cents,
        schema::{AssetClassifier, AssetType, ConnectivityStatus, SnapshotHoldingInput},
        wealth::{Asset, SnapshotEditHolding, SnapshotHolding, SnapshotRow},
    };

    use super::{
        is_manual_snapshot_source, is_pure_carry_forward, propagated_manual_snapshot_edits, snapshot_edit_holdings,
    };

    #[test]
    fn recognizes_manual_sources() {
        assert!(is_manual_snapshot_source("manual"));
        assert!(is_manual_snapshot_source("realestate"));
        assert!(!is_manual_snapshot_source("plaid"));
    }

    #[test]
    fn quantity_identity_controls_carry_forward_detection() {
        let holding = |id, quantity| SnapshotHolding {
            asset: Asset {
                id,
                asset_type: AssetType::Security,
                identifier: "VTI".to_owned(),
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
            price: Some(100.0),
            value_usd: Cents(10_000),
            counts_toward_value: true,
            manual: true,
        };
        assert!(is_pure_carry_forward(
            &[holding(1, None)],
            Cents(1),
            &[holding(1, None)],
            Cents(2)
        ));
        assert!(!is_pure_carry_forward(
            &[holding(1, None)],
            Cents(1),
            &[holding(1, Some(1.0))],
            Cents(1)
        ));
    }

    #[tokio::test]
    async fn edits_cash_and_existing_holdings() -> Result<()> {
        let pool = dbtest::open().await?;
        sqlx::query(
            "INSERT INTO assets (id, asset_type, identifier, classifier) VALUES (2, 'SECURITY', 'stock', 'PUBLIC')",
        )
        .execute(&pool)
        .await?;
        let previous = [SnapshotHolding {
            asset: Asset {
                id: 2,
                asset_type: AssetType::Security,
                identifier: "stock".to_owned(),
                name: None,
                classifier: AssetClassifier::Public,
                current_price: None,
                forced_usd_price: None,
                tracking_ticker: None,
                tracking_multiplier: 1.0,
                price_connectivity: ConnectivityStatus::Healthy,
                investment_connectivity: ConnectivityStatus::Healthy,
            },
            quantity: Some(1.0),
            price: Some(10.0),
            value_usd: Cents(1_000),
            counts_toward_value: false,
            manual: false,
        }];
        let asset_id = |id| async_graphql::ID::from(GlobalId::new(GlobalIdType::Asset, id).encoded_string());

        let holdings = snapshot_edit_holdings(
            &pool,
            &[
                SnapshotHoldingInput {
                    asset_id: asset_id(1),
                    quantity: None,
                    value_usd: Cents(250),
                },
                SnapshotHoldingInput {
                    asset_id: asset_id(2),
                    quantity: Some(2.0),
                    value_usd: Cents(10_000),
                },
            ],
            &previous,
        )
        .await?;

        assert_eq!(holdings[0].quantity, Some(2.5));
        assert_eq!(holdings[0].price, Some(1.0));
        assert_eq!(holdings[1].price, Some(50.0));
        assert!(!holdings[1].counts_toward_value);
        Ok(())
    }

    #[tokio::test]
    async fn propagates_only_contiguous_carry_forward_snapshots() -> Result<()> {
        let pool = dbtest::open().await?;
        sqlx::query("INSERT INTO owners (id, name) VALUES (2, 'Owner')")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES (2, 'account', 2, 'Account', 'DEPOSITORY')")
            .execute(&pool)
            .await?;
        sqlx::query(
            "INSERT INTO assets (id, asset_type, identifier, classifier) VALUES (2, 'SECURITY', 'stock', 'PUBLIC')",
        )
        .execute(&pool)
        .await?;
        sqlx::query("INSERT INTO account_balance_daily_snapshots (id, account_id, source, date, synced_at, balance_usd_cents) VALUES (20, 2, 'manual', '2026-01-01', '2026-01-01T12:00:00Z', 10000), (21, 2, 'manual', '2026-01-02', '2026-01-02T12:00:00Z', 10000), (22, 2, 'manual', '2026-01-03', '2026-01-03T12:00:00Z', 15000)")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO asset_daily_holdings (snapshot_id, account_id, date, asset_id, quantity, price, value_usd_cents) VALUES (21, 2, '2026-01-02', 2, 1, 50, 5000), (22, 2, '2026-01-03', 2, 3, 50, 15000)")
            .execute(&pool)
            .await?;
        let asset = Asset {
            id: 2,
            asset_type: AssetType::Security,
            identifier: "stock".to_owned(),
            name: None,
            classifier: AssetClassifier::Public,
            current_price: None,
            forced_usd_price: None,
            tracking_ticker: None,
            tracking_multiplier: 1.0,
            price_connectivity: ConnectivityStatus::Healthy,
            investment_connectivity: ConnectivityStatus::Healthy,
        };

        let edits = propagated_manual_snapshot_edits(
            &pool,
            &SnapshotRow {
                id: 20,
                account_id: 2,
                source: "manual".to_owned(),
                date: "2026-01-01".to_owned(),
                synced_at: "2026-01-01T12:00:00Z".parse()?,
                balance_usd: Cents(10_000),
                flagged: false,
                account_type: crate::accounts::AccountType::Depository,
            },
            &[SnapshotHolding {
                asset,
                quantity: Some(1.0),
                price: Some(50.0),
                value_usd: Cents(5_000),
                counts_toward_value: true,
                manual: true,
            }],
            &[SnapshotEditHolding {
                asset_id: 2,
                quantity: Some(2.0),
                price: Some(60.0),
                value_usd: Cents(12_000),
                counts_toward_value: true,
                manual: true,
            }],
        )
        .await?;

        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0].id, 21);
        assert_eq!(edits[0].balance_usd, Cents(10_000));
        assert_eq!(edits[0].holdings[0].price, Some(50.0));
        Ok(())
    }
}
