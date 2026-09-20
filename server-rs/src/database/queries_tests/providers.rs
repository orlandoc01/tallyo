use anyhow::Result;

use crate::database::{dbtest, queries};

use super::time;

async fn plaid_item(
    pool: &sqlx::SqlitePool,
    suffix: &str,
    is_active: bool,
    next_sync_at: Option<&str>,
) -> Result<(i64, i64)> {
    let owner_id = sqlx::query_scalar::<_, i64>("INSERT INTO owners (name) VALUES (?) RETURNING id")
        .bind(format!("owner-{suffix}"))
        .fetch_one(pool)
        .await?;
    let credential_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO plaid_credentials (client_id, secret) VALUES (?, 'secret') RETURNING id",
    )
    .bind(format!("client-{suffix}"))
    .fetch_one(pool)
    .await?;
    let item_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO plaid_items (external_id, credential_id, access_token, next_sync_at) VALUES (?, ?, 'token', ?) RETURNING id",
    )
    .bind(format!("item-{suffix}"))
    .bind(credential_id)
    .bind(next_sync_at)
    .fetch_one(pool)
    .await?;
    sqlx::query(
        "INSERT INTO connections (source_table, source_id, owner_id, is_active) VALUES ('plaid_items', ?, ?, ?)",
    )
    .bind(item_id)
    .bind(owner_id)
    .bind(is_active)
    .execute(pool)
    .await?;
    Ok((item_id, credential_id))
}

#[tokio::test]
async fn filters_connections_by_ids_and_source() -> Result<()> {
    let pool = dbtest::open().await?;
    let owner_id = sqlx::query_scalar::<_, i64>("INSERT INTO owners (name) VALUES ('owner') RETURNING id")
        .fetch_one(&pool)
        .await?;
    for (source_table, source_id) in [("plaid_items", 1_i64), ("other", 2_i64)] {
        sqlx::query("INSERT INTO connections (source_table, source_id, owner_id, is_active) VALUES (?, ?, ?, 1)")
            .bind(source_table)
            .bind(source_id)
            .bind(owner_id)
            .execute(&pool)
            .await?;
    }
    assert_eq!(
        queries::connections(&pool, queries::ConnectionsParams::default())
            .await?
            .len(),
        2
    );
    let ids = [1];
    assert_eq!(
        queries::connections(
            &pool,
            queries::ConnectionsParams {
                ids: Some(&ids),
                ..Default::default()
            },
        )
        .await?
        .len(),
        1
    );
    assert_eq!(
        queries::connections(
            &pool,
            queries::ConnectionsParams {
                source_table: "plaid_items",
                source_id: 1,
                source_lookup: true,
                ..Default::default()
            },
        )
        .await?
        .len(),
        1
    );
    Ok(())
}

#[tokio::test]
async fn filters_wallets_by_connection_slice_and_due_state() -> Result<()> {
    let pool = dbtest::open().await?;
    let owner_id = sqlx::query_scalar::<_, i64>("INSERT INTO owners (name) VALUES ('owner') RETURNING id")
        .fetch_one(&pool)
        .await?;
    let wallet_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO evm_wallets (address, label, chain_ids) VALUES ('0x1', 'Wallet', '1') RETURNING id",
    )
    .fetch_one(&pool)
    .await?;
    let connection_id = sqlx::query_scalar::<_, i64>("INSERT INTO connections (source_table, source_id, owner_id, is_active) VALUES ('evm_wallets', ?, ?, 1) RETURNING id")
        .bind(wallet_id)
        .bind(owner_id)
        .fetch_one(&pool)
        .await?;
    sqlx::query("INSERT INTO accounts (connection_id, external_id, owner_id, name, type, manual, is_closed) VALUES (?, 'wallet-account', ?, 'Wallet', 'CRYPTO_WALLET', 0, 0)")
        .bind(connection_id)
        .bind(owner_id)
        .execute(&pool)
        .await?;
    let later_wallet_id = sqlx::query_scalar::<_, i64>("INSERT INTO evm_wallets (address, label, chain_ids, next_balance_sync_at) VALUES ('0x2', 'Later wallet', '1', '2026-01-02T00:00:00Z') RETURNING id")
        .fetch_one(&pool)
        .await?;
    let later_connection_id = sqlx::query_scalar::<_, i64>("INSERT INTO connections (source_table, source_id, owner_id, is_active) VALUES ('evm_wallets', ?, ?, 1) RETURNING id")
        .bind(later_wallet_id)
        .bind(owner_id)
        .fetch_one(&pool)
        .await?;
    sqlx::query("INSERT INTO accounts (connection_id, external_id, owner_id, name, type, manual, is_closed) VALUES (?, 'later-wallet-account', ?, 'Later wallet', 'CRYPTO_WALLET', 0, 0)")
        .bind(later_connection_id)
        .bind(owner_id)
        .execute(&pool)
        .await?;
    assert_eq!(
        queries::evm_wallets(&pool, queries::EvmWalletsParams::default())
            .await?
            .len(),
        2
    );
    let connection_ids = [connection_id];
    assert_eq!(
        queries::evm_wallets(
            &pool,
            queries::EvmWalletsParams {
                connection_ids: Some(&connection_ids),
                ..Default::default()
            },
        )
        .await?[0]
            .id,
        wallet_id
    );
    assert_eq!(
        queries::evm_wallets(
            &pool,
            queries::EvmWalletsParams {
                now: Some(time("2026-01-01T00:00:00Z")?),
                due_only: true,
                ..Default::default()
            },
        )
        .await?[0]
            .id,
        wallet_id
    );
    Ok(())
}

#[tokio::test]
async fn lists_credentials_with_and_without_id_slice() -> Result<()> {
    let pool = dbtest::open().await?;
    let (_, credential_id) = plaid_item(&pool, "one", true, None).await?;
    let (_, other_credential_id) = plaid_item(&pool, "two", true, None).await?;
    let all = queries::list_plaid_credentials(&pool, queries::ListPlaidCredentialsParams::default()).await?;
    assert_eq!(all.len(), 2);
    assert!(all.iter().any(|credential| credential.id == other_credential_id));
    let ids = [credential_id];
    let filtered =
        queries::list_plaid_credentials(&pool, queries::ListPlaidCredentialsParams { ids: Some(&ids) }).await?;
    assert_eq!(filtered[0].id, credential_id);
    Ok(())
}

#[tokio::test]
async fn lists_items_with_and_without_filters() -> Result<()> {
    let pool = dbtest::open().await?;
    let (active_item_id, _) = plaid_item(&pool, "active", true, None).await?;
    let (inactive_item_id, _) = plaid_item(&pool, "inactive", false, None).await?;
    assert_eq!(
        queries::list_plaid_items(&pool, queries::ListPlaidItemsParams::default())
            .await?
            .len(),
        2
    );
    let ids = [inactive_item_id];
    assert_eq!(
        queries::list_plaid_items(
            &pool,
            queries::ListPlaidItemsParams {
                ids: Some(&ids),
                ..Default::default()
            },
        )
        .await?[0]
            .item_id,
        inactive_item_id
    );
    assert_eq!(
        queries::list_plaid_items(
            &pool,
            queries::ListPlaidItemsParams {
                active_only: true,
                ..Default::default()
            },
        )
        .await?[0]
            .item_id,
        active_item_id
    );
    Ok(())
}

#[tokio::test]
async fn lists_due_items_with_and_without_id_filter() -> Result<()> {
    let pool = dbtest::open().await?;
    let (due_item_id, _) = plaid_item(&pool, "due", true, None).await?;
    let (later_item_id, _) = plaid_item(&pool, "later", true, Some("2026-01-02T00:00:00Z")).await?;
    assert_eq!(
        queries::plaid_items_due(
            &pool,
            queries::PlaidItemsDueParams {
                kind: "sync",
                ..Default::default()
            },
        )
        .await?
        .len(),
        2
    );
    assert_eq!(
        queries::plaid_items_due(
            &pool,
            queries::PlaidItemsDueParams {
                id: Some(later_item_id),
                kind: "sync",
                ..Default::default()
            },
        )
        .await?[0]
            .plaid_items
            .id,
        later_item_id
    );
    assert_eq!(
        queries::plaid_items_due(
            &pool,
            queries::PlaidItemsDueParams {
                kind: "sync",
                now: Some(time("2026-01-01T00:00:00Z")?),
                due_only: true,
                ..Default::default()
            },
        )
        .await?[0]
            .plaid_items
            .id,
        due_item_id
    );
    Ok(())
}
