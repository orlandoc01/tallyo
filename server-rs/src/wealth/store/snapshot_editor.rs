use anyhow::{Context, Result};
use sqlx::{SqliteConnection, SqlitePool};

use crate::{
    apierror::ApiError,
    database::{self, queries},
    wealth::SnapshotEdit,
};

use super::snapshots::validate_snapshot_date;

const PENDING_REVIEW_MESSAGE: &str = "resolve the pending balance review before editing snapshots";

pub async fn update_account_snapshots(pool: &SqlitePool, edits: &[SnapshotEdit]) -> Result<()> {
    let edits = edits.to_vec();
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            for edit in edits {
                let pending = queries::in_review_balance_review_exists(
                    &mut **transaction,
                    queries::InReviewBalanceReviewExistsParams {
                        account_id: edit.account_id,
                    },
                )
                .await
                .context("check pending balance review")?
                .found;
                if pending {
                    return Err(ApiError::bad_input(PENDING_REVIEW_MESSAGE).into());
                }
                update_snapshot(transaction, &edit).await?;
                queries::delete_balance_reviews_by_account_id(
                    &mut **transaction,
                    queries::DeleteBalanceReviewsByAccountIdParams {
                        decision: Some("APPROVED_CHANGES"),
                        account_id: edit.account_id,
                    },
                )
                .await
                .context("delete approved balance review")?;
                queries::delete_snapshot_provider_states_between_dates(
                    &mut **transaction,
                    queries::DeleteSnapshotProviderStatesBetweenDatesParams {
                        inclusive: false,
                        after_date: None,
                        before_date: None,
                        account_id: edit.account_id,
                    },
                )
                .await
                .context("delete stale provider states")?;
            }
            Ok(())
        })
    })
    .await
}

async fn update_snapshot(executor: &mut SqliteConnection, edit: &SnapshotEdit) -> Result<()> {
    validate_snapshot_date("snapshot edit date", &edit.date)?;
    queries::update_snapshot_balance_and_unflag(
        &mut *executor,
        queries::UpdateSnapshotBalanceAndUnflagParams {
            balance_usd_cents: edit.balance_usd,
            id: edit.id,
        },
    )
    .await
    .context("update snapshot balance")?;
    queries::delete_asset_daily_holdings_by_snapshot_id(
        &mut *executor,
        queries::DeleteAssetDailyHoldingsBySnapshotIdParams { snapshot_id: edit.id },
    )
    .await
    .context("delete snapshot holdings")?;
    for holding in &edit.holdings {
        queries::insert_asset_daily_holding(
            &mut *executor,
            queries::InsertAssetDailyHoldingParams {
                snapshot_id: edit.id,
                account_id: edit.account_id,
                date: &edit.date,
                asset_id: holding.asset_id,
                quantity: holding.quantity,
                price: holding.price,
                value_usd_cents: holding.value_usd,
                counts_toward_value: holding.counts_toward_value,
                manual: holding.manual,
            },
        )
        .await
        .with_context(|| format!("insert snapshot holding {}", holding.asset_id))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::update_account_snapshots;
    use crate::{
        database::dbtest,
        money::Cents,
        wealth::{SnapshotEdit, SnapshotEditHolding},
    };

    #[tokio::test]
    async fn replaces_snapshot_holdings_and_rejects_pending_reviews() -> Result<()> {
        let pool = dbtest::open().await?;
        sqlx::query("INSERT INTO owners (id, name) VALUES (1, 'Owner')")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES (1, 'checking', 1, 'Checking', 'CHECKING')")
            .execute(&pool)
            .await?;
        let first_asset_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO assets (asset_type, identifier, classifier) VALUES ('SECURITY', 'VTI', 'PUBLIC') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        let second_asset_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO assets (asset_type, identifier, classifier) VALUES ('SECURITY', 'VXUS', 'PUBLIC') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        sqlx::query("INSERT INTO account_balance_daily_snapshots (id, account_id, source, date, synced_at, balance_usd_cents, flagged) VALUES (1, 1, 'test', '2026-01-01', '2026-01-01T00:00:00Z', 100, 1)")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO asset_daily_holdings (snapshot_id, account_id, date, asset_id, value_usd_cents) VALUES (1, 1, '2026-01-01', ?, 100)")
            .bind(first_asset_id)
            .execute(&pool)
            .await?;
        let edit = SnapshotEdit {
            id: 1,
            account_id: 1,
            date: "2026-01-01".to_owned(),
            balance_usd: Cents(200),
            holdings: vec![SnapshotEditHolding {
                asset_id: second_asset_id,
                quantity: Some(2.0),
                price: Some(1.0),
                value_usd: Cents(200),
                counts_toward_value: true,
                manual: true,
            }],
        };
        update_account_snapshots(&pool, std::slice::from_ref(&edit)).await?;
        assert_eq!(
            sqlx::query_as::<_, (i64, i64, bool)>("SELECT balance_usd_cents, asset_id, manual FROM account_balance_daily_snapshots JOIN asset_daily_holdings ON snapshot_id = account_balance_daily_snapshots.id")
                .fetch_one(&pool)
                .await?,
            (200, second_asset_id, true)
        );
        sqlx::query("INSERT INTO account_balance_snapshot_reviews (account_id, first_flagged_date, latest_flagged_date, provider_balance_usd_cents, carry_forward_balance_usd_cents) VALUES (1, '2026-01-01', '2026-01-01', 1, 1)")
            .execute(&pool)
            .await?;
        assert_eq!(
            update_account_snapshots(&pool, &[edit]).await.unwrap_err().to_string(),
            "resolve the pending balance review before editing snapshots"
        );
        Ok(())
    }
}
