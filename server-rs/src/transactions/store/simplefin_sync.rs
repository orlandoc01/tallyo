use anyhow::Result;
use sqlx::{Executor, Sqlite};

use crate::database::queries;

pub(crate) async fn pending_simple_fin_transaction_ids(
    executor: impl Executor<'_, Database = Sqlite>,
    token_id: i64,
) -> Result<Vec<String>> {
    queries::pending_simple_fin_transaction_ids(
        executor,
        queries::PendingSimpleFinTransactionIDsParams {
            access_token_id: token_id,
        },
    )
    .await
    .map(|rows| rows.into_iter().map(|row| row.external_id).collect())
    .map_err(Into::into)
}

pub(crate) async fn log_simple_fin_sync_batch(
    executor: impl Executor<'_, Database = Sqlite>,
    params: queries::LogSimpleFinSyncBatchParams<'_>,
) -> Result<()> {
    queries::log_simple_fin_sync_batch(executor, params)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use chrono::{DateTime, Utc};

    use super::*;
    use crate::{
        accounts::{
            AccountType, SourceTable, UpsertAccount,
            simplefin_types::UpsertSimpleFinConnectionParams,
            store::{create_simple_fin_access_token, link_simple_fin_connection, upsert_account},
        },
        database::queries,
        money::Cents,
        testutil::store::create_owner,
    };

    #[tokio::test]
    async fn finds_pending_simplefin_transactions_and_logs_a_batch() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        let owner = create_owner(&pool, "Alex").await?;
        let token = create_simple_fin_access_token(&pool, "https://bridge.example", owner.id, "Bridge").await?;
        let (simple_fin_connection_id, connection_id) = link_simple_fin_connection(
            &pool,
            &UpsertSimpleFinConnectionParams {
                external_id: "connection".to_owned(),
                access_token_id: token.id,
                org_id: None,
                org_domain: None,
                org_url: None,
                sfin_url: None,
                logo_url: None,
                name: "Bank".to_owned(),
                owner_id: owner.id,
            },
        )
        .await?;
        let account_id = upsert_account(
            &pool,
            &UpsertAccount {
                external_id: "account".to_owned(),
                connection_id: Some(connection_id),
                owner_id: owner.id,
                name: "Checking".to_owned(),
                account_type: AccountType::Depository,
                subtype: None,
                mask: None,
                notes: None,
                closed: false,
                hidden: false,
                needs_review: false,
            },
        )
        .await?;
        queries::insert_transaction(
            &pool,
            queries::InsertTransactionParams {
                source: "simplefin",
                external_id: "pending",
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
        .await?;
        sqlx::query("UPDATE transactions SET pending = 1 WHERE external_id = 'pending'")
            .execute(&pool)
            .await?;

        assert_eq!(pending_simple_fin_transaction_ids(&pool, token.id).await?, ["pending"]);
        log_simple_fin_sync_batch(
            &pool,
            queries::LogSimpleFinSyncBatchParams {
                access_token_id: token.id,
                start_date: Some("1788696000"),
                added: "[]",
                modified: "[\"pending\"]",
                pending_removed: "[]",
                error: None,
            },
        )
        .await?;
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM simplefin_sync_log WHERE access_token_id = ?")
                .bind(token.id)
                .fetch_one(&pool)
                .await?,
            1
        );
        assert_eq!(SourceTable::SimpleFinConnections.to_string(), "simplefin_connections");
        assert!(simple_fin_connection_id > 0);
        Ok(())
    }
}
