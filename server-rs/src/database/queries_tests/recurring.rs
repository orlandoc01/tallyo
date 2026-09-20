use anyhow::Result;

use crate::database::{dbtest, queries};

#[tokio::test]
async fn clear_staged_for_llm_clears_all_or_selected_transactions() -> Result<()> {
    let pool = dbtest::open().await?;
    sqlx::query("INSERT INTO owners (id, name) VALUES (101, 'Ada')")
        .execute(&pool)
        .await?;
    sqlx::query("INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES (101, 'account', 101, 'Account', 'depository')")
        .execute(&pool)
        .await?;
    sqlx::query("INSERT INTO transactions (id, account_id, category_id, amount_cents, datetime, posted_datetime, external_id, staged_for_llm) VALUES (101, 101, 0, 100, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', 'one', 1), (102, 101, 0, 200, '2024-01-02T00:00:00Z', '2024-01-02T00:00:00Z', 'two', 1)")
        .execute(&pool)
        .await?;
    queries::clear_staged_for_llm(&pool, queries::ClearStagedForLlmParams::default()).await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transactions WHERE staged_for_llm = 1")
            .fetch_one(&pool)
            .await?,
        0
    );
    sqlx::query("UPDATE transactions SET staged_for_llm = 1")
        .execute(&pool)
        .await?;
    let ids = [101];
    queries::clear_staged_for_llm(&pool, queries::ClearStagedForLlmParams { ids: Some(&ids) }).await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transactions WHERE staged_for_llm = 1")
            .fetch_one(&pool)
            .await?,
        1
    );
    Ok(())
}

#[tokio::test]
async fn dynamic_recurring_charge_queries_omit_empty_filters() -> Result<()> {
    let pool = dbtest::open().await?;
    let owner_id = sqlx::query_scalar::<_, i64>("INSERT INTO owners (name) VALUES ('Recurring owner') RETURNING id")
        .fetch_one(&pool)
        .await?;
    let account_id = sqlx::query_scalar::<_, i64>("INSERT INTO accounts (external_id, owner_id, name, type) VALUES ('recurring-account', ?, 'Recurring account', 'depository') RETURNING id")
        .bind(owner_id)
        .fetch_one(&pool)
        .await?;
    let transaction_id = sqlx::query_scalar::<_, i64>("INSERT INTO transactions (source, external_id, account_id, amount_cents, datetime, posted_datetime, category_id) VALUES ('plaid', 'recurring-txn', ?, 50, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0) RETURNING id")
        .bind(account_id)
        .fetch_one(&pool)
        .await?;
    let charge_id = sqlx::query_scalar::<_, i64>("INSERT INTO recurring_charges (external_id, account_id, description, frequency, status, average_amount_cents, last_amount_cents, first_date, last_date) VALUES ('recurring-charge', ?, 'Charge', 'MONTHLY', 'ACTIVE', 50, 50, '2026-01-01', '2026-01-01') RETURNING id")
        .bind(account_id)
        .fetch_one(&pool)
        .await?;
    let other_charge_id = sqlx::query_scalar::<_, i64>("INSERT INTO recurring_charges (external_id, account_id, description, frequency, status, average_amount_cents, last_amount_cents, first_date, last_date) VALUES ('recurring-charge-other', ?, 'Other charge', 'MONTHLY', 'ACTIVE', 75, 75, '2026-01-02', '2026-01-02') RETURNING id")
        .bind(account_id)
        .fetch_one(&pool)
        .await?;
    queries::insert_recurring_charge_transactions(
        &pool,
        queries::InsertRecurringChargeTransactionsParams {
            charge_id,
            plaid_txn_ids: &[],
        },
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM recurring_charge_transactions")
            .fetch_one(&pool)
            .await?,
        0
    );
    let plaid_txn_ids = ["recurring-txn".to_owned()];
    queries::insert_recurring_charge_transactions(
        &pool,
        queries::InsertRecurringChargeTransactionsParams {
            charge_id,
            plaid_txn_ids: &plaid_txn_ids,
        },
    )
    .await?;
    assert_eq!(
        queries::list_recurring_charges(&pool, queries::ListRecurringChargesParams::default())
            .await?
            .into_iter()
            .map(|row| row.id)
            .collect::<Vec<_>>(),
        [other_charge_id, charge_id]
    );
    assert_eq!(
        queries::list_recurring_charges(&pool, queries::ListRecurringChargesParams { id: Some(charge_id) },).await?[0]
            .id,
        charge_id
    );
    assert!(
        queries::majority_categories_for_recurring_charges(
            &pool,
            queries::MajorityCategoriesForRecurringChargesParams { charge_ids: &[] },
        )
        .await?
        .is_empty()
    );
    assert_eq!(
        queries::majority_categories_for_recurring_charges(
            &pool,
            queries::MajorityCategoriesForRecurringChargesParams {
                charge_ids: &[charge_id],
            },
        )
        .await?[0]
            .charge_id,
        charge_id
    );
    assert!(
        queries::recurring_charge_transaction_ids_by_charge_ids(
            &pool,
            queries::RecurringChargeTransactionIDsByChargeIDsParams { charge_ids: &[] },
        )
        .await?
        .is_empty()
    );
    assert_eq!(
        queries::recurring_charge_transaction_ids_by_charge_ids(
            &pool,
            queries::RecurringChargeTransactionIDsByChargeIDsParams {
                charge_ids: &[charge_id],
            },
        )
        .await?[0]
            .transaction_id,
        transaction_id
    );
    Ok(())
}
