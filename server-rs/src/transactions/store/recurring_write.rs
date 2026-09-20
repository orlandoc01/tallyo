use anyhow::{Result, anyhow};
use sqlx::SqliteConnection;

use crate::{accounts::store::account_by_external_id, database::queries, transactions::RecurringChargeDraft};

pub(crate) async fn upsert_recurring_charge(
    executor: &mut SqliteConnection,
    charge: &RecurringChargeDraft,
) -> Result<i64> {
    let account = account_by_external_id(&mut *executor, &charge.account_id)
        .await?
        .ok_or_else(|| anyhow!("account {} not found", charge.account_id))?;
    queries::upsert_recurring_charge(
        executor,
        queries::UpsertRecurringChargeParams {
            external_id: &charge.external_id,
            account_id: account.id,
            description: &charge.description,
            merchant_name: charge.merchant_name.as_deref(),
            frequency: &charge.frequency,
            status: &charge.status,
            is_active: charge.is_active,
            average_amount_cents: charge.average_amount,
            last_amount_cents: charge.last_amount,
            first_date: &charge.first_date,
            last_date: &charge.last_date,
            is_user_modified: charge.is_user_modified,
        },
    )
    .await
    .map(|row| row.id)
    .map_err(Into::into)
}

pub(crate) async fn replace_charge_transactions(
    executor: &mut SqliteConnection,
    charge_id: i64,
    transaction_ids: &[String],
) -> Result<()> {
    queries::delete_recurring_charge_transactions(
        &mut *executor,
        queries::DeleteRecurringChargeTransactionsParams { charge_id },
    )
    .await?;
    if transaction_ids.is_empty() {
        return Ok(());
    }
    queries::insert_recurring_charge_transactions(
        executor,
        queries::InsertRecurringChargeTransactionsParams {
            charge_id,
            plaid_txn_ids: transaction_ids,
        },
    )
    .await
    .map_err(Into::into)
}

pub(crate) async fn mark_recurring_from_streams(executor: &mut SqliteConnection, item_id: i64) -> Result<()> {
    queries::update_recurring_transactions_for_plaid_item(
        executor,
        queries::UpdateRecurringTransactionsForPlaidItemParams { item_id },
    )
    .await
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use chrono::{DateTime, Utc};

    use super::*;
    use crate::{
        database::queries,
        money::Cents,
        testutil::store::{create_owner, seed_plaid_account, seed_plaid_item},
    };

    #[tokio::test]
    async fn replaces_stream_transactions_and_rederives_recurring_flags() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        let owner = create_owner(&pool, "Alex").await?;
        let (item_id, connection) = seed_plaid_item(&pool, &owner, "item").await?;
        let account_id = seed_plaid_account(&pool, &owner, &connection, "account").await?;
        let transaction_id = queries::insert_transaction(
            &pool,
            queries::InsertTransactionParams {
                source: "plaid",
                external_id: "transaction",
                account_id,
                amount_cents: Cents(100),
                datetime: "2026-09-06T12:00:00Z".parse::<DateTime<Utc>>()?.into(),
                posted_datetime: "2026-09-06T12:00:00Z".parse::<DateTime<Utc>>()?.into(),
                merchant_name: None,
                original_name: None,
                category_id: 0,
                is_reviewed: false,
                is_recurring: false,
                is_hidden: false,
                notes: None,
            },
        )
        .await?
        .id;
        let draft = RecurringChargeDraft {
            external_id: "stream".to_owned(),
            account_id: "account".to_owned(),
            description: "Subscription".to_owned(),
            merchant_name: Some("Subscription".to_owned()),
            frequency: "MONTHLY".to_owned(),
            status: "MATURE".to_owned(),
            is_active: true,
            average_amount: Cents(100),
            last_amount: Cents(100),
            first_date: "2026-01-01".to_owned(),
            last_date: "2026-09-01".to_owned(),
            is_user_modified: false,
            transaction_ids: vec!["transaction".to_owned()],
        };
        let mut connection = pool.acquire().await?;
        let charge_id = upsert_recurring_charge(&mut connection, &draft).await?;
        replace_charge_transactions(&mut connection, charge_id, &draft.transaction_ids).await?;
        mark_recurring_from_streams(&mut connection, item_id).await?;
        assert!(
            sqlx::query_scalar::<_, bool>("SELECT is_recurring FROM transactions WHERE id = ?")
                .bind(transaction_id)
                .fetch_one(&mut *connection)
                .await?,
        );
        replace_charge_transactions(&mut connection, charge_id, &[]).await?;
        mark_recurring_from_streams(&mut connection, item_id).await?;
        assert!(
            !sqlx::query_scalar::<_, bool>("SELECT is_recurring FROM transactions WHERE id = ?")
                .bind(transaction_id)
                .fetch_one(&mut *connection)
                .await?
        );
        Ok(())
    }
}
