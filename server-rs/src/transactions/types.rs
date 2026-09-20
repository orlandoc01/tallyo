use chrono::{DateTime, Utc};
use serde::Serialize;
use strum_macros::{Display, EnumString};

use crate::{
    ids::Date,
    money::Cents,
    schema::{TransactionSort, TransactionsFilter},
};

pub const MAX_TRANSACTION_LIMIT: i32 = 1000;
const DEFAULT_TRANSACTION_LIMIT: i32 = 50;

pub use crate::schema::{
    Category, CategoryGroup, PageInfo, RecurringCharge, Rule, Tag, Transaction, TransactionConnection, TransactionEdge,
    TransactionsSummary,
};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct TransactionQuery {
    pub filter: Option<TransactionsFilter>,
    pub sort: Option<TransactionSort>,
    pub first: Option<i32>,
    pub after: Option<String>,
    pub last: Option<i32>,
    pub before: Option<String>,
}

impl TransactionQuery {
    pub fn limit(&self) -> i32 {
        self.first
            .filter(|limit| *limit > 0)
            .or_else(|| self.last.filter(|limit| *limit > 0))
            .map(|limit| limit.min(MAX_TRANSACTION_LIMIT))
            .unwrap_or(DEFAULT_TRANSACTION_LIMIT)
    }
}

#[derive(Clone, Copy, Debug, Display, EnumString, Eq, PartialEq)]
#[strum(serialize_all = "lowercase")]
pub enum TransactionSource {
    Plaid,
    Simplefin,
    Manual,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SpendingMode {
    pub by_category: bool,
    pub exclude_income: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SpendingRow {
    pub period_label: String,
    pub period_start: Date,
    pub period_end: Date,
    pub category: Option<Category>,
    pub total_amount: Cents,
    pub transaction_count: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ImportRow {
    pub row_num: usize,
    pub external_id: String,
    pub source: String,
    pub account_id: String,
    pub datetime: DateTime<Utc>,
    pub posted_datetime: DateTime<Utc>,
    pub amount: Cents,
    pub merchant_name: String,
    pub original_name: String,
    pub category: String,
    pub notes: String,
    pub is_recurring: bool,
    pub is_hidden: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ImportRowError {
    pub row: usize,
    pub message: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct ImportResult {
    pub processed: usize,
    pub skipped: usize,
    pub errors: Vec<ImportRowError>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ExportTransaction {
    pub external_id: String,
    pub source: String,
    pub owner_name: String,
    pub transaction: Transaction,
}
