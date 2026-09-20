use std::collections::HashMap;

use crate::{
    accounts::store::account_by_id,
    apierror::ApiError,
    ids::{Date, GlobalId, GlobalIdType},
    money::Cents,
    schema::{AccountSnapshotInput, ChangeAccountSnapshotInput},
};
use anyhow::{Result, ensure};

use super::{
    AccountSnapshot, ChangeAccountSnapshotResult, SnapshotHolding, SnapshotRow, WealthService,
    liabilities::is_liability_type,
    snapshot_edit::{is_manual_snapshot_source, propagated_manual_snapshot_edits, snapshot_edit_holdings},
    store,
    timezone::local_date,
};

impl WealthService {
    pub async fn account_snapshot(&self, input: AccountSnapshotInput) -> Result<Option<AccountSnapshot>> {
        let row = self.account_snapshot_row(input).await?;
        match row {
            Some(row) => self.account_snapshot_model(row).await.map(Some),
            None => Ok(None),
        }
    }

    pub async fn account_latest_snapshots(&self, account_ids: &[i64]) -> Result<HashMap<i64, AccountSnapshot>> {
        let rows = store::latest_snapshots_for_accounts(&self.pool, account_ids).await?;
        let snapshot_ids = rows.values().map(|row| row.id).collect::<Vec<_>>();
        let holdings = store::snapshot_holdings_by_snapshot_ids(&self.pool, &snapshot_ids).await?;
        rows.into_iter()
            .map(|(account_id, row)| {
                self.account_snapshot_model_from_parts(row.clone(), holdings.get(&row.id).cloned().unwrap_or_default())
                    .map(|snapshot| (account_id, snapshot))
            })
            .collect()
    }

    pub async fn change_account_snapshot(
        &self,
        input: ChangeAccountSnapshotInput,
    ) -> Result<ChangeAccountSnapshotResult> {
        let snapshot_id = local_id(&input.snapshot_id, GlobalIdType::AccountSnapshot)?;
        let row = store::snapshot_by_id(&self.pool, snapshot_id)
            .await?
            .ok_or_else(|| ApiError::bad_input(format!("snapshot {:?} not found", input.snapshot_id.as_str())))?;
        let previous_holdings = store::snapshot_holdings_by_snapshot_id(&self.pool, row.id).await?;
        let holdings = snapshot_edit_holdings(&self.pool, &input.holdings, &previous_holdings).await?;
        let manual = is_manual_snapshot_source(&row.source);
        let holdings = holdings
            .into_iter()
            .map(|holding| super::SnapshotEditHolding { manual, ..holding })
            .collect::<Vec<_>>();
        let edit = super::SnapshotEdit {
            id: row.id,
            account_id: row.account_id,
            date: row.date.clone(),
            balance_usd: snapshot_edit_balance_usd(&holdings),
            holdings: holdings.clone(),
        };
        let propagated = if manual {
            propagated_manual_snapshot_edits(&self.pool, &row, &previous_holdings, &holdings).await?
        } else {
            Vec::new()
        };
        let mut edits = vec![edit];
        edits.extend(propagated);
        store::update_account_snapshots(&self.pool, &edits).await?;
        let updated = store::snapshot_by_id(&self.pool, row.id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("snapshot {:?} not found after update", input.snapshot_id.as_str()))?;
        let account = account_by_id(&self.pool, row.account_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("account {} not found", row.account_id))?;
        Ok(ChangeAccountSnapshotResult {
            snapshot: self.account_snapshot_model(updated).await?,
            account,
        })
    }

    async fn account_snapshot_row(&self, input: AccountSnapshotInput) -> Result<Option<SnapshotRow>> {
        ensure!(
            input.snapshot_id.is_some() != input.account_id.is_some(),
            ApiError::bad_input("provide exactly one of snapshotId or accountId")
        );
        match (input.snapshot_id, input.account_id) {
            (Some(snapshot_id), None) => {
                store::snapshot_by_id(&self.pool, local_id(&snapshot_id, GlobalIdType::AccountSnapshot)?).await
            }
            (None, Some(account_id)) => {
                let account_id = local_id(&account_id, GlobalIdType::Account)?;
                match input.date {
                    Some(date) => {
                        let window = super::timezone::local_day_window(&date, &(self.timezone)())?;
                        store::latest_snapshot_in_window(
                            &self.pool,
                            account_id,
                            &window.start.to_rfc3339(),
                            &window.end.to_rfc3339(),
                        )
                        .await
                    }
                    None => store::latest_snapshot_for_account(&self.pool, account_id).await,
                }
            }
            _ => unreachable!("validated exactly one snapshot selector"),
        }
    }

    async fn account_snapshot_model(&self, row: SnapshotRow) -> Result<AccountSnapshot> {
        let holdings = store::snapshot_holdings_by_snapshot_id(&self.pool, row.id).await?;
        self.account_snapshot_model_from_parts(row, holdings)
    }

    pub(super) fn account_snapshot_model_from_parts(
        &self,
        row: SnapshotRow,
        holdings: Vec<SnapshotHolding>,
    ) -> Result<AccountSnapshot> {
        let date = Date::new(local_date(row.synced_at, &(self.timezone)()))?;
        let account_id = super::holding::global_id(GlobalIdType::Account, row.account_id);
        Ok(AccountSnapshot {
            id: row.id,
            date,
            balance_usd: row.balance_usd,
            net_contribution_usd: if is_liability_type(row.account_type) { -row.balance_usd } else { row.balance_usd },
            holdings: Some(
                holdings
                    .into_iter()
                    .map(|holding| super::Holding {
                        asset_id: super::holding::global_id(GlobalIdType::Asset, holding.asset.id),
                        asset: holding.asset,
                        account_id: account_id.clone(),
                        quantity: holding.quantity,
                        value_usd: holding.value_usd,
                        manual: holding.manual,
                    })
                    .collect(),
            ),
            account_id,
            flagged: row.flagged,
        })
    }
}

pub(super) fn snapshot_edit_balance_usd(holdings: &[super::SnapshotEditHolding]) -> Cents {
    holdings
        .iter()
        .filter(|holding| holding.counts_toward_value)
        .map(|holding| holding.value_usd)
        .sum()
}

fn local_id(value: &async_graphql::ID, expected: GlobalIdType) -> Result<i64> {
    GlobalId::decode(value.as_str())?.i64_of_type(expected)
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::{WealthService, snapshot_edit_balance_usd};
    use crate::{
        database::dbtest,
        ids::{Date, GlobalId, GlobalIdType},
        money::Cents,
        schema::{AccountSnapshotInput, ChangeAccountSnapshotInput, SnapshotHoldingInput},
        wealth::SnapshotEditHolding,
    };

    #[test]
    fn snapshot_edit_balance_uses_only_counting_holdings() {
        let holdings = [
            SnapshotEditHolding {
                asset_id: 1,
                quantity: Some(1.0),
                price: Some(10.0),
                value_usd: Cents(1_000),
                counts_toward_value: true,
                manual: false,
            },
            SnapshotEditHolding {
                asset_id: 2,
                quantity: None,
                price: None,
                value_usd: Cents(2_000),
                counts_toward_value: false,
                manual: false,
            },
        ];
        assert_eq!(snapshot_edit_balance_usd(&holdings), Cents(1_000));
    }

    async fn seed_snapshot_fixture(pool: &sqlx::SqlitePool) -> Result<()> {
        sqlx::query("INSERT INTO owners (id, name) VALUES (2, 'Owner')")
            .execute(pool)
            .await?;
        sqlx::query("INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES (2, 'asset', 2, 'Asset', 'DEPOSITORY'), (3, 'debt', 2, 'Debt', 'CREDIT')")
            .execute(pool)
            .await?;
        sqlx::query(
            "INSERT INTO assets (id, asset_type, identifier, classifier) VALUES (2, 'SECURITY', 'stock', 'PUBLIC')",
        )
        .execute(pool)
        .await?;
        sqlx::query("INSERT INTO account_balance_daily_snapshots (id, account_id, source, date, synced_at, balance_usd_cents, flagged) VALUES (20, 2, 'manual', '2026-01-01', '2026-01-01T12:00:00Z', 10000, 0), (21, 2, 'manual', '2026-01-02', '2026-01-02T12:00:00Z', 10000, 0), (30, 3, 'manual', '2026-01-01', '2026-01-01T12:00:00Z', -5000, 1)")
            .execute(pool)
            .await?;
        sqlx::query("INSERT INTO asset_daily_holdings (snapshot_id, account_id, date, asset_id, quantity, price, value_usd_cents, counts_toward_value) VALUES (20, 2, '2026-01-01', 2, 1, 50, 10000, 1), (21, 2, '2026-01-02', 2, 1, 50, 5000, 1)")
            .execute(pool)
            .await?;
        Ok(())
    }

    fn global_id(typ: GlobalIdType, id: i64) -> async_graphql::ID {
        GlobalId::new(typ, id).encoded_string().into()
    }

    #[tokio::test]
    async fn resolves_snapshot_selectors_and_latest_snapshots() -> Result<()> {
        let pool = dbtest::open().await?;
        seed_snapshot_fixture(&pool).await?;
        let service = WealthService::new(pool, None, || "UTC".to_owned());

        let by_id = service
            .account_snapshot(AccountSnapshotInput {
                snapshot_id: Some(global_id(GlobalIdType::AccountSnapshot, 20)),
                account_id: None,
                date: None,
            })
            .await?
            .unwrap();
        let by_day = service
            .account_snapshot(AccountSnapshotInput {
                snapshot_id: None,
                account_id: Some(global_id(GlobalIdType::Account, 2)),
                date: Some(Date::new("2026-01-01")?),
            })
            .await?
            .unwrap();
        let latest_by_account = service
            .account_snapshot(AccountSnapshotInput {
                snapshot_id: None,
                account_id: Some(global_id(GlobalIdType::Account, 2)),
                date: None,
            })
            .await?
            .unwrap();
        let latest = service.account_latest_snapshots(&[2, 3]).await?;

        assert_eq!(by_id.id, 20);
        assert_eq!(by_day.date.as_str(), "2026-01-01");
        assert_eq!(latest_by_account.id, 21);
        assert_eq!(latest[&2].id, 21);
        assert_eq!(latest[&3].net_contribution_usd, Cents(5_000));
        assert!(latest[&3].flagged);
        assert!(
            service
                .account_snapshot(AccountSnapshotInput {
                    snapshot_id: None,
                    account_id: None,
                    date: None,
                })
                .await
                .is_err()
        );
        Ok(())
    }

    #[tokio::test]
    async fn changes_manual_snapshots_and_propagates_stored_prices() -> Result<()> {
        let pool = dbtest::open().await?;
        seed_snapshot_fixture(&pool).await?;
        let service = WealthService::new(pool, None, || "UTC".to_owned());

        let changed = service
            .change_account_snapshot(ChangeAccountSnapshotInput {
                snapshot_id: global_id(GlobalIdType::AccountSnapshot, 20),
                holdings: vec![SnapshotHoldingInput {
                    asset_id: global_id(GlobalIdType::Asset, 2),
                    quantity: Some(2.0),
                    value_usd: Cents(12_000),
                }],
            })
            .await?;
        let propagated = service
            .account_snapshot(AccountSnapshotInput {
                snapshot_id: Some(global_id(GlobalIdType::AccountSnapshot, 21)),
                account_id: None,
                date: None,
            })
            .await?
            .unwrap();

        assert_eq!(changed.snapshot.balance_usd, Cents(12_000));
        assert!(changed.snapshot.holdings.as_ref().unwrap()[0].manual);
        assert_eq!(propagated.balance_usd, Cents(10_000));
        assert_eq!(propagated.holdings.as_ref().unwrap()[0].quantity, Some(2.0));
        Ok(())
    }
}
