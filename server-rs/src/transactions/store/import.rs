use std::collections::HashMap;

use anyhow::Result;
use rand::Rng;
use sqlx::SqlitePool;

use crate::{
    database::{self, queries},
    ids::{GlobalId, GlobalIdType},
    transactions::{ImportResult, ImportRow, ImportRowError},
};

use super::{
    auto_categorize::{AutoCategoryResult, auto_categorization_result},
    categories::UNCATEGORIZED_CATEGORY_ID,
};

pub async fn import_transactions(pool: &SqlitePool, rows: &[ImportRow]) -> Result<ImportResult> {
    let (accounts, categories) = tokio::try_join!(resolve_accounts(pool, rows), category_ids_by_name(pool))?;
    let rows = rows.to_vec();
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let mut result = ImportResult {
                errors: Vec::new(),
                ..Default::default()
            };
            for (index, row) in rows.iter().enumerate() {
                let row_num = if row.row_num == 0 { index + 1 } else { row.row_num };
                let Some(account_id) = accounts.get(&row.account_id) else {
                    result.skipped += 1;
                    result.errors.push(ImportRowError {
                        row: row_num,
                        message: format!("account_id {:?} not found", row.account_id),
                    });
                    continue;
                };
                upsert_import_row(transaction, row, *account_id, &categories).await?;
                result.processed += 1;
            }
            Ok(result)
        })
    })
    .await
}

async fn resolve_accounts(pool: &SqlitePool, rows: &[ImportRow]) -> Result<HashMap<String, i64>> {
    let mut global_ids = Vec::new();
    let mut external_ids = Vec::new();
    for input_id in rows.iter().map(|row| &row.account_id) {
        match GlobalId::decode(input_id) {
            Ok(id) => global_ids.push((input_id.clone(), id.i64_of_type(GlobalIdType::Account)?)),
            Err(_) => external_ids.push(input_id.clone()),
        }
    }
    global_ids.sort_unstable_by_key(|(_, id)| *id);
    global_ids.dedup_by_key(|(_, id)| *id);
    external_ids.sort_unstable();
    external_ids.dedup();
    let local_ids = global_ids.iter().map(|(_, id)| *id).collect::<Vec<_>>();
    let (global_rows, external_rows) = tokio::try_join!(
        queries::account_records(
            pool,
            queries::AccountRecordsParams {
                ids: (!local_ids.is_empty()).then_some(&local_ids),
                ..Default::default()
            }
        ),
        queries::account_records(
            pool,
            queries::AccountRecordsParams {
                external_ids: (!external_ids.is_empty()).then_some(&external_ids),
                ..Default::default()
            }
        )
    )?;
    let account_ids = global_rows
        .into_iter()
        .map(|row| row.accounts.id)
        .collect::<std::collections::HashSet<_>>();
    let mut result = global_ids
        .into_iter()
        .filter(|(_, id)| account_ids.contains(id))
        .collect::<HashMap<_, _>>();
    result.extend(
        external_rows
            .into_iter()
            .map(|row| (row.accounts.external_id, row.accounts.id)),
    );
    Ok(result)
}

async fn category_ids_by_name(pool: &SqlitePool) -> Result<HashMap<String, i64>> {
    queries::list_categories(pool, queries::ListCategoriesParams::default())
        .await
        .map(|rows| {
            rows.into_iter()
                .map(|row| (row.cat_name.to_ascii_lowercase(), row.cat_id))
                .collect()
        })
        .map_err(Into::into)
}

async fn upsert_import_row(
    executor: &mut sqlx::SqliteConnection,
    row: &ImportRow,
    account_id: i64,
    categories: &HashMap<String, i64>,
) -> Result<()> {
    let source = source(&row.source);
    let external_id = external_id(&row.external_id);
    let AutoCategoryResult {
        category_id,
        merchant_name,
        tag_ids,
        should_hide,
        should_be_recurring,
        ..
    } = resolve_import_categorization(executor, row, account_id, categories).await?;
    // Rule renames apply to synced transactions, not imported CSV rows.
    let _ = merchant_name;
    let is_reviewed = category_id.is_some();
    let category_id = category_id.unwrap_or(UNCATEGORIZED_CATEGORY_ID);
    let is_hidden = row.is_hidden || should_hide.unwrap_or(false);
    let is_recurring = should_be_recurring.unwrap_or(row.is_recurring);
    let merchant_name = non_empty(&row.merchant_name);
    let original_name = non_empty(&row.original_name);
    let notes = non_empty(&row.notes);
    let insert = queries::InsertTransactionParams {
        source: &source,
        external_id: &external_id,
        account_id,
        amount_cents: row.amount,
        datetime: row.datetime.into(),
        posted_datetime: row.posted_datetime.into(),
        merchant_name,
        original_name,
        category_id,
        is_reviewed,
        is_recurring,
        is_hidden,
        notes,
    };
    let transaction_id = match queries::insert_transaction_opt(&mut *executor, insert).await? {
        Some(row) => row.id,
        None => {
            queries::update_transaction_by_source_external_id(
                &mut *executor,
                queries::UpdateTransactionBySourceExternalIdParams {
                    account_id,
                    amount_cents: row.amount,
                    datetime: row.datetime.into(),
                    posted_datetime: row.posted_datetime.into(),
                    merchant_name,
                    original_name,
                    category_id,
                    is_reviewed,
                    is_recurring,
                    is_hidden,
                    notes,
                    source: &source,
                    external_id: &external_id,
                },
            )
            .await?
            .id
        }
    };
    if !tag_ids.is_empty() {
        queries::add_transaction_tags_by_transaction_ids(
            &mut *executor,
            queries::AddTransactionTagsByTransactionIDsParams {
                tag_ids: &tag_ids,
                transaction_ids: &[transaction_id],
            },
        )
        .await?;
    }
    Ok(())
}

async fn resolve_import_categorization(
    executor: &mut sqlx::SqliteConnection,
    row: &ImportRow,
    account_id: i64,
    categories: &HashMap<String, i64>,
) -> Result<AutoCategoryResult> {
    if let Some(category_id) = categories.get(&row.category.to_ascii_lowercase()) {
        return Ok(AutoCategoryResult {
            category_id: Some(*category_id),
            ..Default::default()
        });
    }
    auto_categorization_result(
        &mut *executor,
        non_empty(&row.merchant_name),
        non_empty(&row.original_name),
        row.amount,
        account_id,
    )
    .await
}

fn external_id(value: &str) -> String {
    if value.trim().is_empty() {
        format!("import-{:024x}", rand::rng().random::<u128>())
    } else {
        value.trim().to_owned()
    }
}

fn source(value: &str) -> String {
    if value.trim().is_empty() { "manual".to_owned() } else { value.trim().to_owned() }
}

fn non_empty(value: &str) -> Option<&str> {
    (!value.is_empty()).then_some(value)
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use async_graphql::ID;

    use super::*;
    use crate::{
        database::dbtest,
        ids::{GlobalId, GlobalIdType},
        money::Cents,
        schema::{CategoryKind, CreateRuleInput, TransactionUpdates},
        testutil::store::{create_owner, seed_plaid_account, seed_plaid_item},
        transactions::TransactionQuery,
    };

    #[tokio::test]
    async fn imports_matched_rule_category_tags_and_flags() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "Alex").await?;
        let (_, connection) = seed_plaid_item(&pool, &owner, "item").await?;
        let account_id = seed_plaid_account(&pool, &owner, &connection, "checking").await?;
        let group = super::super::create_category_group(&pool, "Food", "*", CategoryKind::Expense).await?;
        let category = super::super::create_category(&pool, "Coffee", "*", group.id).await?;
        let tag = super::super::create_tag(&pool, "Morning", "#AABBCC").await?;
        super::super::create_rule(
            &pool,
            CreateRuleInput {
                merchant_pattern: Some("coffee".into()),
                original_pattern: None,
                changes: TransactionUpdates {
                    merchant_name: None,
                    notes: None,
                    is_recurring: Some(true),
                    is_hidden: Some(true),
                    category_id: Some(ID::from(
                        GlobalId::new(GlobalIdType::Category, category.id).encoded_string(),
                    )),
                    tag_ids: Some(vec![ID::from(
                        GlobalId::new(GlobalIdType::Tag, tag.id).encoded_string(),
                    )]),
                },
                account_ids: None,
                amount_min: None,
                amount_max: None,
                priority: None,
                apply_retroactively: None,
            },
        )
        .await?;

        import_transactions(
            &pool,
            &[ImportRow {
                row_num: 1,
                external_id: "coffee-1".into(),
                source: "manual".into(),
                account_id: "checking".into(),
                datetime: "2026-01-01T12:00:00Z".parse()?,
                posted_datetime: "2026-01-01T12:00:00Z".parse()?,
                amount: Cents(250),
                merchant_name: "Coffee Shop".into(),
                original_name: String::new(),
                category: String::new(),
                notes: String::new(),
                is_recurring: false,
                is_hidden: false,
            }],
        )
        .await?;

        let transaction = super::super::transactions(
            &pool,
            TransactionQuery {
                filter: None,
                sort: None,
                first: None,
                after: None,
                last: None,
                before: None,
            },
        )
        .await?
        .edges
        .pop()
        .expect("imported transaction")
        .node;
        assert_eq!(transaction.category.id, category.id);
        assert!(transaction.is_reviewed && transaction.is_recurring && transaction.is_hidden);
        let tags = super::super::tags_by_transaction_ids(&pool, &[transaction.id]).await?;
        assert_eq!(tags[&transaction.id][0].id, tag.id);
        assert_eq!(transaction.account.id, account_id);
        Ok(())
    }

    #[tokio::test]
    async fn imports_global_account_ids_and_updates_duplicate_external_ids() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "Import owner").await?;
        let (_, connection) = seed_plaid_item(&pool, &owner, "import-item").await?;
        let account_id = seed_plaid_account(&pool, &owner, &connection, "import-checking").await?;
        let account_id = GlobalId::new(GlobalIdType::Account, account_id).encoded_string();
        let row = ImportRow {
            row_num: 1,
            external_id: "import-id".into(),
            source: "manual".into(),
            account_id,
            datetime: "2026-01-01T12:00:00Z".parse()?,
            posted_datetime: "2026-01-01T12:00:00Z".parse()?,
            amount: Cents(100),
            merchant_name: "Coffee".into(),
            original_name: String::new(),
            category: String::new(),
            notes: String::new(),
            is_recurring: false,
            is_hidden: false,
        };
        assert_eq!(
            import_transactions(&pool, std::slice::from_ref(&row)).await?.processed,
            1
        );
        let result = import_transactions(
            &pool,
            &[
                ImportRow {
                    amount: Cents(250),
                    ..row.clone()
                },
                ImportRow {
                    row_num: 2,
                    account_id: "missing".into(),
                    ..row
                },
            ],
        )
        .await?;
        assert_eq!((result.processed, result.skipped, result.errors[0].row), (1, 1, 2));
        assert_eq!(
            super::super::transactions(
                &pool,
                TransactionQuery {
                    filter: None,
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
                .amount,
            Cents(250)
        );
        Ok(())
    }
}
