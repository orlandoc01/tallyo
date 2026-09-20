use chrono::{DateTime, Utc};
use strum_macros::Display;

use crate::{
    accounts::{AccountType, SourceTable},
    money::Cents,
    transactions::TransactionSource,
    utils::future::BoxFuture,
};

use super::persister::Persister;

#[derive(Clone, Debug, PartialEq)]
pub struct SyncedTransaction {
    pub external_id: String,
    pub account_id: String,
    pub amount: Cents,
    pub datetime: DateTime<Utc>,
    pub posted_datetime: DateTime<Utc>,
    pub merchant_name: Option<String>,
    pub original_name: Option<String>,
    pub logo_url: Option<String>,
    pub plaid_category: Option<String>,
    pub raw_provider_json: Option<String>,
    pub source: TransactionSource,
    pub pending: bool,
    pub hidden_by_account: bool,
    pub stage_for_llm: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AccountDraft {
    pub external_id: String,
    pub connection_id: i64,
    pub owner_id: i64,
    pub name: String,
    pub account_type: AccountType,
    pub subtype: Option<String>,
    pub mask: Option<String>,
    pub needs_review: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RemovedTransaction {
    pub external_id: String,
    pub source: TransactionSource,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RecurringChargeDraft {
    pub external_id: String,
    pub account_id: String,
    pub description: String,
    pub merchant_name: Option<String>,
    pub frequency: String,
    pub status: String,
    pub is_active: bool,
    pub average_amount: Cents,
    pub last_amount: Cents,
    pub first_date: String,
    pub last_date: String,
    pub is_user_modified: bool,
    pub transaction_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PersistEvent {
    AccountUpsert(AccountDraft),
    Upsert(SyncedTransaction),
    Removal(RemovedTransaction),
    Recurring(RecurringChargeDraft),
    MarkRecurring { source_id: i64 },
}

#[derive(Clone, Copy, Debug, Display, Eq, PartialEq)]
#[strum(serialize_all = "lowercase")]
pub enum SyncBatchApi {
    Transactions,
    Investments,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SyncBatchLog {
    pub item_id: i64,
    pub api: SyncBatchApi,
    pub added: String,
    pub modified: String,
    pub removed: String,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ItemCounts {
    pub accounts_upserted: u32,
    pub added: u32,
    pub modified: u32,
    pub removed: u32,
}

#[derive(Debug)]
pub struct ItemReport {
    pub counts: ItemCounts,
    pub error: Option<anyhow::Error>,
}

impl ItemReport {
    pub fn success(counts: ItemCounts) -> Self {
        Self { counts, error: None }
    }

    pub fn failure(counts: ItemCounts, error: anyhow::Error) -> Self {
        Self {
            counts,
            error: Some(error),
        }
    }
}

#[derive(Debug, Default)]
pub struct SyncReport {
    pub items: Vec<ItemReport>,
}

pub trait SyncAdapter: Send + Sync {
    fn handles(&self, provider: SourceTable) -> bool;
    fn sync_due<'a>(&'a self, sink: &'a Persister) -> BoxFuture<'a, SyncReport>;
    fn sync_connection_into<'a>(&'a self, source_id: i64, sink: &'a Persister) -> BoxFuture<'a, ItemReport>;
    fn sync_recurring_due<'a>(&'a self, _sink: &'a Persister) -> BoxFuture<'a, SyncReport> {
        Box::pin(async { SyncReport::default() })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ItemSyncResult {
    pub added: u32,
    pub modified: u32,
    pub removed: u32,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SyncResult {
    pub items: Vec<ItemSyncResult>,
    pub total_added: u32,
    pub total_modified: u32,
    pub total_removed: u32,
}

#[cfg(test)]
mod tests {
    use super::SyncBatchApi;

    #[test]
    fn serializes_sync_batch_api_values() {
        assert_eq!(SyncBatchApi::Transactions.to_string(), "transactions");
        assert_eq!(SyncBatchApi::Investments.to_string(), "investments");
    }
}
