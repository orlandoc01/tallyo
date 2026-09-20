use anyhow::Result;
use sqlx::SqlitePool;

use crate::{
    accounts::Account,
    database::queries,
    ids::Date,
    wealth::{AccountFilter, CurrentHolding, LiabilityAccountBalance},
};

pub async fn current_holdings(pool: &SqlitePool, filter: &AccountFilter) -> Result<Vec<CurrentHolding>> {
    queries::list_current_account_holdings(
        pool,
        queries::ListCurrentAccountHoldingsParams {
            as_of_start: filter.as_of.map(|window| window.start.into()),
            as_of_end: filter.as_of.map(|window| window.end.into()),
            owner_ids: optional_ids(&filter.owner_ids),
            account_ids: optional_ids(&filter.account_ids),
            asset_ids: optional_ids(&filter.asset_ids),
            exclude_liabilities: filter.exclude_liabilities,
            ..Default::default()
        },
    )
    .await?
    .into_iter()
    .map(|row| {
        Ok(CurrentHolding {
            account: (row.accounts, row.owner_name).into(),
            asset: row.assets.try_into()?,
            quantity: row.quantity,
            value_usd: row.value_usd_cents,
            manual: row.manual,
            snapshot_date: Date::new(row.date)?,
        })
    })
    .collect()
}

pub async fn latest_liability_account_balances(
    pool: &SqlitePool,
    filter: &AccountFilter,
) -> Result<Vec<LiabilityAccountBalance>> {
    queries::list_latest_liability_account_balances(
        pool,
        queries::ListLatestLiabilityAccountBalancesParams {
            as_of_start: filter.as_of.map(|window| window.start.into()),
            as_of_end: filter.as_of.map(|window| window.end.into()),
            owner_ids: optional_ids(&filter.owner_ids),
            account_ids: optional_ids(&filter.account_ids),
        },
    )
    .await?
    .into_iter()
    .map(|row| {
        Ok(LiabilityAccountBalance {
            account: Account::from((row.accounts, row.owner_name)),
            balance_usd: row.balance_usd_cents,
        })
    })
    .collect()
}

pub async fn account_last_balance_synced_at_for_accounts(
    pool: &SqlitePool,
    account_ids: &[i64],
) -> Result<std::collections::HashMap<i64, chrono::DateTime<chrono::Utc>>> {
    if account_ids.is_empty() {
        return Ok(Default::default());
    }
    Ok(queries::account_last_balance_synced_at_for_accounts(
        pool,
        queries::AccountLastBalanceSyncedAtForAccountsParams { account_ids },
    )
    .await?
    .into_iter()
    .filter_map(|row| {
        row.last_balance_synced_at
            .map(|synced_at| (row.account_id, synced_at.into()))
    })
    .collect())
}

fn optional_ids(ids: &[i64]) -> Option<&[i64]> {
    (!ids.is_empty()).then_some(ids)
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::{
        account_last_balance_synced_at_for_accounts, current_holdings, latest_liability_account_balances, optional_ids,
    };
    use crate::{
        database::dbtest,
        wealth::{AccountFilter, LocalDayWindow},
    };

    #[tokio::test]
    async fn returns_current_holdings_liabilities_and_sync_times() -> Result<()> {
        let pool = dbtest::open().await?;
        sqlx::query("INSERT INTO owners (id, name) VALUES (1, 'Owner')")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES (1, 'checking', 1, 'Checking', 'CHECKING'), (2, 'credit', 1, 'Credit', 'CREDIT')")
            .execute(&pool)
            .await?;
        let asset_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO assets (asset_type, identifier, classifier) VALUES ('SECURITY', 'VTI', 'PUBLIC') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        sqlx::query("INSERT INTO account_balance_daily_snapshots (id, account_id, source, date, synced_at, balance_usd_cents, flagged) VALUES (1, 1, 'test', '2026-01-01', '2026-01-01T00:00:00Z', 100, 0), (2, 2, 'test', '2026-01-01', '2026-01-01T00:00:00Z', -50, 0)")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO asset_daily_holdings (snapshot_id, account_id, date, asset_id, value_usd_cents) VALUES (1, 1, '2026-01-01', ?, 100)")
            .bind(asset_id)
            .execute(&pool)
            .await?;
        sqlx::query(
            "INSERT INTO account_sync_state (account_id, last_balance_synced_at) VALUES (1, '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await?;

        assert_eq!(current_holdings(&pool, &AccountFilter::default()).await?.len(), 1);
        assert_eq!(
            latest_liability_account_balances(&pool, &AccountFilter::default()).await?[0]
                .balance_usd
                .0,
            -50
        );
        assert!(
            account_last_balance_synced_at_for_accounts(&pool, &[1])
                .await?
                .contains_key(&1)
        );
        assert!(
            account_last_balance_synced_at_for_accounts(&pool, &[])
                .await?
                .is_empty()
        );
        assert_eq!(optional_ids(&[]), None);
        assert_eq!(optional_ids(&[1]), Some(&[1][..]));
        Ok(())
    }

    #[tokio::test]
    async fn as_of_date_selects_the_latest_snapshot_on_or_before_it() -> Result<()> {
        let pool = dbtest::open().await?;
        sqlx::query("INSERT INTO owners (id, name) VALUES (1, 'Owner')")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO owners (id, name) VALUES (2, 'Other')")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO accounts (id, external_id, owner_id, name, type, is_closed) VALUES (1, 'checking', 1, 'Checking', 'CHECKING', 0), (2, 'credit', 1, 'Credit', 'CREDIT', 0), (3, 'old', 1, 'Old', 'CHECKING', 1), (4, 'old-card', 2, 'Old card', 'CREDIT', 1)")
            .execute(&pool)
            .await?;
        let asset_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO assets (asset_type, identifier, classifier) VALUES ('SECURITY', 'VTI', 'PUBLIC') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        sqlx::query("INSERT INTO account_balance_daily_snapshots (id, account_id, source, date, synced_at, balance_usd_cents, flagged) VALUES (1, 1, 'test', '2026-01-01', '2026-01-01T00:00:00Z', 100, 0), (2, 1, 'test', '2026-02-01', '2026-02-01T00:00:00Z', 200, 0), (3, 2, 'test', '2026-01-01', '2026-01-01T00:00:00Z', -50, 0), (4, 2, 'test', '2026-02-01', '2026-02-01T00:00:00Z', -80, 0), (5, 3, 'test', '2026-01-15', '2026-01-15T23:30:00Z', 300, 0), (6, 4, 'test', '2026-01-10', '2026-01-10T12:00:00Z', -30, 0)")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO asset_daily_holdings (snapshot_id, account_id, date, asset_id, value_usd_cents) VALUES (1, 1, '2026-01-01', ?1, 100), (2, 1, '2026-02-01', ?1, 200), (5, 3, '2026-01-15', ?1, 300)")
            .bind(asset_id)
            .execute(&pool)
            .await?;

        fn utc_day(date: &str) -> Result<LocalDayWindow> {
            Ok(LocalDayWindow {
                start: format!("{date}T00:00:00Z").parse()?,
                end: format!("{date}T00:00:00Z").parse::<chrono::DateTime<chrono::Utc>>()? + chrono::Days::new(1),
            })
        }
        fn filter(as_of_date: Option<&str>) -> Result<AccountFilter> {
            Ok(AccountFilter {
                as_of: as_of_date.map(utc_day).transpose()?,
                ..Default::default()
            })
        }
        async fn holding_values(pool: &sqlx::SqlitePool, as_of_date: Option<&str>) -> Result<Vec<(i64, i64)>> {
            Ok(current_holdings(pool, &filter(as_of_date)?)
                .await?
                .into_iter()
                .map(|holding| (holding.account.id, holding.value_usd.0))
                .collect())
        }
        async fn liability_values(pool: &sqlx::SqlitePool, filter: &AccountFilter) -> Result<Vec<i64>> {
            Ok(latest_liability_account_balances(pool, filter)
                .await?
                .into_iter()
                .map(|balance| balance.balance_usd.0)
                .collect())
        }

        // Current position: latest snapshots, closed account dropped.
        assert_eq!(holding_values(&pool, None).await?, vec![(1, 200)]);
        assert_eq!(liability_values(&pool, &filter(None)?).await?, vec![-80]);
        // On the closed account's final snapshot date it still counts.
        assert_eq!(
            holding_values(&pool, Some("2026-01-15")).await?,
            vec![(1, 100), (3, 300)]
        );
        assert_eq!(liability_values(&pool, &filter(Some("2026-01-15"))?).await?, vec![-50]);
        // A closed liability account counts on its final snapshot day, and the
        // owner/account filters compose with the window.
        assert_eq!(
            liability_values(&pool, &filter(Some("2026-01-10"))?).await?,
            vec![-50, -30]
        );
        assert_eq!(
            liability_values(
                &pool,
                &AccountFilter {
                    owner_ids: vec![2],
                    ..filter(Some("2026-01-10"))?
                }
            )
            .await?,
            vec![-30]
        );
        assert_eq!(
            liability_values(
                &pool,
                &AccountFilter {
                    account_ids: vec![2],
                    ..filter(Some("2026-01-10"))?
                }
            )
            .await?,
            vec![-50]
        );
        assert_eq!(
            holding_values(&pool, Some("2026-01-15")).await?,
            current_holdings(
                &pool,
                &AccountFilter {
                    owner_ids: vec![1],
                    ..filter(Some("2026-01-15"))?
                }
            )
            .await?
            .into_iter()
            .map(|holding| (holding.account.id, holding.value_usd.0))
            .collect::<Vec<_>>()
        );
        // Past its final snapshot the closed account drops out; open accounts forward-fill.
        assert_eq!(holding_values(&pool, Some("2026-01-20")).await?, vec![(1, 100)]);
        // Before any snapshot there is nothing to report.
        assert!(holding_values(&pool, Some("2025-12-31")).await?.is_empty());
        assert!(liability_values(&pool, &filter(Some("2025-12-31"))?).await?.is_empty());
        Ok(())
    }
}
