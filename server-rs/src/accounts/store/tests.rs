use anyhow::Result;
use chrono::Utc;
use sqlx::SqlitePool;

use crate::{
    accounts::ConnectionUpdate,
    database::dbtest,
    testutil::store::{create_owner, linked_account, seed_plaid_account, seed_plaid_item},
};

use super::{
    test_support::{account_update, simplefin_connection},
    *,
};

async fn row_exists(pool: &SqlitePool, table: &str, id: i64) -> Result<bool> {
    let count = sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {table} WHERE id = ?"))
        .bind(id)
        .fetch_one(pool)
        .await?;
    Ok(count == 1)
}

#[tokio::test]
async fn hiding_an_account_hides_its_transactions() -> Result<()> {
    let pool = dbtest::open().await?;
    let owner = create_owner(&pool, "alex").await?;
    let (_, connection) = seed_plaid_item(&pool, &owner, "item").await?;
    let id = seed_plaid_account(&pool, &owner, &connection, "checking").await?;
    sqlx::query("INSERT INTO transactions (source, external_id, account_id, amount_cents, datetime, posted_datetime, category_id) VALUES ('test', 'hidden', ?, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0)")
        .bind(id)
        .execute(&pool)
        .await?;
    let mut update = account_update(None, None);
    update.hidden = Some(true);
    update_account(&pool, id, update).await?;
    assert!(
        sqlx::query_scalar::<_, bool>("SELECT is_hidden FROM transactions WHERE account_id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await?
    );
    Ok(())
}

#[tokio::test]
async fn deleting_connections_cascades_provider_rows() -> Result<()> {
    let pool = dbtest::open().await?;
    let owner = create_owner(&pool, "alex").await?;
    let (item_id, plaid_connection) = seed_plaid_item(&pool, &owner, "item").await?;
    let plaid_account = seed_plaid_account(&pool, &owner, &plaid_connection, "plaid").await?;
    assert!(delete_connection(&pool, plaid_connection.id).await?);
    assert!(account_by_id(&pool, plaid_account).await?.is_none());
    assert!(connection_by_id(&pool, plaid_connection.id).await?.is_none());
    assert!(!row_exists(&pool, "plaid_items", item_id).await?);

    let (evm_connection, evm_account) = create_evm_wallet(
        &pool,
        "0x1111111111111111111111111111111111111111",
        owner.id,
        "Wallet",
        &["eth".into()],
    )
    .await?;
    let wallet_id = evm_connection.source_id;
    assert!(delete_connection(&pool, evm_connection.connection.id).await?);
    assert!(account_by_id(&pool, evm_account.id).await?.is_none());
    assert!(connection_by_id(&pool, evm_connection.connection.id).await?.is_none());
    assert!(!row_exists(&pool, "evm_wallets", wallet_id).await?);

    let token = create_simple_fin_access_token(&pool, "https://bridge.example", owner.id, "Bridge").await?;
    let (simplefin_id, simplefin_connection) =
        link_simple_fin_connection(&pool, &simplefin_connection(token.id, owner.id, "simplefin")).await?;
    let account_id = upsert_account(
        &pool,
        &linked_account(&owner, simplefin_connection, "simplefin-account"),
    )
    .await?;
    assert!(delete_connection(&pool, simplefin_connection).await?);
    assert!(account_by_id(&pool, account_id).await?.is_none());
    assert!(connection_by_id(&pool, simplefin_connection).await?.is_none());
    assert!(!row_exists(&pool, "simplefin_connections", simplefin_id).await?);
    Ok(())
}

#[tokio::test]
async fn inactive_connections_and_closed_accounts_are_not_evm_sync_due() -> Result<()> {
    let pool = dbtest::open().await?;
    let owner = create_owner(&pool, "alex").await?;
    let (closed_connection, closed_account) = create_evm_wallet(
        &pool,
        "0x1111111111111111111111111111111111111111",
        owner.id,
        "Closed",
        &["eth".into()],
    )
    .await?;
    let mut update = account_update(None, None);
    update.closed = Some(true);
    update_account(&pool, closed_account.id, update).await?;
    let (inactive_connection, _) = create_evm_wallet(
        &pool,
        "0x2222222222222222222222222222222222222222",
        owner.id,
        "Inactive",
        &["eth".into()],
    )
    .await?;
    update_connection(
        &pool,
        inactive_connection.connection.id,
        ConnectionUpdate {
            is_active: Some(false),
            sync_cron: None,
            recurring_sync_cron: None,
            next_sync_at: None,
            next_recurring_sync_at: None,
            evm_chain_ids: None,
        },
    )
    .await?;
    assert!(evm_wallets_due_for_balance_sync(&pool, Utc::now()).await?.is_empty());
    assert!(
        connection_by_id(&pool, closed_connection.connection.id)
            .await?
            .unwrap()
            .connection
            .is_active
    );
    Ok(())
}

#[tokio::test]
async fn simplefin_batch_lookup_keeps_requested_empty_keys_and_deletion_cascades() -> Result<()> {
    let pool = dbtest::open().await?;
    let connections_by_token = simple_fin_connections_by_token_ids(&pool, &[1, 2]).await?;
    assert!(connections_by_token.contains_key(&1));
    assert!(connections_by_token.contains_key(&2));
    let owner = create_owner(&pool, "alex").await?;
    let token = create_simple_fin_access_token(&pool, "https://bridge.example", owner.id, "Bridge").await?;
    let (first, first_connection) =
        link_simple_fin_connection(&pool, &simplefin_connection(token.id, owner.id, "one")).await?;
    let (second, second_connection) =
        link_simple_fin_connection(&pool, &simplefin_connection(token.id, owner.id, "two")).await?;
    delete_simple_fin_access_token(&pool, token.id).await?;
    for (provider_id, connection_id) in [(first, first_connection), (second, second_connection)] {
        assert!(!row_exists(&pool, "simplefin_connections", provider_id).await?);
        assert!(!row_exists(&pool, "connections", connection_id).await?);
    }
    assert!(!row_exists(&pool, "simplefin_access_tokens", token.id).await?);
    Ok(())
}
