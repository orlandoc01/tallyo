use anyhow::Result;

use crate::database::{dbtest, queries};

use super::time;

#[tokio::test]
async fn list_categories_omits_empty_id_filter() -> Result<()> {
    let pool = dbtest::open().await?;
    let group_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO category_groups (name, emoji, kind, sort_order) VALUES ('Test group', '*', 'EXPENSE', 99) RETURNING id",
    )
    .fetch_one(&pool)
    .await?;
    let category_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO categories (name, emoji, group_id, sort_order) VALUES ('Test category', '*', ?, 1) RETURNING id",
    )
    .bind(group_id)
    .fetch_one(&pool)
    .await?;
    let other_category_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO categories (name, emoji, group_id, sort_order) VALUES ('Other test category', '*', ?, 2) RETURNING id",
    )
    .bind(group_id)
    .fetch_one(&pool)
    .await?;

    let unfiltered = queries::list_categories(
        &pool,
        queries::ListCategoriesParams {
            group_id: Some(group_id),
            ..Default::default()
        },
    )
    .await?;
    let filtered_ids = [category_id];
    let filtered = queries::list_categories(
        &pool,
        queries::ListCategoriesParams {
            category_ids: Some(&filtered_ids),
            group_id: Some(group_id),
            ..Default::default()
        },
    )
    .await?;

    assert_eq!(unfiltered.len(), 2);
    assert!(unfiltered.iter().any(|category| category.cat_id == other_category_id));
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].cat_id, category_id);
    Ok(())
}

#[tokio::test]
async fn spending_transactions_omits_empty_category_filter() -> Result<()> {
    let pool = dbtest::open().await?;
    let owner_id = sqlx::query_scalar::<_, i64>("INSERT INTO owners (name) VALUES ('Spending owner') RETURNING id")
        .fetch_one(&pool)
        .await?;
    let account_id = sqlx::query_scalar::<_, i64>("INSERT INTO accounts (external_id, owner_id, name, type) VALUES ('spending-account', ?, 'Spending account', 'depository') RETURNING id")
        .bind(owner_id)
        .fetch_one(&pool)
        .await?;
    let group_id = sqlx::query_scalar::<_, i64>("INSERT INTO category_groups (name, emoji, kind, sort_order) VALUES ('Spending group', '*', 'EXPENSE', 99) RETURNING id")
        .fetch_one(&pool)
        .await?;
    let category_id = sqlx::query_scalar::<_, i64>("INSERT INTO categories (name, emoji, group_id, sort_order) VALUES ('Spending category', '*', ?, 1) RETURNING id")
        .bind(group_id)
        .fetch_one(&pool)
        .await?;
    sqlx::query("INSERT INTO transactions (source, external_id, account_id, amount_cents, datetime, posted_datetime, category_id) VALUES ('test', 'spending-a', ?, 50, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0), ('test', 'spending-b', ?, 75, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ?)")
        .bind(account_id)
        .bind(account_id)
        .bind(category_id)
        .execute(&pool)
        .await?;
    let datetime_from = time("2026-01-01T00:00:00Z")?;
    let datetime_to = time("2026-02-01T00:00:00Z")?;
    let all = queries::spending_transactions(
        &pool,
        queries::SpendingTransactionsParams {
            datetime_from,
            datetime_to,
            ..Default::default()
        },
    )
    .await?;
    let category_ids = [category_id];
    let filtered = queries::spending_transactions(
        &pool,
        queries::SpendingTransactionsParams {
            datetime_from,
            datetime_to,
            category_ids: Some(&category_ids),
            ..Default::default()
        },
    )
    .await?;
    assert_eq!(all.len(), 2);
    assert_eq!(filtered[0].category_rows.cat_id, category_id);
    Ok(())
}
