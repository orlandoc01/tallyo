use anyhow::{Result, anyhow};
use chrono::NaiveDate;
use rand::Rng;
use sqlx::{Executor, Sqlite, SqlitePool};

use crate::{
    accounts::store::account_by_id,
    apierror::ApiError,
    database::{self, queries},
    ids::{Date, GlobalId, GlobalIdType},
    money::Cents,
    schema::{CreateTransactionInput, TransactionUpdates},
    transactions::{
        Cursor, ExportTransaction, PageInfo, Transaction, TransactionConnection, TransactionEdge, TransactionQuery,
        TransactionsSummary,
    },
};

use super::{
    categories::category_by_id,
    query::{FilterValues, local_id, local_ids, query_cursor},
    transaction_targets::{resolve_bulk_target_ids, transactions_by_ids},
    transaction_updates::{replace_transaction_tags, update_params},
};

const UPDATES_REQUIRED: &str = "updates is required";
const TRANSACTION_NOT_FOUND: &str = "transaction not found";

pub async fn transaction_by_id(pool: &SqlitePool, id: i64) -> Result<Option<Transaction>> {
    let values = FilterValues::from_filter(None, vec![id])?;
    queries::transaction_records(pool, values.records_params(None, None, false, 1))
        .await
        .map(|rows| rows.into_iter().next().map(Into::into))
        .map_err(Into::into)
}

pub async fn transactions(pool: &SqlitePool, query: TransactionQuery) -> Result<TransactionConnection> {
    let values = FilterValues::from_filter(query.filter.as_ref(), Vec::new())?;
    let total_count = queries::count_transaction_records(pool, values.count_params())
        .await?
        .total_count;
    let limit = query.limit() as usize;
    let reverse = query.last.is_some_and(|last| last > 0);
    let cursor = query_cursor(&query)?;
    let after = cursor.as_ref().is_some_and(|(_, after)| *after);
    let mut rows = queries::transaction_records(
        pool,
        values.records_params(cursor, query.sort.as_ref(), reverse, (limit + 1) as i64),
    )
    .await?;
    let has_more = rows.len() > limit;
    rows.truncate(limit);
    if reverse {
        rows.reverse();
    }
    let edges = rows
        .into_iter()
        .map(Transaction::from)
        .map(|node| {
            let cursor = super::super::encode_cursor(&Cursor {
                datetime: node.datetime,
                id: node.id,
                amount: node.amount,
            });
            TransactionEdge { node, cursor }
        })
        .collect::<Vec<_>>();
    Ok(TransactionConnection {
        page_info: PageInfo {
            has_next_page: if reverse { query.before.is_some() } else { has_more },
            has_previous_page: if reverse { has_more } else { after },
            start_cursor: edges.first().map(|edge| edge.cursor.clone()),
            end_cursor: edges.last().map(|edge| edge.cursor.clone()),
        },
        edges,
        total_count: total_count as i32,
    })
}

pub async fn transactions_summary(
    pool: &SqlitePool,
    filter: Option<&crate::schema::TransactionsFilter>,
) -> Result<TransactionsSummary> {
    let values = FilterValues::from_filter(filter, Vec::new())?;
    let summary = queries::transaction_records_summary(pool, values.summary_params()).await?;
    if summary.total_count == 0 {
        return Ok(TransactionsSummary {
            total_count: 0,
            total_amount: Cents::default(),
            average_amount: Cents::default(),
            largest_amount: Cents::default(),
            first_date: None,
            last_date: None,
        });
    }
    Ok(TransactionsSummary {
        total_count: summary.total_count as i32,
        total_amount: Cents(summary.total_amount_cents),
        average_amount: Cents::from_dollars(summary.average_amount.unwrap_or_default() / 100.0),
        largest_amount: Cents(summary.largest_amount_cents),
        first_date: Some(Date::new(summary.first_date)?),
        last_date: Some(Date::new(summary.last_date)?),
    })
}

pub async fn create_transaction(pool: &SqlitePool, input: CreateTransactionInput) -> Result<Transaction> {
    let account_id = local_id(&input.account_id, GlobalIdType::Account)?;
    let account = account_by_id(pool, account_id)
        .await?
        .ok_or_else(|| ApiError::bad_input(format!("account {account_id} not found")))?;
    let category_id = match input.category_id.as_ref() {
        Some(id) => {
            let id = local_id(id, GlobalIdType::Category)?;
            category_by_id(pool, id)
                .await?
                .ok_or_else(|| ApiError::bad_input(format!("category {id} not found")))?;
            id
        }
        None => 0,
    };
    let merchant_name = trimmed(input.merchant_name.as_deref());
    let original_name = trimmed(input.original_name.as_deref());
    anyhow::ensure!(
        merchant_name.is_some() || original_name.is_some(),
        ApiError::bad_input("merchantName or originalName is required")
    );
    let date = NaiveDate::parse_from_str(input.date.as_str(), "%Y-%m-%d")?;
    let datetime = date.and_hms_opt(12, 0, 0).expect("noon is valid").and_utc();
    let notes = trimmed(input.notes.as_deref());
    for _ in 0..3 {
        let external_id = manual_transaction_id();
        if let Some(row) = queries::insert_transaction_opt(
            pool,
            queries::InsertTransactionParams {
                source: "manual",
                external_id: &external_id,
                account_id,
                amount_cents: input.amount,
                datetime: datetime.into(),
                posted_datetime: datetime.into(),
                merchant_name: merchant_name.as_deref(),
                original_name: original_name.as_deref(),
                category_id,
                is_reviewed: input.category_id.is_some(),
                is_recurring: input.is_recurring.unwrap_or(false),
                is_hidden: input.is_hidden.unwrap_or(account.hidden),
                notes: notes.as_deref(),
            },
        )
        .await?
        {
            return transaction_by_id(pool, row.id)
                .await?
                .ok_or_else(|| anyhow!("transaction {} not found", row.id));
        }
    }
    Err(anyhow!("generate unique manual transaction id"))
}

pub async fn update_transaction(pool: &SqlitePool, id: i64, updates: &TransactionUpdates) -> Result<Transaction> {
    let params = update_params(updates, &[id])?;
    let tags = updates
        .tag_ids
        .as_deref()
        .map(|tag_ids| local_ids(Some(tag_ids), GlobalIdType::Tag))
        .transpose()?;
    if !params.changed && tags.is_none() {
        return transaction_by_id(pool, id).await?.ok_or_else(transaction_not_found);
    }
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            if params.changed
                && queries::update_transaction_fields_by_ids(&mut **transaction, params.query()).await? == 0
            {
                return Err(transaction_not_found());
            }
            if let Some(tags) = tags {
                replace_transaction_tags(transaction, &[id], &tags).await?;
            }
            Ok(())
        })
    })
    .await?;
    transaction_by_id(pool, id).await?.ok_or_else(transaction_not_found)
}

fn transaction_not_found() -> anyhow::Error {
    ApiError::bad_input(TRANSACTION_NOT_FOUND).into()
}

pub async fn bulk_update_transactions(
    pool: &SqlitePool,
    transaction_ids: Option<&[GlobalId]>,
    filter: Option<&crate::schema::TransactionsFilter>,
    updates: Option<&TransactionUpdates>,
) -> Result<Vec<Transaction>> {
    let updates = updates.ok_or_else(|| anyhow!(UPDATES_REQUIRED))?;
    let ids = resolve_bulk_target_ids(pool, transaction_ids, filter).await?;
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let params = update_params(updates, &ids)?;
    let tags = updates
        .tag_ids
        .as_deref()
        .map(|tag_ids| local_ids(Some(tag_ids), GlobalIdType::Tag))
        .transpose()?;
    if params.changed || tags.is_some() {
        let updated_ids = ids.clone();
        database::with_tx(pool, |transaction| {
            Box::pin(async move {
                if params.changed {
                    queries::update_transaction_fields_by_ids(&mut **transaction, params.query()).await?;
                }
                if let Some(tags) = tags {
                    replace_transaction_tags(transaction, &updated_ids, &tags).await?;
                }
                Ok(())
            })
        })
        .await?;
    }
    transactions_by_ids(pool, &ids).await
}

pub async fn delete_transaction(executor: impl Executor<'_, Database = Sqlite>, id: i64) -> Result<bool> {
    queries::delete_transactions_by_ids(executor, queries::DeleteTransactionsByIDsParams { ids: &[id] })
        .await
        .map(|rows| rows > 0)
        .map_err(Into::into)
}

pub async fn bulk_delete_transactions(
    pool: &SqlitePool,
    transaction_ids: Option<&[GlobalId]>,
    filter: Option<&crate::schema::TransactionsFilter>,
) -> Result<i64> {
    let ids = resolve_bulk_target_ids(pool, transaction_ids, filter).await?;
    if ids.is_empty() {
        return Ok(0);
    }
    queries::delete_transactions_by_ids(pool, queries::DeleteTransactionsByIDsParams { ids: &ids })
        .await
        .map(|rows| rows as i64)
        .map_err(Into::into)
}

pub async fn export_transaction_page(
    pool: &SqlitePool,
    filter: Option<&crate::schema::TransactionsFilter>,
    cursor: Option<Cursor>,
    limit: usize,
) -> Result<(Vec<ExportTransaction>, Option<Cursor>)> {
    let values = FilterValues::from_filter(filter, Vec::new())?;
    let mut rows = queries::transaction_records(
        pool,
        values.records_params(cursor.map(|cursor| (cursor, true)), None, false, (limit + 1) as i64),
    )
    .await?;
    let has_more = rows.len() > limit;
    rows.truncate(limit);
    let next = has_more.then(|| {
        let row = rows.last().expect("over-fetch leaves a page row");
        Cursor {
            datetime: row.datetime.into(),
            id: row.id,
            amount: Default::default(),
        }
    });
    Ok((
        rows.into_iter()
            .map(|row| ExportTransaction {
                external_id: row.external_id.clone(),
                source: row.source.clone(),
                owner_name: row.owner_name.clone(),
                transaction: row.into(),
            })
            .collect(),
        next,
    ))
}

fn trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn manual_transaction_id() -> String {
    let bytes: [u8; 6] = rand::rng().random();
    format!("manual-{}", hex::encode(bytes))
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use async_graphql::ID;

    use super::*;
    use crate::{
        ids::Date,
        money::Cents,
        schema::{CategoryKind, CreateTransactionInput, TransactionsFilter},
        testutil::transactions::{account, category, transaction},
    };

    fn id(typ: GlobalIdType, value: i64) -> ID {
        ID::from(GlobalId::new(typ, value).encoded_string())
    }

    fn filter(search: &str) -> TransactionsFilter {
        TransactionsFilter {
            datetime_range: None,
            category_ids: None,
            account_ids: None,
            owner_ids: None,
            is_reviewed: None,
            is_recurring: None,
            is_pending: None,
            is_hidden: None,
            merchant_prefix: None,
            original_prefix: None,
            exclude_transfers: None,
            exclude_income: None,
            amount_min: None,
            amount_max: None,
            exact_amount: None,
            tag_ids: None,
            untagged: None,
            search: Some(search.into()),
        }
    }

    fn query(first: Option<i32>, after: Option<String>) -> TransactionQuery {
        TransactionQuery {
            filter: None,
            sort: None,
            first,
            after,
            last: None,
            before: None,
        }
    }

    #[tokio::test]
    async fn creates_updates_reads_and_deletes_manual_transactions() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        let account_id = account(&pool, "manual-account").await?;
        let category = category(&pool, "Food", CategoryKind::Expense).await?;
        let created = create_transaction(
            &pool,
            CreateTransactionInput {
                account_id: id(GlobalIdType::Account, account_id),
                date: Date::new("2026-01-02")?,
                amount: Cents(125),
                merchant_name: Some("  Shop  ".into()),
                original_name: None,
                category_id: Some(id(GlobalIdType::Category, category.id)),
                notes: Some("  note  ".into()),
                is_recurring: Some(true),
                is_hidden: Some(false),
            },
        )
        .await?;
        assert_eq!(
            (
                created.merchant_name.as_deref(),
                created.notes.as_deref(),
                created.datetime.to_rfc3339(),
                created.category.id,
            ),
            (
                Some("Shop"),
                Some("note"),
                "2026-01-02T12:00:00+00:00".to_owned(),
                category.id
            )
        );
        let updated = update_transaction(
            &pool,
            created.id,
            &TransactionUpdates {
                merchant_name: Some(" ".into()),
                notes: Some(String::new()),
                is_recurring: Some(false),
                is_hidden: Some(false),
                category_id: None,
                tag_ids: Some(Vec::new()),
            },
        )
        .await?;
        assert_eq!(
            (updated.merchant_name, updated.notes, updated.is_recurring),
            (None, None, false)
        );
        assert!(transaction_by_id(&pool, created.id).await?.is_some());
        assert!(delete_transaction(&pool, created.id).await?);
        assert!(!delete_transaction(&pool, created.id).await?);
        assert_eq!(transaction_by_id(&pool, created.id).await?, None);
        assert!(
            update_transaction(
                &pool,
                created.id,
                &TransactionUpdates {
                    merchant_name: Some("Missing".into()),
                    notes: None,
                    is_recurring: None,
                    is_hidden: None,
                    category_id: None,
                    tag_ids: None,
                }
            )
            .await
            .is_err()
        );
        Ok(())
    }

    #[tokio::test]
    async fn pages_summarizes_exports_and_bulk_mutates_transactions() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        let account_id = account(&pool, "query-account").await?;
        let old = transaction(
            &pool,
            "old purchase",
            account_id,
            0,
            Cents(100),
            "2026-01-01T12:00:00Z".parse()?,
        )
        .await?;
        let new = transaction(
            &pool,
            "new purchase",
            account_id,
            0,
            Cents(300),
            "2026-01-02T12:00:00Z".parse()?,
        )
        .await?;
        let first = transactions(&pool, query(Some(1), None)).await?;
        assert_eq!((first.total_count, first.edges[0].node.id), (2, new));
        assert_eq!(
            transactions(
                &pool,
                TransactionQuery {
                    filter: Some(filter("new")),
                    sort: None,
                    first: None,
                    after: None,
                    last: None,
                    before: None,
                },
            )
            .await?
            .edges[0]
                .node
                .id,
            new
        );
        let cursor = first.page_info.end_cursor.clone();
        let second = transactions(&pool, query(Some(1), cursor.clone())).await?;
        assert_eq!(second.edges[0].node.id, old);
        let backward = transactions(
            &pool,
            TransactionQuery {
                filter: None,
                sort: None,
                first: None,
                after: None,
                last: Some(1),
                before: cursor,
            },
        )
        .await?;
        assert_eq!(backward.edges[0].node.id, old);
        let summary = transactions_summary(&pool, None).await?;
        assert_eq!(
            (
                summary.total_count,
                summary.total_amount,
                summary.average_amount,
                summary.largest_amount
            ),
            (2, Cents(400), Cents(200), Cents(300))
        );
        let (exported, cursor) = export_transaction_page(&pool, None, None, 1).await?;
        assert_eq!(exported[0].transaction.id, new);
        assert_eq!(
            export_transaction_page(&pool, None, cursor, 1).await?.0[0]
                .transaction
                .id,
            old
        );

        let ids = [GlobalId::new(GlobalIdType::Transaction, new)];
        let updated = bulk_update_transactions(
            &pool,
            Some(&ids),
            None,
            Some(&TransactionUpdates {
                merchant_name: None,
                notes: None,
                is_recurring: Some(true),
                is_hidden: Some(true),
                category_id: None,
                tag_ids: None,
            }),
        )
        .await?;
        assert_eq!(
            (updated[0].id, updated[0].is_recurring, updated[0].is_hidden),
            (new, true, true)
        );
        assert_eq!(bulk_delete_transactions(&pool, None, Some(&filter("old"))).await?, 1);
        assert!(bulk_update_transactions(&pool, Some(&ids), None, None).await.is_err());
        Ok(())
    }

    #[tokio::test]
    async fn aggregate_queries_keep_owner_and_category_kind_indexes() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        crate::database::dbtest::assert_query_plan_omits(
            &pool,
            "SELECT COUNT(t.id) FROM transactions t WHERE t.staged_for_llm = 0",
            &["SEARCH a", "SEARCH c", "SEARCH cg"],
        )
        .await?;
        crate::database::dbtest::assert_query_plan_uses(
            &pool,
            "SELECT COUNT(t.id) FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.staged_for_llm = 0 AND a.owner_id IN (1)",
            &["idx_accounts_owner"],
        )
        .await?;
        crate::database::dbtest::assert_query_plan_uses(
            &pool,
            "SELECT COUNT(t.id) FROM transactions t JOIN category_rows cr ON cr.cat_id = t.category_id WHERE t.staged_for_llm = 0 AND cr.group_kind NOT IN ('INCOME')",
            &["SEARCH c", "SEARCH cg"],
        )
        .await?;
        Ok(())
    }
}
