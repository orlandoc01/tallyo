use anyhow::Result;
use sqlx::SqlitePool;

use crate::{
    accounts::{Account, AccountType, CreateManualAccount, Owner, UpsertAccount, store},
    database::queries,
};

pub async fn create_owner(pool: &SqlitePool, name: &str) -> Result<Owner> {
    store::create_owner(pool, name).await
}

pub async fn create_plaid_credential(pool: &SqlitePool) -> Result<i64> {
    Ok(queries::create_plaid_credential(
        pool,
        queries::CreatePlaidCredentialParams {
            client_id: "client",
            secret: "secret",
            environment: "sandbox",
            label: None,
        },
    )
    .await?
    .id)
}

pub async fn seed_plaid_item(
    pool: &SqlitePool,
    owner: &Owner,
    external_id: &str,
) -> Result<(i64, crate::accounts::Connection)> {
    let credential_id = create_plaid_credential(pool).await?;
    let item_id = store::upsert_plaid_item(
        pool,
        queries::UpsertPlaidItemParams {
            external_id,
            credential_id,
            access_token: "token",
            institution_id: Some("ins"),
            logo_url: None,
            next_sync_at: None,
            next_recurring_sync_at: None,
            next_balance_sync_at: None,
            plaid_investments_enabled: false,
            plaid_liabilities_enabled: false,
        },
    )
    .await?;
    let connection = store::create_connection(pool, item_id, Some("Institution"), owner.id).await?;
    Ok((item_id, connection.connection))
}

pub async fn seed_plaid_account(
    pool: &SqlitePool,
    owner: &Owner,
    connection: &crate::accounts::Connection,
    external_id: &str,
) -> Result<i64> {
    store::upsert_account(pool, &linked_account(owner, connection.id, external_id)).await
}

pub fn linked_account(owner: &Owner, connection_id: i64, external_id: &str) -> UpsertAccount {
    UpsertAccount {
        external_id: external_id.to_owned(),
        connection_id: Some(connection_id),
        owner_id: owner.id,
        name: "Checking".to_owned(),
        account_type: AccountType::Depository,
        subtype: Some("checking".to_owned()),
        mask: Some("0000".to_owned()),
        notes: None,
        closed: false,
        hidden: false,
        needs_review: false,
    }
}

pub async fn seed_evm_wallet(
    pool: &SqlitePool,
    owner: &Owner,
    address: &str,
) -> Result<(crate::accounts::ConnectionRecord, Account)> {
    store::create_evm_wallet(pool, address, owner.id, "Wallet", &["eth".to_owned()]).await
}

pub async fn seed_manual_account(pool: &SqlitePool, owner: &Owner, name: &str) -> Result<Account> {
    store::create_manual_account(
        pool,
        CreateManualAccount {
            connection_id: None,
            name: name.to_owned(),
            owner_id: owner.id,
            account_type: AccountType::Depository,
            notes: None,
            closed: None,
            hidden: None,
        },
    )
    .await
}
