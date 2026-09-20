use std::collections::HashMap;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use crate::{
    accounts::AccountType,
    database::{Timestamp, queries},
    wealth::{
        AccountFilter, AssetDailyHolding, ClassifierSnapshotValue, LastUnflaggedSnapshotResult, SnapshotHolding,
        SnapshotRow, SnapshotTimestampRange, SnapshotValue,
    },
};

use super::snapshots::parse_snapshot_timestamp;

pub async fn latest_unflagged_snapshot_with_holdings(
    pool: &SqlitePool,
    account_id: i64,
    date: &str,
) -> Result<LastUnflaggedSnapshotResult> {
    let rows = queries::latest_unflagged_snapshot_holdings(
        pool,
        queries::LatestUnflaggedSnapshotHoldingsParams { account_id, date },
    )
    .await?;
    let Some(first) = rows.first() else {
        return Ok(LastUnflaggedSnapshotResult {
            found: false,
            amount_usd: Default::default(),
            date: String::new(),
            holdings: Vec::new(),
        });
    };
    let amount_usd = crate::money::Cents(first.balance_usd_cents);
    let snapshot_date = first.date.clone();
    let mut holding_indexes = HashMap::new();
    let mut holdings = Vec::new();
    for row in rows {
        let Some(asset_id) = row.asset_id else {
            continue;
        };
        let source = adapter_source_from_row(&row)?;
        let index = *holding_indexes.entry(asset_id).or_insert_with(|| {
            holdings.push(AssetDailyHolding {
                asset_id,
                asset: None,
                adapter_source: None,
                adapter_sources: Vec::new(),
                price_update: None,
                quantity: row.quantity,
                price: row.price,
                value_usd: row.value_usd_cents.dollars(),
                counts_toward_value: row.counts_toward_value,
                manual: row.manual,
                line_type: String::new(),
                chain_id: String::new(),
                project_name: None,
                token_id: String::new(),
                identifier: row.identifier.clone().unwrap_or_default(),
                token_symbol: None,
                token_name: None,
                provider_price: None,
            });
            holdings.len() - 1
        });
        let Some(source) = source else {
            continue;
        };
        let holding = &mut holdings[index];
        holding.adapter_sources.push(source.clone());
        if holding.adapter_source.is_none() {
            holding.adapter_source = Some(source);
        }
    }
    Ok(LastUnflaggedSnapshotResult {
        found: true,
        amount_usd,
        date: snapshot_date,
        holdings,
    })
}

pub async fn account_balance_snapshot_values(
    pool: &SqlitePool,
    start_time: &str,
    end_time: &str,
    filter: &AccountFilter,
) -> Result<Vec<SnapshotValue>> {
    let (start_time, end_time) = snapshot_value_times("snapshot value", start_time, end_time)?;
    queries::account_balance_snapshot_values(
        pool,
        queries::AccountBalanceSnapshotValuesParams {
            owner_ids: optional_ids(&filter.owner_ids),
            account_ids: optional_ids(&filter.account_ids),
            start_time: start_time.into(),
            end_time: end_time.into(),
        },
    )
    .await?
    .into_iter()
    .map(|row| {
        Ok(SnapshotValue {
            account_id: row.account_id,
            account_type: account_type(&row.account_type),
            account_manual: row.account_manual,
            account_subtype: row.account_subtype,
            account_closed: row.account_is_closed,
            synced_at: row.synced_at.into(),
            balance_usd: row.balance_usd_cents,
        })
    })
    .collect()
}

pub async fn classifier_snapshot_values(
    pool: &SqlitePool,
    start_time: &str,
    end_time: &str,
    filter: &AccountFilter,
) -> Result<Vec<ClassifierSnapshotValue>> {
    let (start_time, end_time) = snapshot_value_times("classifier snapshot value", start_time, end_time)?;
    queries::classifier_snapshot_values(
        pool,
        queries::ClassifierSnapshotValuesParams {
            owner_ids: optional_ids(&filter.owner_ids),
            account_ids: optional_ids(&filter.account_ids),
            start_time: start_time.into(),
            end_time: end_time.into(),
        },
    )
    .await?
    .into_iter()
    .map(|row| {
        Ok(ClassifierSnapshotValue {
            account_id: row.account_id,
            account_closed: row.account_is_closed,
            synced_at: row.synced_at.into(),
            classifier: row
                .classifier
                .parse()
                .with_context(|| format!("parse asset classifier {:?}", row.classifier))?,
            value_usd: crate::money::Cents(row.value_usd_cents),
        })
    })
    .collect()
}

pub async fn account_balance_snapshot_timestamp_range(
    pool: &SqlitePool,
    filter: &AccountFilter,
) -> Result<SnapshotTimestampRange> {
    let row = queries::account_balance_snapshot_timestamp_range(
        pool,
        queries::AccountBalanceSnapshotTimestampRangeParams {
            owner_ids: optional_ids(&filter.owner_ids),
            account_ids: optional_ids(&filter.account_ids),
        },
    )
    .await?;
    Ok(SnapshotTimestampRange {
        earliest: optional_timestamp("earliest account balance snapshot synced_at", &row.earliest_synced_at)?,
        latest: optional_timestamp("latest account balance snapshot synced_at", &row.latest_synced_at)?,
    })
}

pub async fn snapshot_by_id(pool: &SqlitePool, id: i64) -> Result<Option<SnapshotRow>> {
    queries::get_account_balance_snapshot_by_id_opt(pool, queries::GetAccountBalanceSnapshotByIdParams { id })
        .await?
        .map(snapshot_row_from_fields)
        .transpose()
}

pub async fn latest_snapshot_in_window(
    pool: &SqlitePool,
    account_id: i64,
    start_time: &str,
    end_time: &str,
) -> Result<Option<SnapshotRow>> {
    let (start_time, end_time) = snapshot_value_times("snapshot window", start_time, end_time)?;
    queries::latest_account_balance_snapshot_in_window_opt(
        pool,
        queries::LatestAccountBalanceSnapshotInWindowParams {
            start_time: Some(start_time.into()),
            end_time: Some(end_time.into()),
            account_id,
        },
    )
    .await?
    .map(snapshot_row_from_fields)
    .transpose()
}

pub async fn latest_snapshot_for_account(pool: &SqlitePool, account_id: i64) -> Result<Option<SnapshotRow>> {
    queries::latest_account_balance_snapshot_in_window_opt(
        pool,
        queries::LatestAccountBalanceSnapshotInWindowParams {
            account_id,
            ..Default::default()
        },
    )
    .await?
    .map(snapshot_row_from_fields)
    .transpose()
}

pub async fn newer_snapshots_for_account(pool: &SqlitePool, account_id: i64, date: &str) -> Result<Vec<SnapshotRow>> {
    queries::newer_account_balance_snapshots_for_account(
        pool,
        queries::NewerAccountBalanceSnapshotsForAccountParams { account_id, date },
    )
    .await?
    .into_iter()
    .map(snapshot_row_from_fields)
    .collect()
}

pub async fn latest_snapshots_for_accounts(
    pool: &SqlitePool,
    account_ids: &[i64],
) -> Result<HashMap<i64, SnapshotRow>> {
    if account_ids.is_empty() {
        return Ok(HashMap::new());
    }
    queries::latest_account_balance_snapshots_for_accounts(
        pool,
        queries::LatestAccountBalanceSnapshotsForAccountsParams { account_ids },
    )
    .await?
    .into_iter()
    .map(|row| Ok((row.account_id, snapshot_row_from_fields(row)?)))
    .collect()
}

pub async fn account_balance_snapshots_page(
    pool: &SqlitePool,
    account_id: i64,
    after_date: Option<&str>,
    limit: i64,
) -> Result<Vec<SnapshotRow>> {
    queries::account_balance_snapshots_page(
        pool,
        queries::AccountBalanceSnapshotsPageParams {
            after_date,
            account_id,
            row_limit: limit,
        },
    )
    .await?
    .into_iter()
    .map(snapshot_row_from_fields)
    .collect()
}

pub async fn account_balance_snapshot_day_count(pool: &SqlitePool, account_id: i64) -> Result<i64> {
    Ok(
        queries::account_balance_snapshot_day_count(pool, queries::AccountBalanceSnapshotDayCountParams { account_id })
            .await?
            .count,
    )
}

pub async fn manual_snapshot_account_ids(pool: &SqlitePool) -> Result<Vec<i64>> {
    Ok(queries::manual_snapshot_account_ids(pool)
        .await?
        .into_iter()
        .map(|row| row.id)
        .collect())
}

pub async fn snapshot_holdings_by_snapshot_ids(
    pool: &SqlitePool,
    snapshot_ids: &[i64],
) -> Result<HashMap<i64, Vec<SnapshotHolding>>> {
    if snapshot_ids.is_empty() {
        return Ok(HashMap::new());
    }
    queries::snapshot_holdings_by_snapshot_ids(pool, queries::SnapshotHoldingsBySnapshotIDsParams { snapshot_ids })
        .await?
        .into_iter()
        .try_fold(HashMap::<i64, Vec<SnapshotHolding>>::new(), |mut holdings, row| {
            holdings.entry(row.snapshot_id).or_default().push(SnapshotHolding {
                asset: row.assets.try_into()?,
                quantity: row.quantity,
                price: row.price,
                value_usd: row.value_usd_cents,
                counts_toward_value: row.counts_toward_value,
                manual: row.manual,
            });
            Ok(holdings)
        })
}

pub async fn snapshot_holdings_by_snapshot_id(pool: &SqlitePool, snapshot_id: i64) -> Result<Vec<SnapshotHolding>> {
    Ok(snapshot_holdings_by_snapshot_ids(pool, &[snapshot_id])
        .await?
        .remove(&snapshot_id)
        .unwrap_or_default())
}

fn optional_ids(ids: &[i64]) -> Option<&[i64]> {
    (!ids.is_empty()).then_some(ids)
}

fn snapshot_value_times(field: &str, start_time: &str, end_time: &str) -> Result<(DateTime<Utc>, DateTime<Utc>)> {
    Ok((
        parse_snapshot_timestamp(&format!("{field} start"), start_time)?,
        parse_snapshot_timestamp(&format!("{field} end"), end_time)?,
    ))
}

fn optional_timestamp(field: &str, value: &str) -> Result<Option<DateTime<Utc>>> {
    (!value.is_empty())
        .then(|| parse_snapshot_timestamp(field, value))
        .transpose()
}

fn account_type(value: &str) -> AccountType {
    value.parse().unwrap_or(AccountType::Other)
}

fn snapshot_row_from_fields(row: impl SnapshotRowFields) -> Result<SnapshotRow> {
    Ok(SnapshotRow {
        id: row.id(),
        account_id: row.account_id(),
        source: row.source().to_owned(),
        date: row.date().to_owned(),
        synced_at: Timestamp::into(row.synced_at()),
        balance_usd: row.balance_usd_cents(),
        flagged: row.flagged(),
        account_type: account_type(row.account_type()),
    })
}

trait SnapshotRowFields {
    fn id(&self) -> i64;
    fn account_id(&self) -> i64;
    fn source(&self) -> &str;
    fn date(&self) -> &str;
    fn synced_at(&self) -> Timestamp;
    fn balance_usd_cents(&self) -> crate::money::Cents;
    fn flagged(&self) -> bool;
    fn account_type(&self) -> &str;
}

macro_rules! snapshot_row_fields {
    ($($row:ty),+ $(,)?) => {$(
        impl SnapshotRowFields for $row {
            fn id(&self) -> i64 { self.id }
            fn account_id(&self) -> i64 { self.account_id }
            fn source(&self) -> &str { &self.source }
            fn date(&self) -> &str { &self.date }
            fn synced_at(&self) -> Timestamp { self.synced_at }
            fn balance_usd_cents(&self) -> crate::money::Cents { self.balance_usd_cents }
            fn flagged(&self) -> bool { self.flagged }
            fn account_type(&self) -> &str { &self.account_type }
        }
    )+};
}

snapshot_row_fields!(
    queries::GetAccountBalanceSnapshotByIdRow,
    queries::LatestAccountBalanceSnapshotInWindowRow,
    queries::NewerAccountBalanceSnapshotsForAccountRow,
    queries::LatestAccountBalanceSnapshotsForAccountsRow,
    queries::AccountBalanceSnapshotsPageRow,
);

fn adapter_source_from_row(
    row: &queries::LatestUnflaggedSnapshotHoldingsRow,
) -> Result<Option<crate::wealth::AdapterSource>> {
    row.source_adapter
        .as_ref()
        .zip(row.source_id.as_ref())
        .map(|(adapter, source_id)| {
            Ok(crate::wealth::AdapterSource {
                adapter: adapter
                    .parse()
                    .with_context(|| format!("parse syncer ID {adapter:?}"))?,
                source_id: source_id.clone(),
            })
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::{
        account_balance_snapshot_day_count, account_balance_snapshot_timestamp_range, account_balance_snapshot_values,
        account_balance_snapshots_page, classifier_snapshot_values, latest_snapshot_for_account,
        latest_snapshot_in_window, latest_snapshots_for_accounts, latest_unflagged_snapshot_with_holdings,
        manual_snapshot_account_ids, newer_snapshots_for_account, optional_timestamp, snapshot_by_id,
        snapshot_holdings_by_snapshot_id, snapshot_holdings_by_snapshot_ids,
    };
    use crate::{database::dbtest, wealth::AccountFilter};

    #[test]
    fn parses_optional_timestamps() {
        assert_eq!(optional_timestamp("timestamp", "").unwrap(), None);
        assert!(optional_timestamp("timestamp", "invalid").is_err());
    }

    #[tokio::test]
    async fn maps_snapshot_queries_and_groups_holdings() -> Result<()> {
        let pool = dbtest::open().await?;
        sqlx::query("INSERT INTO owners (id, name) VALUES (1, 'Owner')")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO accounts (id, external_id, owner_id, name, type, manual) VALUES (1, 'checking', 1, 'Checking', 'CHECKING', 0), (2, 'manual', 1, 'Manual', 'CASH', 1)")
            .execute(&pool)
            .await?;
        let asset_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO assets (asset_type, identifier, classifier) VALUES ('CRYPTO', 'ETH', 'CRYPTOCURRENCY') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        sqlx::query(
            "INSERT INTO asset_adapter_sources (asset_id, source_adapter, source_id) VALUES (?, 'debank', '0xeth')",
        )
        .bind(asset_id)
        .execute(&pool)
        .await?;
        sqlx::query("INSERT INTO account_balance_daily_snapshots (id, account_id, source, date, synced_at, balance_usd_cents, flagged) VALUES (1, 1, 'debank', '2026-01-01', '2026-01-01T00:00:00Z', 100, 0), (2, 1, 'debank', '2026-01-02', '2026-01-02T00:00:00Z', 200, 0)")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO asset_daily_holdings (snapshot_id, account_id, date, asset_id, quantity, price, value_usd_cents, counts_toward_value) VALUES (1, 1, '2026-01-01', ?, 2, 50, 100, 1), (2, 1, '2026-01-02', ?, 4, 50, 200, 1)")
            .bind(asset_id)
            .bind(asset_id)
            .execute(&pool)
            .await?;
        let filter = AccountFilter::default();

        let last = latest_unflagged_snapshot_with_holdings(&pool, 1, "2026-01-03").await?;
        assert_eq!(
            (
                last.amount_usd.0,
                last.holdings.len(),
                last.holdings[0].adapter_sources.len()
            ),
            (200, 1, 1)
        );
        assert_eq!(
            account_balance_snapshot_values(&pool, "2026-01-01T00:00:00Z", "2026-01-03T00:00:00Z", &filter)
                .await?
                .len(),
            2
        );
        assert_eq!(
            classifier_snapshot_values(&pool, "2026-01-01T00:00:00Z", "2026-01-03T00:00:00Z", &filter)
                .await?
                .len(),
            2
        );
        assert!(
            account_balance_snapshot_timestamp_range(&pool, &filter)
                .await?
                .earliest
                .is_some()
        );
        assert_eq!(snapshot_by_id(&pool, 1).await?.unwrap().balance_usd.0, 100);
        assert_eq!(
            latest_snapshot_in_window(&pool, 1, "2026-01-01T00:00:00Z", "2026-01-03T00:00:00Z")
                .await?
                .unwrap()
                .id,
            2
        );
        assert_eq!(latest_snapshot_for_account(&pool, 1).await?.unwrap().id, 2);
        assert_eq!(newer_snapshots_for_account(&pool, 1, "2026-01-01").await?.len(), 1);
        assert_eq!(latest_snapshots_for_accounts(&pool, &[1]).await?[&1].id, 2);
        assert!(latest_snapshots_for_accounts(&pool, &[]).await?.is_empty());
        assert_eq!(account_balance_snapshots_page(&pool, 1, None, 10).await?.len(), 2);
        assert_eq!(account_balance_snapshot_day_count(&pool, 1).await?, 2);
        assert_eq!(manual_snapshot_account_ids(&pool).await?, vec![2]);
        assert_eq!(snapshot_holdings_by_snapshot_ids(&pool, &[1, 2]).await?.len(), 2);
        assert!(snapshot_holdings_by_snapshot_ids(&pool, &[]).await?.is_empty());
        assert_eq!(snapshot_holdings_by_snapshot_id(&pool, 2).await?[0].asset.id, asset_id);
        Ok(())
    }
}
