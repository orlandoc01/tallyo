use anyhow::{Context, Result};
use sqlx::{SqliteConnection, SqlitePool};

use crate::{
    apierror::ApiError,
    database::{self, queries},
    ids::Date,
    money::Cents,
    wealth::{
        ApprovedBalanceReview, BalanceReviewProviderHolding, BalanceReviewUpsert, BalanceSnapshotReview,
        balance_review_provider_holdings_from_json,
    },
};

use super::{assets::upsert_asset_in_transaction, snapshots::apply_asset_update};

pub async fn in_review_balance_reviews(pool: &SqlitePool) -> Result<Vec<BalanceSnapshotReview>> {
    queries::list_in_review_balance_reviews(
        pool,
        queries::ListInReviewBalanceReviewsParams {
            in_review_only: true,
            ..Default::default()
        },
    )
    .await?
    .into_iter()
    .map(review_from_row)
    .collect()
}

pub async fn approved_balance_review_by_account(
    pool: &SqlitePool,
    account_id: i64,
) -> Result<Option<ApprovedBalanceReview>> {
    Ok(queries::get_approved_balance_review_by_account_opt(
        pool,
        queries::GetApprovedBalanceReviewByAccountParams { account_id },
    )
    .await?
    .map(|row| ApprovedBalanceReview {
        provider_balance_usd: row.provider_balance_usd_cents,
    }))
}

pub async fn get_balance_review_by_id(pool: &SqlitePool, id: i64) -> Result<Option<BalanceSnapshotReview>> {
    queries::list_in_review_balance_reviews(
        pool,
        queries::ListInReviewBalanceReviewsParams {
            id: Some(id),
            ..Default::default()
        },
    )
    .await?
    .into_iter()
    .next()
    .map(review_from_row)
    .transpose()
}

pub async fn upsert_balance_review(pool: &SqlitePool, review: BalanceReviewUpsert) -> Result<()> {
    queries::upsert_balance_review(
        pool,
        queries::UpsertBalanceReviewParams {
            account_id: review.account_id,
            first_flagged_date: &review.first_flagged_date,
            latest_flagged_date: &review.latest_flagged_date,
            flagged_snapshot_count: i64::from(review.flagged_snapshot_count.max(1)),
            provider_balance_usd_cents: review.provider_balance_usd,
            carry_forward_balance_usd_cents: review.carry_forward_balance_usd,
            flag_reason: Some(&review.flag_reason),
        },
    )
    .await
    .context("upsert balance review")?;
    Ok(())
}

pub async fn approve_balance_review(pool: &SqlitePool, id: i64) -> Result<()> {
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let Some(review) = review_by_id(transaction, id).await? else {
                return Err(review_not_found(id));
            };
            if review.decision != "IN_REVIEW" {
                return Err(review_not_found(id));
            }
            let has_flagged_snapshot = queries::has_flagged_snapshot_for_account_between_dates(
                &mut **transaction,
                queries::HasFlaggedSnapshotForAccountBetweenDatesParams {
                    account_id: review.account_id,
                    start_date: review.first_flagged_date.as_str(),
                    end_date: review.latest_flagged_date.as_str(),
                },
            )
            .await
            .context("list flagged snapshots")?
            .has_flagged_snapshot;
            if has_flagged_snapshot == 0 {
                return Err(ApiError::bad_input(format!("balance review {id} has no flagged snapshots")).into());
            }
            let updated = queries::approve_in_review_balance_review(
                &mut **transaction,
                queries::ApproveInReviewBalanceReviewParams { id },
            )
            .await
            .context("approve balance review")?;
            if updated == 0 {
                return Err(review_not_found(id));
            }
            queries::unflag_snapshots_between_dates(
                &mut **transaction,
                queries::UnflagSnapshotsBetweenDatesParams {
                    account_id: review.account_id,
                    inclusive: true,
                    after_date: review.first_flagged_date.as_str(),
                    before_date: review.latest_flagged_date.as_str(),
                },
            )
            .await
            .context("unflag approved snapshots")?;
            queries::delete_snapshot_provider_states_between_dates(
                &mut **transaction,
                queries::DeleteSnapshotProviderStatesBetweenDatesParams {
                    inclusive: true,
                    after_date: Some(review.first_flagged_date.as_str()),
                    before_date: Some(review.latest_flagged_date.as_str()),
                    account_id: review.account_id,
                },
            )
            .await
            .context("delete approved provider states")
        })
    })
    .await
}

pub async fn use_provider_balance_review(pool: &SqlitePool, id: i64) -> Result<()> {
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let Some(review) = review_by_id(transaction, id).await? else {
                return Err(review_not_found(id));
            };
            if review.decision != "IN_REVIEW" {
                return Err(review_not_found(id));
            }
            let restores = queries::flagged_snapshots_with_provider_states_for_review(
                &mut **transaction,
                queries::FlaggedSnapshotsWithProviderStatesForReviewParams {
                    account_id: review.account_id,
                    start_date: review.first_flagged_date.as_str(),
                    end_date: review.latest_flagged_date.as_str(),
                },
            )
            .await
            .context("list flagged snapshots")?
            .into_iter()
            .map(|snapshot| provider_snapshot_restore(id, snapshot))
            .collect::<Result<Vec<_>>>()?;
            if restores.is_empty() {
                return Err(ApiError::bad_input(format!("balance review {id} has no flagged snapshots")).into());
            }
            for restore in restores {
                queries::update_snapshot_balance_and_unflag(
                    &mut **transaction,
                    queries::UpdateSnapshotBalanceAndUnflagParams {
                        id: restore.snapshot_id,
                        balance_usd_cents: restore.balance_usd,
                    },
                )
                .await
                .context("restore snapshot balance")?;
                queries::delete_asset_daily_holdings_by_snapshot_id(
                    &mut **transaction,
                    queries::DeleteAssetDailyHoldingsBySnapshotIdParams {
                        snapshot_id: restore.snapshot_id,
                    },
                )
                .await
                .context("delete carried-forward holdings")?;
                insert_provider_holdings(transaction, review.account_id, restore).await?;
            }
            queries::delete_snapshot_provider_states_between_dates(
                &mut **transaction,
                queries::DeleteSnapshotProviderStatesBetweenDatesParams {
                    inclusive: true,
                    after_date: Some(review.first_flagged_date.as_str()),
                    before_date: Some(review.latest_flagged_date.as_str()),
                    account_id: review.account_id,
                },
            )
            .await
            .context("delete provider states")?;
            queries::delete_balance_review_by_id(&mut **transaction, queries::DeleteBalanceReviewByIdParams { id })
                .await
                .context("delete balance review")
        })
    })
    .await
}

struct ReviewRecord {
    account_id: i64,
    decision: String,
    first_flagged_date: Date,
    latest_flagged_date: Date,
}

struct ProviderSnapshotRestore {
    snapshot_id: i64,
    date: String,
    balance_usd: Cents,
    holdings: Vec<BalanceReviewProviderHolding>,
}

async fn review_by_id(executor: &mut SqliteConnection, id: i64) -> Result<Option<ReviewRecord>> {
    queries::list_in_review_balance_reviews(
        executor,
        queries::ListInReviewBalanceReviewsParams {
            id: Some(id),
            in_review_only: true,
        },
    )
    .await?
    .into_iter()
    .next()
    .map(|row| {
        Ok(ReviewRecord {
            account_id: row.account_id,
            decision: row.decision,
            first_flagged_date: Date::new(row.first_flagged_date)?,
            latest_flagged_date: Date::new(row.latest_flagged_date)?,
        })
    })
    .transpose()
}

fn provider_snapshot_restore(
    review_id: i64,
    snapshot: queries::FlaggedSnapshotsWithProviderStatesForReviewRow,
) -> Result<ProviderSnapshotRestore> {
    if snapshot.missing_provider_state {
        return Err(ApiError::bad_input(format!("balance review {review_id} is missing provider state")).into());
    }
    Ok(ProviderSnapshotRestore {
        snapshot_id: snapshot.id,
        date: snapshot.date.clone(),
        balance_usd: snapshot.provider_balance_usd_cents,
        holdings: balance_review_provider_holdings_from_json(Some(&snapshot.provider_holdings_json))
            .with_context(|| format!("decode provider holdings for {}", snapshot.date))?,
    })
}

async fn insert_provider_holdings(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    account_id: i64,
    restore: ProviderSnapshotRestore,
) -> Result<()> {
    for holding in restore.holdings {
        let asset_id = provider_holding_asset_id(transaction, &holding).await?;
        if let Some(update) = holding.price_update {
            apply_asset_update(transaction, asset_id, update)
                .await
                .with_context(|| format!("apply provider holding price update {asset_id}"))?;
        }
        queries::insert_asset_daily_holding(
            &mut **transaction,
            queries::InsertAssetDailyHoldingParams {
                snapshot_id: restore.snapshot_id,
                account_id,
                date: &restore.date,
                asset_id,
                quantity: holding.quantity,
                price: holding.price,
                value_usd_cents: Cents::from_dollars_checked(holding.value_usd)?,
                counts_toward_value: holding.counts_toward_value,
                manual: false,
            },
        )
        .await
        .with_context(|| format!("insert provider holding {asset_id}"))?;
    }
    Ok(())
}

async fn provider_holding_asset_id(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    holding: &BalanceReviewProviderHolding,
) -> Result<i64> {
    if let Some(mut asset) = holding.asset.clone() {
        if asset.last_price.is_none() {
            asset.last_price = holding.price;
        }
        return upsert_asset_in_transaction(transaction, asset)
            .await
            .map(|asset| asset.id)
            .with_context(|| format!("upsert provider asset {}", holding.asset_id));
    }
    if holding.asset_id > 0 {
        return Ok(holding.asset_id);
    }
    Err(anyhow::anyhow!(
        "provider holding {} missing asset id and asset description",
        holding.asset_id
    ))
}

fn review_from_row(row: queries::ListInReviewBalanceReviewsRow) -> Result<BalanceSnapshotReview> {
    Ok(BalanceSnapshotReview {
        id: row.id,
        account: (row.accounts, row.owner_name).into(),
        first_flagged_date: Date::new(row.first_flagged_date)?,
        latest_flagged_date: Date::new(row.latest_flagged_date)?,
        flagged_snapshot_count: i32::try_from(row.flagged_snapshot_count)
            .context("balance review flagged snapshot count overflows i32")?,
        provider_balance_usd: row.provider_balance_usd_cents,
        carry_forward_balance_usd: row.carry_forward_balance_usd_cents,
        flag_reason: row.flag_reason,
        created_at: row.created_at.into(),
        updated_at: row.updated_at.into(),
    })
}

fn review_not_found(id: i64) -> anyhow::Error {
    ApiError::bad_input(format!("balance review {id} not found")).into()
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::{
        approve_balance_review, provider_snapshot_restore, upsert_balance_review, use_provider_balance_review,
    };
    use crate::{
        database::{dbtest, queries},
        money::Cents,
        wealth::BalanceReviewUpsert,
    };

    #[tokio::test]
    async fn approving_a_missing_review_is_a_public_error() -> Result<()> {
        let pool = dbtest::open().await?;

        assert_eq!(
            approve_balance_review(&pool, 42).await.unwrap_err().to_string(),
            "balance review 42 not found"
        );
        Ok(())
    }

    #[test]
    fn rejects_missing_provider_state_before_decoding_holdings() {
        let snapshot = queries::FlaggedSnapshotsWithProviderStatesForReviewRow {
            id: 1,
            date: "2026-01-01".to_owned(),
            missing_provider_state: true,
            provider_balance_usd_cents: Cents(100),
            provider_holdings_json: "not json".to_owned(),
        };
        assert_eq!(
            provider_snapshot_restore(3, snapshot)
                .err()
                .expect("missing provider state must fail")
                .to_string(),
            "balance review 3 is missing provider state"
        );
    }

    #[tokio::test]
    async fn upsert_clamps_review_count_and_returns_approved_balance() -> Result<()> {
        let pool = dbtest::open().await?;
        sqlx::query("INSERT INTO owners (id, name) VALUES (1, 'Owner')")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES (1, 'checking', 1, 'Checking', 'CHECKING')")
            .execute(&pool)
            .await?;
        upsert_balance_review(
            &pool,
            BalanceReviewUpsert {
                account_id: 1,
                first_flagged_date: "2026-01-01".to_owned(),
                latest_flagged_date: "2026-01-01".to_owned(),
                flagged_snapshot_count: 0,
                provider_balance_usd: Cents(100),
                carry_forward_balance_usd: Cents(50),
                flag_reason: "spike".to_owned(),
            },
        )
        .await?;
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT flagged_snapshot_count FROM account_balance_snapshot_reviews")
                .fetch_one(&pool)
                .await?,
            1
        );
        Ok(())
    }

    #[tokio::test]
    async fn approves_and_restores_flagged_review_snapshots() -> Result<()> {
        let pool = dbtest::open().await?;
        sqlx::query("INSERT INTO owners (id, name) VALUES (1, 'Owner')")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES (1, 'checking', 1, 'Checking', 'CHECKING'), (2, 'other', 1, 'Other', 'CHECKING')")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO account_balance_daily_snapshots (id, account_id, source, date, synced_at, balance_usd_cents, flagged) VALUES (1, 1, 'test', '2026-01-01', '2026-01-01T00:00:00Z', 100, 1), (2, 2, 'test', '2026-01-01', '2026-01-01T00:00:00Z', 50, 1)")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO account_balance_snapshot_reviews (id, account_id, first_flagged_date, latest_flagged_date, provider_balance_usd_cents, carry_forward_balance_usd_cents) VALUES (1, 1, '2026-01-01', '2026-01-01', 100, 100), (2, 2, '2026-01-01', '2026-01-01', 75, 50)")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO account_balance_snapshot_provider_states (snapshot_id, provider_balance_usd_cents, provider_holdings_json) VALUES (2, 75, '[]')")
            .execute(&pool)
            .await?;

        approve_balance_review(&pool, 1).await?;
        use_provider_balance_review(&pool, 2).await?;
        assert_eq!(
            sqlx::query_as::<_, (bool, i64)>(
                "SELECT flagged, balance_usd_cents FROM account_balance_daily_snapshots WHERE id = 1"
            )
            .fetch_one(&pool)
            .await?,
            (false, 100)
        );
        assert_eq!(
            sqlx::query_as::<_, (bool, i64)>(
                "SELECT flagged, balance_usd_cents FROM account_balance_daily_snapshots WHERE id = 2"
            )
            .fetch_one(&pool)
            .await?,
            (false, 75)
        );
        Ok(())
    }
}
