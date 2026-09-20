use std::collections::HashMap;

use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::{Executor, Sqlite};

use crate::{
    accounts::{PlaidItemHealthState, PlaidItemRecord, PlaidItemSecret, PlaidSyncKind},
    database::queries,
};

pub async fn upsert_plaid_item(
    executor: impl Executor<'_, Database = Sqlite>,
    params: queries::UpsertPlaidItemParams<'_>,
) -> Result<i64> {
    queries::upsert_plaid_item(executor, params)
        .await
        .map(|row| row.id)
        .map_err(Into::into)
}

pub async fn plaid_items(
    executor: impl Executor<'_, Database = Sqlite>,
    include_inactive: bool,
) -> Result<Vec<PlaidItemRecord>> {
    queries::list_plaid_items(
        executor,
        queries::ListPlaidItemsParams {
            active_only: !include_inactive,
            ..Default::default()
        },
    )
    .await
    .map(|rows| rows.into_iter().map(Into::into).collect())
    .map_err(Into::into)
}

pub async fn plaid_item_by_id(
    executor: impl Executor<'_, Database = Sqlite>,
    id: i64,
) -> Result<Option<PlaidItemRecord>> {
    let ids = [id];
    queries::list_plaid_items(
        executor,
        queries::ListPlaidItemsParams {
            ids: Some(&ids),
            ..Default::default()
        },
    )
    .await
    .map(|rows| rows.into_iter().next().map(Into::into))
    .map_err(Into::into)
}

pub async fn plaid_items_by_ids(
    executor: impl Executor<'_, Database = Sqlite>,
    ids: &[i64],
) -> Result<HashMap<i64, PlaidItemRecord>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    queries::list_plaid_items(
        executor,
        queries::ListPlaidItemsParams {
            ids: Some(ids),
            ..Default::default()
        },
    )
    .await
    .map(|rows| {
        rows.into_iter()
            .map(PlaidItemRecord::from)
            .map(|record| (record.item.id, record))
            .collect()
    })
    .map_err(Into::into)
}

pub async fn plaid_item_secret_by_id(
    executor: impl Executor<'_, Database = Sqlite>,
    id: i64,
    kind: PlaidSyncKind,
) -> Result<Option<PlaidItemSecret>> {
    queries::plaid_items_due(
        executor,
        queries::PlaidItemsDueParams {
            id: Some(id),
            kind: &kind.to_string(),
            due_only: false,
            ..Default::default()
        },
    )
    .await
    .map(|rows| rows.into_iter().next())
    .map_err(Into::into)
}

pub async fn plaid_items_due(
    executor: impl Executor<'_, Database = Sqlite>,
    kind: PlaidSyncKind,
    now: DateTime<Utc>,
) -> Result<Vec<PlaidItemSecret>> {
    queries::plaid_items_due(
        executor,
        queries::PlaidItemsDueParams {
            kind: &kind.to_string(),
            now: Some(now.into()),
            due_only: true,
            ..Default::default()
        },
    )
    .await
    .map_err(Into::into)
}

pub async fn reset_item_sync(executor: impl Executor<'_, Database = Sqlite>, item_id: i64) -> Result<()> {
    queries::reset_item_sync(executor, queries::ResetItemSyncParams { id: item_id })
        .await
        .map_err(Into::into)
}

pub async fn set_plaid_product_flags(
    executor: impl Executor<'_, Database = Sqlite>,
    item_id: i64,
    investments_enabled: bool,
    liabilities_enabled: bool,
) -> Result<()> {
    queries::set_plaid_product_flags(
        executor,
        queries::SetPlaidProductFlagsParams {
            plaid_investments_enabled: investments_enabled,
            plaid_liabilities_enabled: liabilities_enabled,
            id: item_id,
        },
    )
    .await
    .map_err(Into::into)
}

pub async fn set_plaid_item_health(
    executor: impl Executor<'_, Database = Sqlite>,
    item_id: i64,
    health_state: PlaidItemHealthState,
    error_code: Option<&str>,
    error_message: Option<&str>,
) -> Result<()> {
    queries::set_plaid_item_health(
        executor,
        queries::SetPlaidItemHealthParams {
            health_state: &health_state.to_string(),
            health_error_code: error_code,
            health_error_message: error_message,
            id: item_id,
        },
    )
    .await
    .map_err(Into::into)
}

pub async fn set_item_balance_synced(
    executor: impl Executor<'_, Database = Sqlite>,
    item_id: i64,
    next_balance_sync_at: DateTime<Utc>,
) -> Result<()> {
    queries::set_item_balance_synced(
        executor,
        queries::SetItemBalanceSyncedParams {
            next_balance_sync_at: Some(next_balance_sync_at.into()),
            id: item_id,
        },
    )
    .await
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use chrono::{DateTime, Utc};

    use crate::{
        database::{Timestamp, dbtest, queries},
        testutil::store::{create_owner, create_plaid_credential},
    };

    use super::*;

    #[tokio::test]
    async fn reused_plaid_item_secret_round_trips_storage_fields() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "alex").await?;
        let credential_id = create_plaid_credential(&pool).await?;
        let timestamp = "2026-09-06T12:00:00Z".parse::<DateTime<Utc>>()?;
        let item_id = upsert_plaid_item(
            &pool,
            queries::UpsertPlaidItemParams {
                external_id: "plaid-item",
                credential_id,
                access_token: "access-token",
                institution_id: Some("institution"),
                logo_url: Some("https://bank.example/logo"),
                next_sync_at: Some(timestamp.into()),
                next_recurring_sync_at: Some(timestamp.into()),
                next_balance_sync_at: Some(timestamp.into()),
                plaid_investments_enabled: true,
                plaid_liabilities_enabled: true,
            },
        )
        .await?;
        super::super::create_connection(&pool, item_id, Some("Bank"), owner.id).await?;
        sqlx::query(
            "UPDATE plaid_items SET cursor = ?, health_state = ?, health_error_code = ?, health_error_message = ?, health_updated_at = ?, last_recurring_synced_at = ?, last_synced_at = ?, sync_cron = ?, recurring_sync_cron = ?, created_at = ?, updated_at = ? WHERE id = ?",
        )
        .bind("cursor")
        .bind("SYNC_ERROR")
        .bind("code")
        .bind("message")
        .bind(Timestamp::from(timestamp))
        .bind(Timestamp::from(timestamp))
        .bind(Timestamp::from(timestamp))
        .bind("0 1 * * *")
        .bind("0 2 * * *")
        .bind(Timestamp::from(timestamp))
        .bind(Timestamp::from(timestamp))
        .bind(item_id)
        .execute(&pool)
        .await?;

        let secret = plaid_item_secret_by_id(&pool, item_id, crate::accounts::PlaidSyncKind::Sync)
            .await?
            .unwrap();
        assert_eq!(secret.owner_id, owner.id);
        assert_eq!(secret.owner, owner.name);
        assert_eq!(secret.institution_name.as_deref(), Some("Bank"));
        assert_eq!(secret.plaid_items.id, item_id);
        assert_eq!(secret.plaid_items.external_id, "plaid-item");
        assert_eq!(secret.plaid_items.credential_id, credential_id);
        assert_eq!(secret.plaid_items.access_token, "access-token");
        assert_eq!(secret.plaid_items.institution_id.as_deref(), Some("institution"));
        assert_eq!(
            secret.plaid_items.logo_url.as_deref(),
            Some("https://bank.example/logo")
        );
        assert_eq!(secret.plaid_items.cursor.as_deref(), Some("cursor"));
        assert_eq!(secret.plaid_items.health_state, "SYNC_ERROR");
        assert_eq!(secret.plaid_items.health_error_code.as_deref(), Some("code"));
        assert_eq!(secret.plaid_items.health_error_message.as_deref(), Some("message"));
        assert_eq!(secret.plaid_items.health_updated_at, Some(timestamp.into()));
        assert_eq!(secret.plaid_items.last_recurring_synced_at, Some(timestamp.into()));
        assert_eq!(secret.last_synced_at(), Some(timestamp));
        assert_eq!(secret.plaid_items.sync_cron, "0 1 * * *");
        assert_eq!(secret.plaid_items.recurring_sync_cron, "0 2 * * *");
        assert_eq!(secret.next_sync_at(), Some(timestamp));
        assert_eq!(secret.next_recurring_sync_at(), Some(timestamp));
        assert_eq!(secret.next_balance_sync_at(), Some(timestamp));
        assert!(secret.plaid_items.plaid_investments_enabled);
        assert!(secret.plaid_items.plaid_liabilities_enabled);
        assert_eq!(secret.plaid_items.created_at, timestamp.into());
        assert_eq!(secret.plaid_items.updated_at, timestamp.into());
        Ok(())
    }

    #[tokio::test]
    async fn empty_batch_lookups_return_empty_maps() -> Result<()> {
        let pool = dbtest::open().await?;
        assert!(plaid_items_by_ids(&pool, &[]).await?.is_empty());
        Ok(())
    }
}
