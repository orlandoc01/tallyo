use anyhow::{Context as _, Result as AnyResult, ensure};
use async_graphql::{Context, Result};

use super::{
    Resolver,
    ids::{decode, local_id, validate_ids, validate_optional_id},
    load,
    loaders::{RuleAccountsKey, RuleTagsKey, TransactionTagsKey},
    rules::validate_transaction_update_id_types,
};
use crate::{
    accounts::Account,
    apierror::ApiError,
    ids::{GlobalId, GlobalIdType, local_ids_of_type},
    schema::{
        BulkDeleteTransactionsInput, BulkDeleteTransactionsPayload, BulkUpdateTransactionsInput,
        BulkUpdateTransactionsPayload, CreateTransactionInput, CreateTransactionPayload, DeleteTransactionPayload,
        ReprocessUncategorizedTransactionsPayload, RuleResolvers, TransactionResolvers, TransactionsFilter,
        TransactionsInput, TransactionsStagedForCategorization, TransactionsSummary, UpdateTransactionInput,
        UpdateTransactionPayload,
    },
    transactions::{
        Rule, Tag, Transaction, TransactionConnection, TransactionQuery, store, types::MAX_TRANSACTION_LIMIT,
    },
};

impl RuleResolvers for Rule {
    async fn tags(&self, ctx: &Context<'_>) -> Result<Option<Vec<Tag>>> {
        Ok(Some(load(ctx, RuleTagsKey(self.id)).await?.unwrap_or_default()))
    }

    async fn accounts(&self, ctx: &Context<'_>) -> Result<Option<Vec<Account>>> {
        Ok(Some(load(ctx, RuleAccountsKey(self.id)).await?.unwrap_or_default()))
    }
}

impl TransactionResolvers for Transaction {
    async fn tags(&self, ctx: &Context<'_>) -> Result<Vec<Tag>> {
        Ok(load(ctx, TransactionTagsKey(self.id)).await?.unwrap_or_default())
    }
}

impl Resolver {
    pub async fn transactions(&self, input: Option<TransactionsInput>) -> AnyResult<TransactionConnection> {
        let query = transaction_query_from_input(input)?;
        store::transactions(&self.pool, query).await
    }

    pub async fn transaction(&self, id: &async_graphql::ID) -> AnyResult<Option<Transaction>> {
        let transaction_id = local_id(id, GlobalIdType::Transaction)?;
        store::transaction_by_id(&self.pool, transaction_id).await
    }

    pub async fn transactions_summary(&self, filter: Option<TransactionsFilter>) -> AnyResult<TransactionsSummary> {
        validate_transactions_filter_id_types(filter.as_ref())?;
        store::transactions_summary(&self.pool, filter.as_ref()).await
    }

    pub async fn transactions_staged_for_categorization(&self) -> AnyResult<TransactionsStagedForCategorization> {
        let count = store::llm_store::count_staged(&self.pool)
            .await
            .context("count transactions staged for categorization")?;
        Ok(TransactionsStagedForCategorization { count: count as i32 })
    }

    pub async fn reprocess_uncategorized_transactions(&self) -> AnyResult<ReprocessUncategorizedTransactionsPayload> {
        let staged = self
            .syncer
            .reprocess_uncategorized()
            .await
            .context("stage uncategorized for llm")?;
        Ok(ReprocessUncategorizedTransactionsPayload {
            staged_count: staged as i32,
        })
    }

    pub async fn bulk_update_transactions(
        &self,
        input: BulkUpdateTransactionsInput,
    ) -> AnyResult<BulkUpdateTransactionsPayload> {
        let transaction_ids = decode_ids(input.transaction_ids.as_deref(), GlobalIdType::Transaction)?;
        validate_transactions_filter_id_types(input.filter.as_ref())?;
        validate_transaction_update_id_types(&input.updates)?;
        let transactions = store::bulk_update_transactions(
            &self.pool,
            transaction_ids.as_deref(),
            input.filter.as_ref(),
            Some(&input.updates),
        )
        .await?;
        Ok(BulkUpdateTransactionsPayload {
            updated_count: transactions.len() as i32,
            transactions,
        })
    }

    pub async fn update_transaction(&self, input: UpdateTransactionInput) -> AnyResult<UpdateTransactionPayload> {
        let transaction_id = local_id(&input.id, GlobalIdType::Transaction)?;
        validate_transaction_update_id_types(&input.updates)?;
        let transaction = store::update_transaction(&self.pool, transaction_id, &input.updates).await?;
        Ok(UpdateTransactionPayload { transaction })
    }

    pub async fn delete_transaction(&self, id: &async_graphql::ID) -> AnyResult<DeleteTransactionPayload> {
        let transaction_id = local_id(id, GlobalIdType::Transaction)?;
        Ok(DeleteTransactionPayload {
            success: store::delete_transaction(&self.pool, transaction_id).await?,
        })
    }

    pub async fn bulk_delete_transactions(
        &self,
        input: BulkDeleteTransactionsInput,
    ) -> AnyResult<BulkDeleteTransactionsPayload> {
        let transaction_ids = decode_ids(input.transaction_ids.as_deref(), GlobalIdType::Transaction)?;
        validate_transactions_filter_id_types(input.filter.as_ref())?;
        let deleted =
            store::bulk_delete_transactions(&self.pool, transaction_ids.as_deref(), input.filter.as_ref()).await?;
        Ok(BulkDeleteTransactionsPayload {
            deleted_count: deleted as i32,
        })
    }

    pub async fn create_transaction(&self, input: CreateTransactionInput) -> AnyResult<CreateTransactionPayload> {
        local_id(&input.account_id, GlobalIdType::Account)?;
        validate_optional_id(input.category_id.as_ref(), GlobalIdType::Category)?;
        let transaction = store::create_transaction(&self.pool, input).await?;
        Ok(CreateTransactionPayload { transaction })
    }
}

fn decode_ids(ids: Option<&[async_graphql::ID]>, expected: GlobalIdType) -> AnyResult<Option<Vec<GlobalId>>> {
    let Some(ids) = ids else {
        return Ok(None);
    };
    let decoded = ids.iter().map(decode).collect::<AnyResult<Vec<_>>>()?;
    local_ids_of_type(&decoded, expected)?;
    Ok(Some(decoded))
}

pub(super) fn validate_transactions_filter_id_types(filter: Option<&TransactionsFilter>) -> AnyResult<()> {
    let Some(filter) = filter else {
        return Ok(());
    };
    validate_filter_id_types(
        filter.category_ids.as_deref(),
        filter.account_ids.as_deref(),
        filter.owner_ids.as_deref(),
        filter.tag_ids.as_deref(),
    )
}

pub(super) fn validate_filter_id_types(
    category_ids: Option<&[async_graphql::ID]>,
    account_ids: Option<&[async_graphql::ID]>,
    owner_ids: Option<&[async_graphql::ID]>,
    tag_ids: Option<&[async_graphql::ID]>,
) -> AnyResult<()> {
    validate_ids(category_ids, GlobalIdType::Category)?;
    validate_ids(account_ids, GlobalIdType::Account)?;
    validate_ids(owner_ids, GlobalIdType::Owner)?;
    validate_ids(tag_ids, GlobalIdType::Tag)
}

fn transaction_query_from_input(input: Option<TransactionsInput>) -> AnyResult<TransactionQuery> {
    let Some(input) = input else {
        return Ok(TransactionQuery::default());
    };
    validate_transactions_filter_id_types(input.filter.as_ref())?;
    let query = TransactionQuery {
        filter: input.filter,
        sort: input.sort,
        first: input.first,
        after: input.after,
        last: input.last,
        before: input.before,
    };
    validate_transaction_page_args(&query)?;
    Ok(query)
}

fn validate_transaction_page_args(query: &TransactionQuery) -> AnyResult<()> {
    ensure!(
        query.first.is_none() || query.last.is_none(),
        ApiError::bad_input("cannot supply both first and last")
    );
    ensure!(
        query.after.is_none() || query.before.is_none(),
        ApiError::bad_input("cannot supply both after and before")
    );
    validate_page_size("first", query.first)?;
    validate_page_size("last", query.last)
}

fn validate_page_size(name: &str, size: Option<i32>) -> AnyResult<()> {
    let Some(size) = size else {
        return Ok(());
    };
    ensure!(size > 0, ApiError::bad_input(format!("{name} must be positive")));
    ensure!(
        size <= MAX_TRANSACTION_LIMIT,
        ApiError::bad_input(format!("{name} must not exceed {MAX_TRANSACTION_LIMIT}"))
    );
    Ok(())
}
