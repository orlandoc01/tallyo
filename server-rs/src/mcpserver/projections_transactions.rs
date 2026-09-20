use chrono::{DateTime, Utc};
use serde::Serialize;

use super::projections::encode;
use crate::{
    ids::{Date, GlobalIdType},
    money::Cents,
    schema::{BulkUpdateTransactionsPayload, PageInfo, Transaction, TransactionConnection, TransactionsSummary},
};

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanTransaction {
    pub(super) id: String,
    pub(super) account_id: String,
    pub(super) account_name: String,
    pub(super) amount: Cents,
    pub(super) datetime: DateTime<Utc>,
    pub(super) posted_datetime: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) merchant_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) original_name: Option<String>,
    pub(super) category_id: String,
    pub(super) category_name: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub(super) is_recurring: bool,
    pub(super) is_reviewed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) notes: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub(super) pending: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub(super) is_hidden: bool,
}

pub(super) fn map_transaction(transaction: Transaction) -> LeanTransaction {
    LeanTransaction {
        id: encode(GlobalIdType::Transaction, transaction.id),
        account_id: encode(GlobalIdType::Account, transaction.account.id),
        account_name: transaction.account.name,
        amount: transaction.amount,
        datetime: transaction.datetime,
        posted_datetime: transaction.posted_datetime,
        merchant_name: transaction.merchant_name,
        original_name: transaction.original_name,
        category_id: encode(GlobalIdType::Category, transaction.category.id),
        category_name: transaction.category.name,
        is_recurring: transaction.is_recurring,
        is_reviewed: transaction.is_reviewed,
        notes: transaction.notes,
        pending: transaction.pending,
        is_hidden: transaction.is_hidden,
    }
}

#[derive(Debug, PartialEq, Serialize)]
pub(super) struct LeanTransactionPayload {
    pub(super) transaction: Option<LeanTransaction>,
}

pub(super) fn map_transaction_payload(transaction: Option<Transaction>) -> LeanTransactionPayload {
    LeanTransactionPayload {
        transaction: transaction.map(map_transaction),
    }
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanBulkUpdateTransactionsPayload {
    pub(super) updated_count: i32,
    pub(super) transactions: Vec<LeanTransaction>,
}

pub(super) fn map_bulk_update_transactions_payload(
    payload: BulkUpdateTransactionsPayload,
) -> LeanBulkUpdateTransactionsPayload {
    LeanBulkUpdateTransactionsPayload {
        updated_count: payload.updated_count,
        transactions: payload.transactions.into_iter().map(map_transaction).collect(),
    }
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanPageInfo {
    pub(super) has_next_page: bool,
    pub(super) has_previous_page: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) start_cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) end_cursor: Option<String>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanTransactionConnection {
    pub(super) items: Vec<LeanTransaction>,
    pub(super) page_info: LeanPageInfo,
    pub(super) total_count: i32,
}

pub(super) fn map_transaction_connection(connection: TransactionConnection) -> LeanTransactionConnection {
    let PageInfo {
        has_next_page,
        has_previous_page,
        start_cursor,
        end_cursor,
    } = connection.page_info;
    LeanTransactionConnection {
        items: connection
            .edges
            .into_iter()
            .map(|edge| map_transaction(edge.node))
            .collect(),
        page_info: LeanPageInfo {
            has_next_page,
            has_previous_page,
            start_cursor,
            end_cursor,
        },
        total_count: connection.total_count,
    }
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanTransactionsSummary {
    pub(super) total_count: i32,
    pub(super) total_amount: Cents,
    pub(super) average_amount: Cents,
    pub(super) largest_amount: Cents,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) first_date: Option<Date>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) last_date: Option<Date>,
}

pub(super) fn map_transactions_summary(summary: TransactionsSummary) -> LeanTransactionsSummary {
    LeanTransactionsSummary {
        total_count: summary.total_count,
        total_amount: summary.total_amount,
        average_amount: summary.average_amount,
        largest_amount: summary.largest_amount,
        first_date: summary.first_date,
        last_date: summary.last_date,
    }
}
