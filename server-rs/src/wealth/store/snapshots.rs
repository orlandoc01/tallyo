use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{SqliteConnection, SqlitePool};

use crate::{
    database::{self, Timestamp, queries},
    money::Cents,
    wealth::{AccountBalanceSnapshot, AssetUpdate, SnapshotPersist},
};

use super::assets::upsert_asset_in_transaction;

pub async fn replace_account_balance_snapshot(pool: &SqlitePool, snapshot: AccountBalanceSnapshot) -> Result<bool> {
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            replace_snapshot(transaction, snapshot)
                .await
                .map(|result| result.inserted)
        })
    })
    .await
}

pub async fn persist_snapshot(pool: &SqlitePool, persist: SnapshotPersist) -> Result<()> {
    database::with_tx(pool, |transaction| {
        Box::pin(async move { persist_snapshot_in_transaction(transaction, persist).await })
    })
    .await
}

pub(super) async fn persist_snapshot_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    persist: SnapshotPersist,
) -> Result<()> {
    let account_id = persist.snapshot.account_id;
    let synced_at = persist.synced_at;
    let replacement = replace_snapshot(transaction, persist.snapshot).await?;
    if !replacement.inserted {
        return mark_account_balance_synced(transaction, account_id, synced_at).await;
    }
    if let Some(provider_state) = persist.provider_state {
        queries::insert_snapshot_provider_state(
            &mut **transaction,
            queries::InsertSnapshotProviderStateParams {
                snapshot_id: replacement.snapshot_id,
                provider_balance_usd_cents: provider_state.provider_balance_usd,
                provider_holdings_json: &provider_state.provider_holdings_json,
            },
        )
        .await
        .context("insert snapshot provider state")?;
    }
    if let Some(recovery) = persist.recovery {
        validate_snapshot_date("recovery after date", &recovery.after_date)?;
        validate_snapshot_date("recovery before date", &recovery.before_date)?;
        queries::unflag_snapshots_between_dates(
            &mut **transaction,
            queries::UnflagSnapshotsBetweenDatesParams {
                account_id: recovery.account_id,
                inclusive: false,
                after_date: &recovery.after_date,
                before_date: &recovery.before_date,
            },
        )
        .await
        .context("unflag recovered snapshots")?;
        queries::delete_snapshot_provider_states_between_dates(
            &mut **transaction,
            queries::DeleteSnapshotProviderStatesBetweenDatesParams {
                inclusive: false,
                after_date: Some(&recovery.after_date),
                before_date: Some(&recovery.before_date),
                account_id: recovery.account_id,
            },
        )
        .await
        .context("delete recovered provider states")?;
    }
    if persist.expire_review {
        queries::delete_balance_reviews_by_account_id(
            &mut **transaction,
            queries::DeleteBalanceReviewsByAccountIdParams {
                decision: None,
                account_id,
            },
        )
        .await
        .context("delete clean balance review")?;
        queries::delete_snapshot_provider_states_between_dates(
            &mut **transaction,
            queries::DeleteSnapshotProviderStatesBetweenDatesParams {
                inclusive: false,
                after_date: None,
                before_date: None,
                account_id,
            },
        )
        .await
        .context("delete clean provider states")?;
    }
    if let Some(review) = persist.review {
        let review_id = queries::upsert_balance_review(
            &mut **transaction,
            queries::UpsertBalanceReviewParams {
                account_id: review.account_id,
                first_flagged_date: &review.first_flagged_date,
                latest_flagged_date: &review.latest_flagged_date,
                flagged_snapshot_count: i64::from(review.flagged_snapshot_count),
                provider_balance_usd_cents: review.provider_balance_usd,
                carry_forward_balance_usd_cents: review.carry_forward_balance_usd,
                flag_reason: Some(&review.flag_reason),
            },
        )
        .await
        .context("upsert balance review")?;
        queries::recount_balance_review_flagged_snapshots(
            &mut **transaction,
            queries::RecountBalanceReviewFlaggedSnapshotsParams { id: review_id.id },
        )
        .await
        .context("recount flagged snapshots")?;
    }
    mark_account_balance_synced(transaction, account_id, synced_at).await
}

struct SnapshotReplacement {
    snapshot_id: i64,
    inserted: bool,
}

async fn replace_snapshot(
    executor: &mut SqliteConnection,
    snapshot: AccountBalanceSnapshot,
) -> Result<SnapshotReplacement> {
    validate_snapshot_date("account balance snapshot date", &snapshot.date)?;
    let synced_at = parse_snapshot_timestamp("account balance snapshot synced_at", &snapshot.synced_at)?;
    let closed = queries::account_is_closed(
        &mut *executor,
        queries::AccountIsClosedParams {
            id: snapshot.account_id,
        },
    )
    .await
    .context("load snapshot account")?
    .is_closed;
    if closed {
        tracing::debug!(
            account_id = snapshot.account_id,
            source = snapshot.source,
            date = snapshot.date,
            "skip closed account balance snapshot"
        );
        return Ok(SnapshotReplacement {
            snapshot_id: 0,
            inserted: false,
        });
    }
    let inserted = queries::insert_account_balance_snapshot(
        &mut *executor,
        queries::InsertAccountBalanceSnapshotParams {
            account_id: snapshot.account_id,
            source: &snapshot.source,
            date: &snapshot.date,
            synced_at: synced_at.into(),
            balance_usd_cents: snapshot.balance_usd,
            raw_payload: snapshot.raw_payload.as_deref(),
            flagged: snapshot.flagged,
            flag_reason: (!snapshot.flag_reason.is_empty()).then_some(snapshot.flag_reason.as_str()),
        },
    )
    .await
    .context("insert account balance snapshot")?;
    for holding in snapshot.holdings {
        let asset_id = match holding.asset {
            Some(asset) => {
                let asset_id = upsert_asset_in_transaction(executor, asset)
                    .await
                    .context("upsert holding asset")?
                    .id;
                if let Some(update) = holding.price_update {
                    apply_asset_update(executor, asset_id, update)
                        .await
                        .context("persist holding asset update")?;
                }
                asset_id
            }
            None => holding.asset_id,
        };
        queries::insert_asset_daily_holding(
            &mut *executor,
            queries::InsertAssetDailyHoldingParams {
                snapshot_id: inserted.id,
                account_id: snapshot.account_id,
                date: &snapshot.date,
                asset_id,
                quantity: holding.quantity,
                price: holding.price,
                value_usd_cents: Cents::from_dollars_checked(holding.value_usd)?,
                counts_toward_value: holding.counts_toward_value,
                manual: holding.manual,
            },
        )
        .await
        .with_context(|| format!("insert asset holding {asset_id}"))?;
    }
    Ok(SnapshotReplacement {
        snapshot_id: inserted.id,
        inserted: true,
    })
}

pub(super) async fn apply_asset_update(
    executor: &mut SqliteConnection,
    asset_id: i64,
    update: AssetUpdate,
) -> Result<()> {
    let updated = queries::update_asset_price(
        &mut *executor,
        queries::UpdateAssetPriceParams {
            last_price: Some(update.price),
            last_price_at: Some(update.price_at.into()),
            id: asset_id,
        },
    )
    .await
    .context("update asset price")?;
    if updated > 0
        && let Some(multiplier) = update.tracking_multiplier
    {
        queries::update_asset_tracking_multiplier(
            executor,
            queries::UpdateAssetTrackingMultiplierParams {
                tracking_multiplier: multiplier,
                id: asset_id,
            },
        )
        .await
        .context("update asset tracking multiplier")?;
    }
    Ok(())
}

async fn mark_account_balance_synced(
    executor: &mut SqliteConnection,
    account_id: i64,
    synced_at: DateTime<Utc>,
) -> Result<()> {
    queries::mark_account_balance_synced(
        executor,
        queries::MarkAccountBalanceSyncedParams {
            account_id,
            last_balance_synced_at: Some(Timestamp::from(synced_at)),
        },
    )
    .await
    .context("mark balance synced")
}

pub(crate) fn validate_snapshot_date(field: &str, value: &str) -> Result<()> {
    NaiveDate::parse_from_str(value, "%F").with_context(|| format!("parse {field} {value:?}"))?;
    Ok(())
}

pub(crate) fn parse_snapshot_timestamp(field: &str, value: &str) -> Result<DateTime<Utc>> {
    value
        .parse::<DateTime<Utc>>()
        .with_context(|| format!("parse {field} {value:?}"))
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::{parse_snapshot_timestamp, persist_snapshot, validate_snapshot_date};
    use crate::{
        database::dbtest,
        money::Cents,
        wealth::{
            AccountBalanceSnapshot, AssetDailyHolding, AssetUpdate, BalanceReviewUpsert, SnapshotPersist,
            SnapshotProviderState, SnapshotRecovery,
        },
    };

    #[test]
    fn validates_snapshot_dates_and_timestamps_with_context() {
        validate_snapshot_date("snapshot", "2026-01-01").unwrap();
        assert_eq!(
            validate_snapshot_date("snapshot", "not-a-date")
                .unwrap_err()
                .to_string(),
            "parse snapshot \"not-a-date\""
        );
        assert_eq!(
            parse_snapshot_timestamp("synced", "not-a-time")
                .unwrap_err()
                .to_string(),
            "parse synced \"not-a-time\""
        );
    }

    #[tokio::test]
    async fn persists_holdings_provider_state_and_review_metadata() -> Result<()> {
        let pool = dbtest::open().await?;
        sqlx::query("INSERT INTO owners (id, name) VALUES (1, 'Owner')")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES (1, 'checking', 1, 'Checking', 'CHECKING')")
            .execute(&pool)
            .await?;
        let asset_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO assets (asset_type, identifier, classifier, tracking_ticker) VALUES ('SECURITY', 'VTI', 'PUBLIC', 'VTI') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        let synced_at = "2026-01-02T00:00:00Z".parse()?;
        persist_snapshot(
            &pool,
            SnapshotPersist {
                snapshot: AccountBalanceSnapshot {
                    account_id: 1,
                    wallet_address: String::new(),
                    source: "test".to_owned(),
                    date: "2026-01-02".to_owned(),
                    synced_at: "2026-01-02T00:00:00Z".to_owned(),
                    balance_usd: Cents(2_000),
                    raw_payload: None,
                    holdings: vec![AssetDailyHolding {
                        asset_id,
                        asset: None,
                        adapter_source: None,
                        adapter_sources: Vec::new(),
                        price_update: Some(AssetUpdate {
                            asset_id,
                            price: 10.0,
                            price_at: synced_at,
                            tracking_multiplier: Some(1.5),
                        }),
                        quantity: Some(2.0),
                        price: Some(10.0),
                        value_usd: 20.0,
                        counts_toward_value: true,
                        manual: false,
                        line_type: String::new(),
                        chain_id: String::new(),
                        project_name: None,
                        token_id: String::new(),
                        identifier: "VTI".to_owned(),
                        token_symbol: None,
                        token_name: None,
                        provider_price: None,
                    }],
                    flagged: true,
                    flag_reason: "spike".to_owned(),
                },
                synced_at,
                expire_review: true,
                recovery: Some(SnapshotRecovery {
                    account_id: 1,
                    after_date: "2026-01-01".to_owned(),
                    before_date: "2026-01-03".to_owned(),
                }),
                review: Some(BalanceReviewUpsert {
                    account_id: 1,
                    first_flagged_date: "2026-01-02".to_owned(),
                    latest_flagged_date: "2026-01-02".to_owned(),
                    flagged_snapshot_count: 1,
                    provider_balance_usd: Cents(2_000),
                    carry_forward_balance_usd: Cents(2_000),
                    flag_reason: "spike".to_owned(),
                }),
                provider_state: Some(SnapshotProviderState {
                    provider_balance_usd: Cents(2_000),
                    provider_holdings_json: "[]".to_owned(),
                }),
            },
        )
        .await?;
        assert_eq!(
            sqlx::query_as::<_, (f64, f64, i64)>("SELECT last_price, tracking_multiplier, last_balance_synced_at IS NOT NULL FROM assets JOIN account_sync_state ON account_id = 1 WHERE assets.id = ?")
                .bind(asset_id)
                .fetch_one(&pool)
                .await?,
            (0.0, 1.0, 1)
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM account_balance_snapshot_provider_states")
                .fetch_one(&pool)
                .await?,
            0
        );
        Ok(())
    }
}
