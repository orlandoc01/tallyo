use std::collections::HashSet;

use anyhow::{Context, Result, anyhow};
use chrono::Utc;
use serde_json::to_string;
use sqlx::SqlitePool;

use crate::{
    accounts::{
        AccountType, PlaidClientFactory, PlaidItemHealthState, PlaidItemSecret, PlaidSyncKind, SourceTable,
        fields_from_plaid_account,
        store::{
            connection_by_plaid_item_id, hidden_account_ids_by_connection, plaid_item_secret_by_id, plaid_items_due,
        },
    },
    clients::plaid::{
        PlaidApiError, PlaidClient, RemovedTransaction as PlaidRemovedTransaction, Transaction as PlaidTransaction,
    },
    transactions::{
        AccountDraft, ItemCounts, ItemReport, RemovedTransaction, SyncBatchApi, SyncBatchLog, SyncReport,
        TransactionSource, store::plaid_sync,
    },
    utils::cron::next_after,
};

use super::{
    PersistEvent, SyncAdapter, persister::Persister, plaid_convert::transaction_from_plaid,
    plaid_investments::filter_out_investment_accounts,
};

const MAX_SYNC_PAGINATION_RESTARTS: usize = 3;
const PAGINATION_MUTATION: &str = "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";

pub struct PlaidSync {
    pub(super) pool: SqlitePool,
    pub(super) clients: PlaidClientFactory,
}

impl PlaidSync {
    pub fn new(pool: SqlitePool, clients: PlaidClientFactory) -> Self {
        Self { pool, clients }
    }

    async fn sync_due(&self, sink: &Persister) -> SyncReport {
        match plaid_items_due(&self.pool, PlaidSyncKind::Sync, Utc::now()).await {
            Ok(items) => {
                let mut reports = Vec::with_capacity(items.len());
                for item in items {
                    reports.push(self.sync(item, sink).await);
                }
                SyncReport { items: reports }
            }
            Err(error) => SyncReport {
                items: vec![ItemReport::failure(ItemCounts::default(), error)],
            },
        }
    }

    async fn sync_connection_into(&self, item_id: i64, sink: &Persister) -> ItemReport {
        match plaid_item_secret_by_id(&self.pool, item_id, PlaidSyncKind::Sync).await {
            Ok(Some(item)) => self.sync(item, sink).await,
            Ok(None) => ItemReport::failure(ItemCounts::default(), anyhow!("plaid item {item_id} not found")),
            Err(error) => ItemReport::failure(ItemCounts::default(), error),
        }
    }

    async fn sync(&self, item: PlaidItemSecret, sink: &Persister) -> ItemReport {
        match self.sync_inner(item, sink).await {
            Ok(counts) => ItemReport::success(counts),
            Err(error) => ItemReport::failure(ItemCounts::default(), error),
        }
    }

    async fn sync_inner(&self, item: PlaidItemSecret, sink: &Persister) -> Result<ItemCounts> {
        let client = self
            .clients
            .client_for_credential(item.plaid_items.credential_id)
            .await?;
        let connection = connection_by_plaid_item_id(&self.pool, item.plaid_items.id)
            .await?
            .ok_or_else(|| anyhow!("no connection for plaid item {}", item.plaid_items.id))?;
        let account_drafts = self.account_drafts(&client, &item, connection.connection.id).await?;
        let investment_account_ids = investment_account_ids_for_sync(&item, &account_drafts);
        let investment_account_id_set = investment_account_ids.iter().cloned().collect::<HashSet<_>>();
        let investment_events = if investment_account_ids.is_empty() {
            Vec::new()
        } else {
            let result = self
                .investment_events(&client, &item, &investment_account_ids, connection.connection.id)
                .await;
            if let Err(error) = &result {
                self.record_error(item.plaid_items.id, error).await;
            }
            result.context(format!("sync investment transactions {}", item.plaid_items.id))?
        };
        if !account_drafts.iter().any(transaction_syncable) {
            let next_sync_at = next_after(&item.plaid_items.sync_cron, Utc::now())?;
            let counts = sink
                .persist(
                    account_drafts
                        .into_iter()
                        .map(PersistEvent::AccountUpsert)
                        .chain(investment_events)
                        .collect(),
                )
                .await?;
            plaid_sync::set_sync_cursor(&self.pool, item.plaid_items.id, None, next_sync_at).await?;
            crate::accounts::store::set_plaid_item_health(
                &self.pool,
                item.plaid_items.id,
                PlaidItemHealthState::Healthy,
                None,
                None,
            )
            .await?;
            log_batch(&self.pool, &empty_batch(item.plaid_items.id)).await;
            Ok(counts)
        } else if investment_account_ids.is_empty() {
            self.sync_pages(
                item,
                account_drafts,
                connection.connection.id,
                client,
                sink,
                &investment_account_id_set,
            )
            .await
        } else {
            let mut counts = sink
                .persist(
                    account_drafts
                        .into_iter()
                        .map(PersistEvent::AccountUpsert)
                        .chain(investment_events)
                        .collect(),
                )
                .await?;
            add_counts(
                &mut counts,
                self.sync_pages(
                    item,
                    Vec::new(),
                    connection.connection.id,
                    client,
                    sink,
                    &investment_account_id_set,
                )
                .await?,
            );
            Ok(counts)
        }
    }

    async fn account_drafts(
        &self,
        client: &PlaidClient,
        item: &PlaidItemSecret,
        connection_id: i64,
    ) -> Result<Vec<AccountDraft>> {
        client
            .accounts(&item.plaid_items.access_token)
            .await
            .context("fetch Plaid accounts")
            .map(|accounts| {
                accounts
                    .iter()
                    .map(|account| {
                        let fields = fields_from_plaid_account(account);
                        AccountDraft {
                            external_id: fields.id,
                            connection_id,
                            owner_id: item.owner_id,
                            name: fields.name,
                            account_type: fields.account_type,
                            subtype: fields.subtype,
                            mask: fields.mask,
                            needs_review: false,
                        }
                    })
                    .collect()
            })
    }

    async fn sync_pages(
        &self,
        item: PlaidItemSecret,
        mut account_drafts: Vec<AccountDraft>,
        connection_id: i64,
        client: PlaidClient,
        sink: &Persister,
        investment_account_ids: &HashSet<String>,
    ) -> Result<ItemCounts> {
        let mut cursor = plaid_sync::sync_cursor(&self.pool, item.plaid_items.id).await?;
        let hidden = hidden_account_ids_by_connection(&self.pool, connection_id).await?;
        let mut first_page = true;
        let mut counts = ItemCounts::default();
        let mut restarts = 0;
        let mut batch = TransactionSyncBatch::default();
        loop {
            let response = match client.sync(&item.plaid_items.access_token, &cursor).await {
                Ok(response) => response,
                Err(error) if is_pagination_mutation(&error) && restarts + 1 < MAX_SYNC_PAGINATION_RESTARTS => {
                    restarts += 1;
                    tracing::warn!(
                        item_id = item.plaid_items.id,
                        restart = restarts,
                        "plaid transactions sync pagination mutated; restarting"
                    );
                    continue;
                }
                Err(error) if is_pagination_mutation(&error) => {
                    return Err(anyhow!(
                        "transactions sync pagination mutated after {MAX_SYNC_PAGINATION_RESTARTS} restarts: {error}"
                    ));
                }
                Err(error) => {
                    self.record_error(item.plaid_items.id, &error).await;
                    return Err(error).context(format!("sync transactions {}", item.plaid_items.id));
                }
            };
            restarts = 0;
            let added = filter_out_investment_accounts(&response.added, investment_account_ids);
            let modified = filter_out_investment_accounts(&response.modified, investment_account_ids);
            let transactions = added
                .iter()
                .chain(&modified)
                .map(|transaction| transaction_from_plaid(transaction, &hidden))
                .collect::<Result<Vec<_>>>()?;
            let removals = response
                .removed
                .iter()
                .filter_map(|transaction| transaction.transaction_id.as_ref())
                .map(|external_id| RemovedTransaction {
                    external_id: external_id.clone(),
                    source: TransactionSource::Plaid,
                })
                .collect::<Vec<_>>();
            let next_sync_at = next_after(&item.plaid_items.sync_cron, Utc::now())?;
            let account_events = if first_page { std::mem::take(&mut account_drafts) } else { Vec::new() };
            let events = account_events
                .into_iter()
                .map(PersistEvent::AccountUpsert)
                .chain(removals.into_iter().map(PersistEvent::Removal))
                .chain(transactions.into_iter().map(PersistEvent::Upsert))
                .collect();
            let page_counts = sink
                .persist(events)
                .await
                .context("persist batch failed; cursor not advanced, will retry next sync")?;
            plaid_sync::set_sync_cursor(
                &self.pool,
                item.plaid_items.id,
                (!response.next_cursor.is_empty()).then_some(response.next_cursor.as_str()),
                next_sync_at,
            )
            .await?;
            crate::accounts::store::set_plaid_item_health(
                &self.pool,
                item.plaid_items.id,
                PlaidItemHealthState::Healthy,
                None,
                None,
            )
            .await?;
            add_counts(&mut counts, page_counts);
            first_page = false;
            batch.added.extend(added);
            batch.modified.extend(modified);
            batch.removed.extend(response.removed.clone());
            cursor = response.next_cursor;
            if !response.has_more {
                log_batch(&self.pool, &batch_log(item.plaid_items.id, &batch)?).await;
                return Ok(counts);
            }
        }
    }

    async fn record_error(&self, item_id: i64, error: &anyhow::Error) {
        let Some(error) = error.downcast_ref::<PlaidApiError>() else {
            return;
        };
        let state = match error.error_code.as_deref() {
            Some("ITEM_LOGIN_REQUIRED") => PlaidItemHealthState::LinkUpdateRequired,
            _ => PlaidItemHealthState::SyncError,
        };
        if let Err(error) = crate::accounts::store::set_plaid_item_health(
            &self.pool,
            item_id,
            state,
            error.error_code.as_deref(),
            error.error_message.as_deref(),
        )
        .await
        {
            tracing::warn!(item_id, %error, "plaid sync failed");
        }
    }
}

impl SyncAdapter for PlaidSync {
    fn handles(&self, provider: SourceTable) -> bool {
        provider == SourceTable::PlaidItems
    }

    fn sync_due<'a>(&'a self, sink: &'a Persister) -> crate::utils::future::BoxFuture<'a, SyncReport> {
        Box::pin(async move { self.sync_due(sink).await })
    }

    fn sync_connection_into<'a>(
        &'a self,
        source_id: i64,
        sink: &'a Persister,
    ) -> crate::utils::future::BoxFuture<'a, ItemReport> {
        Box::pin(async move { self.sync_connection_into(source_id, sink).await })
    }

    fn sync_recurring_due<'a>(&'a self, sink: &'a Persister) -> crate::utils::future::BoxFuture<'a, SyncReport> {
        Box::pin(async move { self.sync_recurring_due(sink).await })
    }
}

fn transaction_syncable(account: &AccountDraft) -> bool {
    matches!(account.account_type, AccountType::Depository | AccountType::Credit)
}

fn investment_account_ids_for_sync(item: &PlaidItemSecret, account_drafts: &[AccountDraft]) -> Vec<String> {
    if item.plaid_items.plaid_investments_enabled {
        account_drafts
            .iter()
            .filter(|account| account.account_type == AccountType::Investment)
            .map(|account| account.external_id.clone())
            .collect()
    } else {
        Vec::new()
    }
}

#[derive(Default)]
struct TransactionSyncBatch {
    added: Vec<PlaidTransaction>,
    modified: Vec<PlaidTransaction>,
    removed: Vec<PlaidRemovedTransaction>,
}

fn batch_log(item_id: i64, batch: &TransactionSyncBatch) -> Result<SyncBatchLog> {
    Ok(SyncBatchLog {
        item_id,
        api: SyncBatchApi::Transactions,
        added: to_string(&batch.added)?,
        modified: to_string(&batch.modified)?,
        removed: to_string(&batch.removed)?,
    })
}

pub(super) async fn log_batch(pool: &SqlitePool, batch: &SyncBatchLog) {
    if let Err(error) = plaid_sync::log_sync_batch(pool, batch).await {
        tracing::error!(item_id = batch.item_id, %error, "failed to write sync log");
    }
}

fn empty_batch(item_id: i64) -> SyncBatchLog {
    SyncBatchLog {
        item_id,
        api: SyncBatchApi::Transactions,
        added: "[]".to_owned(),
        modified: "[]".to_owned(),
        removed: "[]".to_owned(),
    }
}

fn is_pagination_mutation(error: &anyhow::Error) -> bool {
    error
        .downcast_ref::<PlaidApiError>()
        .and_then(|error| error.error_code.as_deref())
        == Some(PAGINATION_MUTATION)
}

fn add_counts(total: &mut ItemCounts, page: ItemCounts) {
    total.accounts_upserted += page.accounts_upserted;
    total.added += page.added;
    total.modified += page.modified;
    total.removed += page.removed;
}

#[cfg(test)]
mod tests {
    use anyhow::anyhow;

    use super::{
        PlaidApiError, PlaidRemovedTransaction, PlaidTransaction, TransactionSyncBatch, batch_log,
        is_pagination_mutation,
    };
    use crate::transactions::SyncBatchApi;

    #[test]
    fn builds_accumulated_plaid_batch_logs_and_detects_pagination_mutations() {
        let batch = TransactionSyncBatch {
            added: vec![PlaidTransaction {
                transaction_id: "added".to_owned(),
                ..Default::default()
            }],
            modified: vec![PlaidTransaction {
                transaction_id: "modified".to_owned(),
                ..Default::default()
            }],
            removed: vec![PlaidRemovedTransaction {
                transaction_id: Some("removed".to_owned()),
                ..Default::default()
            }],
        };
        let log = batch_log(7, &batch).unwrap();
        assert_eq!(log.item_id, 7);
        assert_eq!(log.api, SyncBatchApi::Transactions);
        assert!(log.added.contains("added"));
        assert!(log.modified.contains("modified"));
        assert!(log.removed.contains("removed"));

        let error = anyhow!(PlaidApiError {
            status: reqwest::StatusCode::CONFLICT,
            body: String::new(),
            error_code: Some(super::PAGINATION_MUTATION.to_owned()),
            error_type: None,
            error_message: None,
            request_id: None,
        });
        assert!(is_pagination_mutation(&error));
        assert!(!is_pagination_mutation(&anyhow!("network error")));
    }
}
