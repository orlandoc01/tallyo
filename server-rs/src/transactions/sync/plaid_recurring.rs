use anyhow::{Context, Result};
use chrono::Utc;

use crate::{
    accounts::{
        PlaidItemSecret, PlaidSyncKind,
        store::{plaid_items_due, syncable_account_external_ids_by_item},
    },
    clients::plaid::PlaidApiError,
    money::Cents,
    transactions::{ItemCounts, ItemReport, RecurringChargeDraft, SyncReport, store::plaid_sync},
    utils::cron::next_after,
};

use super::{PersistEvent, PlaidSync, persister::Persister};

impl PlaidSync {
    pub(super) async fn sync_recurring_due(&self, sink: &Persister) -> SyncReport {
        match plaid_items_due(&self.pool, PlaidSyncKind::Recurring, Utc::now()).await {
            Ok(items) => {
                let mut reports = Vec::with_capacity(items.len());
                for item in items {
                    reports.push(self.sync_recurring(item, sink).await);
                }
                SyncReport { items: reports }
            }
            Err(error) => SyncReport {
                items: vec![ItemReport::failure(ItemCounts::default(), error)],
            },
        }
    }

    async fn sync_recurring(&self, item: PlaidItemSecret, sink: &Persister) -> ItemReport {
        match self.sync_recurring_inner(item, sink).await {
            Ok(()) => ItemReport::success(ItemCounts::default()),
            Err(error) => ItemReport::failure(ItemCounts::default(), error),
        }
    }

    async fn sync_recurring_inner(&self, item: PlaidItemSecret, sink: &Persister) -> Result<()> {
        let account_ids = syncable_account_external_ids_by_item(&self.pool, item.plaid_items.id)
            .await
            .context("sync recurring streams: failed to fetch accounts")?;
        if account_ids.is_empty() {
            let next_sync_at = next_after(&item.plaid_items.recurring_sync_cron, Utc::now())?;
            return plaid_sync::set_item_recurring_synced(&self.pool, item.plaid_items.id, next_sync_at).await;
        }
        let client = self
            .clients
            .client_for_credential(item.plaid_items.credential_id)
            .await
            .context("sync recurring streams: failed to create client")?;
        let response = match client
            .transactions_recurring_get(&item.plaid_items.access_token, &account_ids)
            .await
        {
            Ok(response) => response,
            Err(error) => {
                log_recurring_error(item.plaid_items.id, &error);
                let next_sync_at = next_after(&item.plaid_items.recurring_sync_cron, Utc::now())?;
                return plaid_sync::set_item_recurring_synced(&self.pool, item.plaid_items.id, next_sync_at).await;
            }
        };
        let events = response
            .inflow_streams
            .iter()
            .chain(&response.outflow_streams)
            .map(recurring_charge)
            .collect::<Result<Vec<_>>>()?;
        let events = events
            .into_iter()
            .map(PersistEvent::Recurring)
            .chain(std::iter::once(PersistEvent::MarkRecurring {
                source_id: item.plaid_items.id,
            }))
            .collect();
        let next_sync_at = next_after(&item.plaid_items.recurring_sync_cron, Utc::now())?;
        if let Err(error) = sink.persist(events).await {
            tracing::warn!(item_id = item.plaid_items.id, %error, "sync recurring streams: persist failed");
            return Err(error);
        }
        plaid_sync::set_item_recurring_synced(&self.pool, item.plaid_items.id, next_sync_at).await
    }
}

fn log_recurring_error(item_id: i64, error: &anyhow::Error) {
    let Some(error) = error.downcast_ref::<PlaidApiError>() else {
        tracing::warn!(item_id, %error, "sync recurring streams: request failed, skipping");
        return;
    };
    tracing::warn!(
        item_id,
        error_code = error.error_code.as_deref().unwrap_or_default(),
        error_message = error.error_message.as_deref().unwrap_or_default(),
        "sync recurring streams: plaid api error, skipping"
    );
}

fn recurring_charge(stream: &crate::clients::plaid::TransactionStream) -> Result<RecurringChargeDraft> {
    Ok(RecurringChargeDraft {
        external_id: stream.stream_id.clone(),
        account_id: stream.account_id.clone(),
        description: stream.description.clone(),
        merchant_name: stream
            .merchant_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(ToOwned::to_owned),
        frequency: stream.frequency.clone(),
        status: stream.status.clone(),
        is_active: stream.is_active,
        average_amount: Cents::from_dollars_checked(stream.average_amount.amount.unwrap_or_default())?,
        last_amount: Cents::from_dollars_checked(stream.last_amount.amount.unwrap_or_default())?,
        first_date: stream.first_date.clone(),
        last_date: stream.last_date.clone(),
        is_user_modified: stream.is_user_modified,
        transaction_ids: stream.transaction_ids.clone(),
    })
}
