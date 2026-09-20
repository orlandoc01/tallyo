use anyhow::Result;

use crate::database::{dbtest, queries};

use super::time;

#[tokio::test]
async fn dynamic_auth_filters_apply_only_when_enabled() -> Result<()> {
    let pool = dbtest::open().await?;
    let now = time("2024-01-01T00:00:00Z")?;
    sqlx::query("INSERT INTO users (id, email, role) VALUES (101, 'ada@example.com', 'admin'), (102, 'bea@example.com', 'writer')")
        .execute(&pool)
        .await?;
    sqlx::query("INSERT INTO oauth_clients (id, redirect_uris, grant_types, response_types, scopes) VALUES ('client', 'https://example.com', 'authorization_code', 'code', '')")
        .execute(&pool)
        .await?;
    sqlx::query("INSERT INTO oauth_authorization_codes (signature, client_id, subject, redirect_uri, code_challenge, code_challenge_method, expires_at, active) VALUES ('inactive', 'client', 'subject', 'https://example.com', 'challenge', 'S256', '2025-01-01T00:00:00Z', 0)")
        .execute(&pool)
        .await?;
    sqlx::query("INSERT INTO oauth_refresh_tokens (signature, client_id, subject, expires_at, active) VALUES ('inactive', 'client', 'subject', '2025-01-01T00:00:00Z', 0)")
        .execute(&pool)
        .await?;
    sqlx::query("INSERT INTO login_sessions (id, client_id, redirect_uri, code_challenge, code_challenge_method, callback_state, expires_at) VALUES ('one', 'client', 'https://example.com', 'challenge', 'S256', 'state-one', '2025-01-01T00:00:00Z'), ('two', 'client', 'https://example.com', 'challenge', 'S256', 'state-two', '2025-01-01T00:00:00Z')")
        .execute(&pool)
        .await?;

    assert!(
        !queries::auth_code(
            &pool,
            queries::AuthCodeParams {
                signature: "inactive",
                now,
                active_only: false,
            },
        )
        .await?
        .active
    );
    assert!(
        queries::auth_code(
            &pool,
            queries::AuthCodeParams {
                signature: "inactive",
                now,
                active_only: true,
            },
        )
        .await
        .is_err()
    );
    assert!(
        !queries::refresh_token(
            &pool,
            queries::RefreshTokenParams {
                signature: "inactive",
                now,
                active_only: false,
            },
        )
        .await?
        .active
    );
    assert!(
        queries::refresh_token(
            &pool,
            queries::RefreshTokenParams {
                signature: "inactive",
                now,
                active_only: true,
            },
        )
        .await
        .is_err()
    );
    assert_eq!(
        queries::login_sessions(&pool, queries::LoginSessionsParams::default())
            .await?
            .len(),
        2
    );
    assert_eq!(
        queries::login_sessions(
            &pool,
            queries::LoginSessionsParams {
                id: Some("two"),
                ..Default::default()
            },
        )
        .await?[0]
            .callback_state,
        "state-two"
    );
    assert_eq!(queries::users(&pool, queries::UsersParams::default()).await?.len(), 2);
    assert_eq!(
        queries::users(
            &pool,
            queries::UsersParams {
                email: Some("bea@example.com"),
                ..Default::default()
            },
        )
        .await?[0]
            .id,
        102
    );
    Ok(())
}

#[tokio::test]
async fn budget_queries_filter_ranges_and_decode_category_rows() -> Result<()> {
    let pool = dbtest::open().await?;
    let first_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO budgets (month, category_id, amount_cents) VALUES ('2026-01', 0, 100) RETURNING id",
    )
    .fetch_one(&pool)
    .await?;
    sqlx::query("INSERT INTO budgets (month, category_id, amount_cents) VALUES ('2026-02', 0, 200)")
        .execute(&pool)
        .await?;

    let budget = queries::budget_by_id(&pool, queries::BudgetByIdParams { id: first_id }).await?;
    let all = queries::budgets_in_range(&pool, queries::BudgetsInRangeParams::default()).await?;
    let filtered = queries::budgets_in_range(
        &pool,
        queries::BudgetsInRangeParams {
            start_month: Some("2026-02"),
            ..Default::default()
        },
    )
    .await?;

    assert_eq!(budget.category_rows.cat_id, 0);
    assert_eq!(all.len(), 2);
    assert_eq!(filtered[0].month, "2026-02");
    Ok(())
}

#[tokio::test]
async fn owners_applies_an_id_filter_only_when_present() -> Result<()> {
    let pool = dbtest::open().await?;
    sqlx::query("INSERT INTO owners (id, name) VALUES (101, 'Ada'), (102, 'Bea')")
        .execute(&pool)
        .await?;

    assert_eq!(queries::owners(&pool, queries::OwnersParams::default()).await?.len(), 2);
    assert_eq!(
        queries::owners(&pool, queries::OwnersParams { id: Some(102) },).await?[0].name,
        "Bea"
    );
    Ok(())
}

#[tokio::test]
async fn selects_by_due_filter() -> Result<()> {
    let pool = dbtest::open().await?;
    sqlx::query("INSERT INTO balance_sync_schedules (id, balance_sync_cron, next_balance_sync_at) VALUES ('due', '* * * * *', '2024-01-01T00:00:00Z'), ('future', '* * * * *', '2024-01-03T00:00:00Z')")
        .execute(&pool)
        .await?;
    let now = time("2024-01-02T00:00:00Z")?;

    assert_eq!(
        queries::balance_sync_schedule_due(
            &pool,
            queries::BalanceSyncScheduleDueParams {
                id: "future",
                ..Default::default()
            },
        )
        .await?
        .balance_sync_cron,
        "* * * * *"
    );
    assert!(
        queries::balance_sync_schedule_due(
            &pool,
            queries::BalanceSyncScheduleDueParams {
                now: Some(now),
                id: "future",
                due_only: true,
            },
        )
        .await
        .is_err()
    );
    Ok(())
}
