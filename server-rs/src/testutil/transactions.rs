use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use crate::{
    accounts::{AccountType, UpsertAccount, store},
    database::queries,
    money::Cents,
    schema::CategoryKind,
    transactions::{Category, store as transaction_store},
};

pub async fn account(pool: &SqlitePool, external_id: &str) -> Result<i64> {
    let owner = store::create_owner(pool, "Test owner").await?;
    store::upsert_account(
        pool,
        &UpsertAccount {
            external_id: external_id.to_owned(),
            connection_id: None,
            owner_id: owner.id,
            name: "Test account".into(),
            account_type: AccountType::Depository,
            subtype: Some("checking".into()),
            mask: None,
            notes: None,
            closed: false,
            hidden: false,
            needs_review: false,
        },
    )
    .await
}

pub async fn category(pool: &SqlitePool, name: &str, kind: CategoryKind) -> Result<Category> {
    let group = transaction_store::create_category_group(pool, &format!("{name} group"), "*", kind).await?;
    transaction_store::create_category(pool, name, "*", group.id).await
}

pub async fn transaction(
    pool: &SqlitePool,
    external_id: &str,
    account_id: i64,
    category_id: i64,
    amount: Cents,
    datetime: DateTime<Utc>,
) -> Result<i64> {
    Ok(queries::insert_transaction(
        pool,
        queries::InsertTransactionParams {
            source: "manual",
            external_id,
            account_id,
            amount_cents: amount,
            datetime: datetime.into(),
            posted_datetime: datetime.into(),
            merchant_name: Some(external_id),
            original_name: None,
            category_id,
            is_reviewed: category_id != 0,
            is_recurring: false,
            is_hidden: false,
            notes: None,
        },
    )
    .await?
    .id)
}
