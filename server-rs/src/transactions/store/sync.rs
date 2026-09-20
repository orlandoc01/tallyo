use anyhow::{Result, anyhow};
use sqlx::SqliteConnection;

use crate::{
    accounts::store::account_by_external_id,
    database::queries,
    transactions::{SyncedTransaction, TransactionSource},
};

use super::{auto_categorize::auto_categorization_result_with_plaid_category, categories::UNCATEGORIZED_CATEGORY_ID};

pub(crate) async fn upsert_synced_transaction(
    executor: &mut SqliteConnection,
    transaction: &SyncedTransaction,
) -> Result<bool> {
    let account = account_by_external_id(&mut *executor, &transaction.account_id)
        .await?
        .ok_or_else(|| anyhow!("account {} not found", transaction.account_id))?;
    let source = transaction.source.to_string();
    let state = queries::synced_transaction_state_opt(
        &mut *executor,
        queries::SyncedTransactionStateParams {
            external_id: &transaction.external_id,
            source: &source,
        },
    )
    .await?;
    let category = auto_categorization_result_with_plaid_category(
        &mut *executor,
        transaction.merchant_name.as_deref(),
        transaction.original_name.as_deref(),
        transaction.amount,
        account.id,
        transaction.plaid_category.as_deref(),
    )
    .await?;
    let result = category_result(state, category);
    let merchant_name = result.merchant_name.as_deref().or(transaction.merchant_name.as_deref());
    let transaction_id = queries::upsert_synced_transaction(
        &mut *executor,
        queries::UpsertSyncedTransactionParams {
            external_id: &transaction.external_id,
            account_id: account.id,
            amount_cents: transaction.amount,
            datetime: transaction.datetime.into(),
            posted_datetime: transaction.posted_datetime.into(),
            merchant_name,
            original_name: transaction.original_name.as_deref(),
            logo_url: transaction.logo_url.as_deref(),
            category_id: result.category_id,
            is_reviewed: result.is_reviewed,
            plaid_category: transaction.plaid_category.as_deref(),
            raw_provider_json: transaction.raw_provider_json.as_deref(),
            source: &source,
            pending: transaction.pending,
            is_recurring: result.should_be_recurring.unwrap_or(false),
            is_hidden: transaction.hidden_by_account || result.should_hide.unwrap_or(false),
            staged_for_llm: transaction.stage_for_llm && result.staged_for_llm,
            pfc_2_categorized: result.pfc_2_categorized,
        },
    )
    .await?
    .id;
    if !result.tag_ids.is_empty() {
        queries::add_transaction_tags_by_transaction_ids(
            &mut *executor,
            queries::AddTransactionTagsByTransactionIDsParams {
                tag_ids: &result.tag_ids,
                transaction_ids: &[transaction_id],
            },
        )
        .await?;
    }
    Ok(result.new_record)
}

pub(crate) async fn delete_synced_transaction(
    executor: &mut SqliteConnection,
    source: TransactionSource,
    external_id: &str,
) -> Result<()> {
    queries::delete_synced_transaction(
        executor,
        queries::DeleteSyncedTransactionParams {
            source: &source.to_string(),
            external_id,
        },
    )
    .await
    .map(|_| ())
    .map_err(Into::into)
}

struct SyncedCategoryResult {
    new_record: bool,
    category_id: i64,
    merchant_name: Option<String>,
    is_reviewed: bool,
    staged_for_llm: bool,
    pfc_2_categorized: bool,
    tag_ids: Vec<i64>,
    should_hide: Option<bool>,
    should_be_recurring: Option<bool>,
}

fn category_result(
    state: Option<queries::SyncedTransactionStateRow>,
    category: super::auto_categorize::AutoCategoryResult,
) -> SyncedCategoryResult {
    match state {
        Some(state) if state.is_reviewed => SyncedCategoryResult {
            new_record: false,
            category_id: state.category_id,
            merchant_name: category.merchant_name,
            is_reviewed: true,
            staged_for_llm: false,
            pfc_2_categorized: false,
            tag_ids: Vec::new(),
            should_hide: None,
            should_be_recurring: None,
        },
        state => {
            let reviewed = category.category_id.is_some();
            SyncedCategoryResult {
                new_record: state.is_none(),
                category_id: category.category_id.unwrap_or(UNCATEGORIZED_CATEGORY_ID),
                merchant_name: category.merchant_name,
                is_reviewed: reviewed,
                staged_for_llm: category.category_id.is_none() || category.from_pfc2,
                pfc_2_categorized: category.from_pfc2,
                tag_ids: category.tag_ids,
                should_hide: category.should_hide,
                should_be_recurring: category.should_be_recurring,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use chrono::DateTime;

    use super::*;
    use crate::{
        accounts::{AccountType, UpsertAccount, store::upsert_account},
        database::dbtest,
        money::Cents,
        testutil::store::create_owner,
    };

    fn transaction(category: Option<&str>) -> SyncedTransaction {
        SyncedTransaction {
            external_id: "transaction".to_owned(),
            account_id: "account".to_owned(),
            amount: Cents(1234),
            datetime: "2026-09-06T12:00:00Z".parse::<DateTime<chrono::Utc>>().unwrap(),
            posted_datetime: "2026-09-06T12:00:00Z".parse().unwrap(),
            merchant_name: Some("Grocery".to_owned()),
            original_name: Some("Grocery".to_owned()),
            logo_url: None,
            plaid_category: category.map(ToOwned::to_owned),
            raw_provider_json: Some("{}".to_owned()),
            source: TransactionSource::Plaid,
            pending: false,
            hidden_by_account: false,
            stage_for_llm: true,
        }
    }

    #[tokio::test]
    async fn applies_pfc2_then_preserves_reviewed_transactions() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "Alex").await?;
        upsert_account(
            &pool,
            &UpsertAccount {
                external_id: "account".to_owned(),
                connection_id: None,
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
        let code = queries::list_categories(&pool, queries::ListCategoriesParams::default())
            .await?
            .into_iter()
            .find_map(|row| {
                row.plaid_pfc_2_codes
                    .split(',')
                    .find(|code| !code.is_empty())
                    .map(|code| (row.cat_id, code.to_owned()))
            })
            .expect("seeded PFC2 category");
        let mut connection = pool.acquire().await?;
        assert!(upsert_synced_transaction(&mut connection, &transaction(Some(&format!("PRIMARY:{}", code.1)))).await?);
        let row = queries::synced_transaction_state(
            &mut *connection,
            queries::SyncedTransactionStateParams {
                external_id: "transaction",
                source: "plaid",
            },
        )
        .await?;
        assert_eq!(row.category_id, code.0);
        assert!(row.is_reviewed);

        let mut reviewed = transaction(None);
        reviewed.amount = Cents(4321);
        assert!(!upsert_synced_transaction(&mut connection, &reviewed).await?);
        assert_eq!(
            queries::synced_transaction_state(
                &mut *connection,
                queries::SyncedTransactionStateParams {
                    external_id: "transaction",
                    source: "plaid",
                }
            )
            .await?
            .category_id,
            code.0
        );
        Ok(())
    }
}
