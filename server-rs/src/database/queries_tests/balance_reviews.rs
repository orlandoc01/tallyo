use anyhow::Result;

use crate::database::{dbtest, queries};

async fn account(pool: &sqlx::SqlitePool, external_id: &str) -> Result<i64> {
    let owner_id = sqlx::query_scalar::<_, i64>("INSERT INTO owners (name) VALUES (?) RETURNING id")
        .bind(format!("owner-{external_id}"))
        .fetch_one(pool)
        .await?;
    Ok(sqlx::query_scalar::<_, i64>(
        "INSERT INTO accounts (external_id, owner_id, name, type) VALUES (?, ?, 'Account', 'CHECKING') RETURNING id",
    )
    .bind(external_id)
    .bind(owner_id)
    .fetch_one(pool)
    .await?)
}

async fn review(pool: &sqlx::SqlitePool, account_id: i64, decision: &str) -> Result<()> {
    sqlx::query("INSERT INTO account_balance_snapshot_reviews (account_id, decision, first_flagged_date, latest_flagged_date, provider_balance_usd_cents, carry_forward_balance_usd_cents) VALUES (?, ?, '2024-01-01', '2024-01-01', 1, 1)")
        .bind(account_id)
        .bind(decision)
        .execute(pool)
        .await?;
    Ok(())
}

#[tokio::test]
async fn deletes_provider_states_with_and_without_date_bounds() -> Result<()> {
    let pool = dbtest::open().await?;
    let account_id = account(&pool, "provider").await?;
    sqlx::query("INSERT INTO account_balance_daily_snapshots (account_id, date, flagged, source, synced_at) VALUES (?, '2024-01-01', 1, 'test', '2024-01-01T00:00:00Z'), (?, '2024-01-02', 1, 'test', '2024-01-02T00:00:00Z')")
        .bind(account_id)
        .bind(account_id)
        .execute(&pool)
        .await?;
    sqlx::query("INSERT INTO account_balance_snapshot_provider_states (snapshot_id, provider_balance_usd_cents, provider_holdings_json) SELECT id, 1, '[]' FROM account_balance_daily_snapshots")
        .execute(&pool)
        .await?;

    queries::delete_snapshot_provider_states_between_dates(
        &pool,
        queries::DeleteSnapshotProviderStatesBetweenDatesParams {
            inclusive: true,
            after_date: Some("2024-01-01"),
            before_date: Some("2024-01-01"),
            account_id,
        },
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM account_balance_snapshot_provider_states")
            .fetch_one(&pool)
            .await?,
        1
    );
    queries::delete_snapshot_provider_states_between_dates(
        &pool,
        queries::DeleteSnapshotProviderStatesBetweenDatesParams {
            inclusive: true,
            account_id,
            ..Default::default()
        },
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM account_balance_snapshot_provider_states")
            .fetch_one(&pool)
            .await?,
        0
    );
    Ok(())
}

#[tokio::test]
async fn deletes_reviews_with_optional_decision() -> Result<()> {
    let pool = dbtest::open().await?;
    let account_id = account(&pool, "one").await?;
    review(&pool, account_id, "APPROVED_CHANGES").await?;

    queries::delete_balance_reviews_by_account_id(
        &pool,
        queries::DeleteBalanceReviewsByAccountIdParams {
            decision: Some("IN_REVIEW"),
            account_id,
        },
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM account_balance_snapshot_reviews")
            .fetch_one(&pool)
            .await?,
        1
    );
    queries::delete_balance_reviews_by_account_id(
        &pool,
        queries::DeleteBalanceReviewsByAccountIdParams {
            account_id,
            ..Default::default()
        },
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM account_balance_snapshot_reviews")
            .fetch_one(&pool)
            .await?,
        0
    );
    Ok(())
}

#[tokio::test]
async fn lists_reviews_with_optional_id_and_decision_filter() -> Result<()> {
    let pool = dbtest::open().await?;
    let in_review = account(&pool, "in-review").await?;
    let approved = account(&pool, "approved").await?;
    review(&pool, in_review, "IN_REVIEW").await?;
    review(&pool, approved, "APPROVED_CHANGES").await?;

    assert_eq!(
        queries::list_in_review_balance_reviews(
            &pool,
            queries::ListInReviewBalanceReviewsParams {
                in_review_only: true,
                ..Default::default()
            },
        )
        .await?
        .len(),
        1
    );
    assert_eq!(
        queries::list_in_review_balance_reviews(
            &pool,
            queries::ListInReviewBalanceReviewsParams {
                id: Some(approved),
                ..Default::default()
            },
        )
        .await?
        .len(),
        1
    );
    Ok(())
}
