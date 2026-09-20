use anyhow::Result;

use crate::{
    database::{dbtest, queries},
    money::Cents,
};

use super::time;

async fn simple_transaction_pool() -> Result<sqlx::SqlitePool> {
    let pool = dbtest::open().await?;
    sqlx::query("INSERT INTO owners (id, name) VALUES (101, 'Ada')")
        .execute(&pool)
        .await?;
    sqlx::query(
        "INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES (101, 'account', 101, 'Account', 'depository')",
    )
    .execute(&pool)
    .await?;
    sqlx::query(
        "INSERT INTO transactions (id, account_id, category_id, amount_cents, datetime, posted_datetime, external_id, merchant_name) VALUES (101, 101, 0, 100, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', 'one', 'Alpha'), (102, 101, 0, 200, '2024-01-02T00:00:00Z', '2024-01-02T00:00:00Z', 'two', 'Beta')",
    )
    .execute(&pool)
    .await?;
    Ok(pool)
}

#[tokio::test]
async fn generated_transaction_queries_filter_only_populated_values() -> Result<()> {
    let pool = simple_transaction_pool().await?;
    assert_eq!(
        queries::count_transaction_records(&pool, queries::CountTransactionRecordsParams::default())
            .await?
            .total_count,
        2
    );

    let first = [101];
    assert_eq!(
        queries::count_transaction_records(
            &pool,
            queries::CountTransactionRecordsParams {
                ids: Some(&first),
                ..Default::default()
            },
        )
        .await?
        .total_count,
        1
    );
    assert_eq!(
        queries::transaction_ids_by_filter(&pool, queries::TransactionIDsByFilterParams::default())
            .await?
            .len(),
        2
    );
    assert_eq!(
        queries::transaction_ids_by_filter(
            &pool,
            queries::TransactionIDsByFilterParams {
                ids: Some(&[102]),
                ..Default::default()
            },
        )
        .await?[0]
            .id,
        102
    );
    assert_eq!(
        queries::transaction_records(
            &pool,
            queries::TransactionRecordsParams {
                row_limit: 10,
                ..Default::default()
            },
        )
        .await?
        .len(),
        2
    );
    assert_eq!(
        queries::transaction_records(
            &pool,
            queries::TransactionRecordsParams {
                ids: Some(&first),
                row_limit: 10,
                ..Default::default()
            },
        )
        .await?[0]
            .id,
        101
    );
    assert_eq!(
        queries::transaction_records_summary(&pool, queries::TransactionRecordsSummaryParams::default())
            .await?
            .total_count,
        2
    );
    let excluded_kinds = ["EXPENSE".to_owned()];
    assert_eq!(
        queries::transaction_records_summary(
            &pool,
            queries::TransactionRecordsSummaryParams {
                excluded_kinds: Some(&excluded_kinds),
                ..Default::default()
            },
        )
        .await?
        .total_count,
        0
    );
    assert_eq!(
        queries::update_transaction_fields_by_ids(
            &pool,
            queries::UpdateTransactionFieldsByIDsParams {
                set_merchant_name: true,
                merchant_name: Some("Changed"),
                ids: &[],
                ..Default::default()
            },
        )
        .await?,
        0
    );
    assert_eq!(
        queries::update_transaction_fields_by_ids(
            &pool,
            queries::UpdateTransactionFieldsByIDsParams {
                set_merchant_name: true,
                merchant_name: Some("Changed"),
                ids: &first,
                ..Default::default()
            },
        )
        .await?,
        1
    );
    Ok(())
}

#[tokio::test]
async fn generated_insert_transaction_uses_cents_and_go_timestamp() -> Result<()> {
    let pool = dbtest::open().await?;
    sqlx::query("INSERT INTO owners (id, name) VALUES (1, 'Ada')")
        .execute(&pool)
        .await?;
    sqlx::query(
        "INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES (1, 'account', 1, 'Account', 'CHECKING')",
    )
    .execute(&pool)
    .await?;

    let datetime = time("2026-07-06T19:55:05.987654321Z")?;
    let transaction = queries::insert_transaction(
        &pool,
        queries::InsertTransactionParams {
            source: "manual",
            external_id: "generated-cents",
            account_id: 1,
            amount_cents: Cents(1_234),
            datetime,
            posted_datetime: datetime,
            category_id: 0,
            ..Default::default()
        },
    )
    .await?;
    assert_eq!(transaction.id, 1);
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT CAST(datetime AS TEXT) FROM transactions WHERE id = ?")
            .bind(transaction.id)
            .fetch_one(&pool)
            .await?,
        "2026-07-06T19:55:05Z"
    );
    assert_eq!(
        queries::transaction_records(
            &pool,
            queries::TransactionRecordsParams {
                ids: Some(&[transaction.id]),
                row_limit: 1,
                ..Default::default()
            },
        )
        .await?[0]
            .amount_cents,
        Cents(1_234)
    );
    Ok(())
}

#[tokio::test]
async fn delete_transactions_by_ids_omits_empty_slices() -> Result<()> {
    let pool = dbtest::open().await?;
    let owner_id = sqlx::query_scalar::<_, i64>("INSERT INTO owners (name) VALUES ('Delete owner') RETURNING id")
        .fetch_one(&pool)
        .await?;
    let account_id = sqlx::query_scalar::<_, i64>("INSERT INTO accounts (external_id, owner_id, name, type) VALUES ('delete-account', ?, 'Delete account', 'depository') RETURNING id")
        .bind(owner_id)
        .fetch_one(&pool)
        .await?;
    let transaction_id = sqlx::query_scalar::<_, i64>("INSERT INTO transactions (source, external_id, account_id, amount_cents, datetime, posted_datetime, category_id) VALUES ('test', 'delete-txn', ?, 50, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0) RETURNING id")
        .bind(account_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(
        queries::delete_transactions_by_ids(&pool, queries::DeleteTransactionsByIDsParams { ids: &[] },).await?,
        0
    );
    assert_eq!(
        queries::delete_transactions_by_ids(&pool, queries::DeleteTransactionsByIDsParams { ids: &[transaction_id] },)
            .await?,
        1
    );
    Ok(())
}
