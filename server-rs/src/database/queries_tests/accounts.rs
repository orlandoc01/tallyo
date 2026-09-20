use anyhow::Result;

use crate::database::{dbtest, queries};

async fn insert_account_fixtures(pool: &sqlx::SqlitePool) -> Result<()> {
    sqlx::query("INSERT INTO owners (id, name) VALUES (100, 'Owner')")
        .execute(pool)
        .await?;
    sqlx::query(
        "INSERT INTO connections (id, owner_id, source_id, source_table) VALUES (100, 100, 10, 'plaid_items'), (101, 100, 20, 'simplefin_connections')",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO accounts (id, external_id, connection_id, owner_id, name, type) VALUES (100, 'one', 100, 100, 'One', 'CHECKING'), (101, 'two', 101, 100, 'Two', 'SAVINGS')",
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[tokio::test]
async fn account_records_omits_or_applies_filters() -> Result<()> {
    let pool = dbtest::open().await?;
    insert_account_fixtures(&pool).await?;

    let all = queries::account_records(&pool, queries::AccountRecordsParams::default()).await?;
    assert_eq!(all.len(), 2);

    let ids = [100];
    let external_ids = ["one".to_owned()];
    let filtered = queries::account_records(
        &pool,
        queries::AccountRecordsParams {
            item_id: Some(10),
            ids: Some(&ids),
            external_ids: Some(&external_ids),
            ..Default::default()
        },
    )
    .await?;
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].accounts.id, 100);
    Ok(())
}

#[tokio::test]
async fn accounts_by_connection_sources_empty_slice_is_noop() -> Result<()> {
    let pool = dbtest::open().await?;
    insert_account_fixtures(&pool).await?;

    let absent = queries::accounts_by_connection_sources(
        &pool,
        queries::AccountsByConnectionSourcesParams {
            source_table: "plaid_items",
            source_ids: &[],
        },
    )
    .await?;
    assert!(absent.is_empty());

    let source_ids = [10];
    let filtered = queries::accounts_by_connection_sources(
        &pool,
        queries::AccountsByConnectionSourcesParams {
            source_table: "plaid_items",
            source_ids: &source_ids,
        },
    )
    .await?;
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].accounts.external_id, "one");
    Ok(())
}

#[tokio::test]
async fn filters_account_sync_state_by_slice() -> Result<()> {
    let pool = dbtest::open().await?;
    let owner_id = sqlx::query_scalar::<_, i64>("INSERT INTO owners (name) VALUES ('owner') RETURNING id")
        .fetch_one(&pool)
        .await?;
    for external_id in ["one", "two"] {
        sqlx::query("INSERT INTO accounts (external_id, owner_id, name, type) VALUES (?, ?, 'Account', 'CHECKING')")
            .bind(external_id)
            .bind(owner_id)
            .execute(&pool)
            .await?;
    }
    sqlx::query("INSERT INTO account_sync_state (account_id) SELECT id FROM accounts")
        .execute(&pool)
        .await?;
    assert!(
        queries::account_last_balance_synced_at_for_accounts(
            &pool,
            queries::AccountLastBalanceSyncedAtForAccountsParams { account_ids: &[] },
        )
        .await?
        .is_empty()
    );
    assert_eq!(
        queries::account_last_balance_synced_at_for_accounts(
            &pool,
            queries::AccountLastBalanceSyncedAtForAccountsParams { account_ids: &[1] },
        )
        .await?
        .len(),
        1
    );
    Ok(())
}
