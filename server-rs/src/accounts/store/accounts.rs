use std::collections::{HashMap, HashSet};

use anyhow::{Context, Result, anyhow};
use sha2::{Digest, Sha256};
use sqlx::{Executor, Sqlite, SqlitePool};

use crate::{
    accounts::{Account, AccountRecord, AccountType, AccountUpdate, CreateManualAccount, SourceTable, UpsertAccount},
    apierror::ApiError,
    database::{self, queries},
};

use super::{connection_by_id, owner_by_id, subtypes::is_valid_subtype_for_type};

pub async fn accounts(executor: impl Executor<'_, Database = Sqlite>) -> Result<Vec<Account>> {
    queries::account_records(executor, queries::AccountRecordsParams::default())
        .await
        .map(|rows| rows.into_iter().map(Into::into).collect())
        .map_err(Into::into)
}

pub async fn accounts_by_item(executor: impl Executor<'_, Database = Sqlite>, item_id: i64) -> Result<Vec<Account>> {
    queries::account_records(
        executor,
        queries::AccountRecordsParams {
            item_id: Some(item_id),
            ..Default::default()
        },
    )
    .await
    .map(|rows| rows.into_iter().map(Into::into).collect())
    .map_err(Into::into)
}

pub async fn syncable_account_external_ids_by_item(
    executor: impl Executor<'_, Database = Sqlite>,
    item_id: i64,
) -> Result<Vec<String>> {
    queries::account_records(
        executor,
        queries::AccountRecordsParams {
            item_id: Some(item_id),
            ..Default::default()
        },
    )
    .await
    .map(|rows| {
        rows.into_iter()
            .filter(|row| !row.accounts.manual && !row.accounts.is_closed)
            .map(|row| row.accounts.external_id)
            .collect()
    })
    .map_err(Into::into)
}

pub async fn account_by_id(executor: impl Executor<'_, Database = Sqlite>, id: i64) -> Result<Option<Account>> {
    queries::account_records(
        executor,
        queries::AccountRecordsParams {
            id: Some(id),
            ..Default::default()
        },
    )
    .await
    .map(|rows| rows.into_iter().next().map(Into::into))
    .map_err(Into::into)
}

pub async fn account_by_external_id(
    executor: impl Executor<'_, Database = Sqlite>,
    external_id: &str,
) -> Result<Option<Account>> {
    let external_ids = [external_id.to_owned()];
    queries::account_records(
        executor,
        queries::AccountRecordsParams {
            external_ids: Some(&external_ids),
            ..Default::default()
        },
    )
    .await
    .map(|rows| rows.into_iter().next().map(Into::into))
    .map_err(Into::into)
}

pub async fn accounts_by_ids(
    executor: impl Executor<'_, Database = Sqlite>,
    ids: &[i64],
) -> Result<HashMap<i64, AccountRecord>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    queries::account_records(
        executor,
        queries::AccountRecordsParams {
            ids: Some(ids),
            ..Default::default()
        },
    )
    .await
    .map(|rows| {
        rows.into_iter()
            .map(|row| {
                let record = AccountRecord::from(row);
                (record.account.id, record)
            })
            .collect()
    })
    .map_err(Into::into)
}

pub async fn accounts_by_items(
    executor: impl Executor<'_, Database = Sqlite>,
    item_ids: &[i64],
) -> Result<HashMap<i64, Vec<Account>>> {
    accounts_by_connection_sources(executor, SourceTable::PlaidItems, item_ids).await
}

pub async fn accounts_by_rule_ids(
    executor: impl Executor<'_, Database = Sqlite>,
    rule_ids: &[i64],
) -> Result<HashMap<i64, Vec<Account>>> {
    if rule_ids.is_empty() {
        return Ok(HashMap::new());
    }
    queries::accounts_by_rule_ids(executor, queries::AccountsByRuleIDsParams { rule_ids })
        .await
        .map(|rows| {
            rows.into_iter()
                .fold(HashMap::<i64, Vec<Account>>::new(), |mut grouped, row| {
                    grouped
                        .entry(row.rule_id)
                        .or_default()
                        .push((row.accounts, row.owner_name).into());
                    grouped
                })
        })
        .map_err(Into::into)
}

pub async fn accounts_by_connection_sources(
    executor: impl Executor<'_, Database = Sqlite>,
    source_table: SourceTable,
    source_ids: &[i64],
) -> Result<HashMap<i64, Vec<Account>>> {
    let source_table = source_table.to_string();
    queries::accounts_by_connection_sources(
        executor,
        queries::AccountsByConnectionSourcesParams {
            source_table: &source_table,
            source_ids,
        },
    )
    .await
    .map(|rows| {
        rows.into_iter()
            .fold(HashMap::<i64, Vec<Account>>::new(), |mut grouped, row| {
                grouped
                    .entry(row.source_id)
                    .or_default()
                    .push((row.accounts, row.owner_name).into());
                grouped
            })
    })
    .map_err(Into::into)
}

pub async fn upsert_account(executor: impl Executor<'_, Database = Sqlite>, account: &UpsertAccount) -> Result<i64> {
    let account_type = account.account_type.to_string();
    queries::upsert_account(
        executor,
        queries::UpsertAccountParams {
            external_id: &account.external_id,
            connection_id: account.connection_id,
            owner_id: account.owner_id,
            name: &account.name,
            r#type: &account_type,
            subtype: account.subtype.as_deref(),
            mask: account.mask.as_deref(),
            notes: account.notes.as_deref(),
            is_closed: account.closed,
            is_hidden: account.hidden,
            needs_review: account.needs_review,
        },
    )
    .await
    .map(|row| row.id)
    .map_err(Into::into)
}

pub async fn create_manual_account(pool: &SqlitePool, input: CreateManualAccount) -> Result<Account> {
    let owner = owner_by_id(pool, input.owner_id).await.context("lookup owner")?;
    if owner.is_none() {
        return Err(ApiError::bad_input(format!("unknown owner id {}", input.owner_id)).into());
    }
    if let Some(connection_id) = input.connection_id {
        let connection = connection_by_id(pool, connection_id)
            .await
            .context("lookup connection")?;
        if connection.is_none() {
            return Err(ApiError::bad_input(format!("connection {connection_id} not found")).into());
        }
    }

    let external_id = manual_account_id(input.connection_id, &input.name, input.owner_id);
    let notes = normalized_notes(input.notes.as_deref());
    let row = queries::insert_manual_account_opt(
        pool,
        queries::InsertManualAccountParams {
            external_id: &external_id,
            connection_id: input.connection_id,
            owner_id: input.owner_id,
            name: &input.name,
            r#type: &input.account_type.to_string(),
            notes: notes.as_deref(),
            is_closed: input.closed.unwrap_or(false),
            is_hidden: input.hidden.unwrap_or(false),
        },
    )
    .await
    .context("insert manual account")?;
    let id = match row {
        Some(row) => row.id,
        None => {
            account_by_external_id(pool, &external_id)
                .await?
                .ok_or_else(|| anyhow!("manual account {external_id} not found"))?
                .id
        }
    };
    account_by_id(pool, id)
        .await?
        .ok_or_else(|| anyhow!("account {id} not found"))
}

pub async fn update_account(pool: &SqlitePool, id: i64, update: AccountUpdate) -> Result<Account> {
    let params = account_update_params(pool, id, &update).await?;
    if !params.changed {
        return account_by_id(pool, id)
            .await?
            .ok_or_else(|| anyhow!("account {id} not found"));
    }
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let rows = queries::update_account_fields(&mut **transaction, params.query()).await?;
            if rows == 0 {
                return Err(ApiError::bad_input(format!("account {id} not found")).into());
            }
            if let Some(hidden) = params.hidden {
                queries::update_transactions_hidden_by_account(
                    &mut **transaction,
                    queries::UpdateTransactionsHiddenByAccountParams {
                        is_hidden: hidden,
                        account_id: id,
                    },
                )
                .await
                .context("update transactions hidden")?;
            }
            Ok(())
        })
    })
    .await?;
    account_by_id(pool, id)
        .await?
        .ok_or_else(|| anyhow!("account {id} not found"))
}

pub async fn remove_manual_account(pool: &SqlitePool, id: i64) -> Result<()> {
    let account = account_by_id(pool, id)
        .await
        .context("lookup account")?
        .ok_or_else(|| anyhow!("lookup account: account {id} not found"))?;
    if !account.manual {
        return Err(ApiError::bad_input(format!("account {id} is not manual")).into());
    }
    let rows = queries::delete_manual_account_by_id(pool, queries::DeleteManualAccountByIdParams { id })
        .await
        .context("delete manual account")?;
    if rows == 0 {
        return Err(ApiError::bad_input(format!("account {id} not found")).into());
    }
    Ok(())
}

pub async fn hidden_account_ids_by_connection(
    executor: impl Executor<'_, Database = Sqlite>,
    connection_id: i64,
) -> Result<HashSet<String>> {
    queries::hidden_account_ids_by_connection(
        executor,
        queries::HiddenAccountIDsByConnectionParams {
            connection_id: Some(connection_id),
        },
    )
    .await
    .map(|rows| rows.into_iter().map(|row| row.external_id).collect())
    .map_err(Into::into)
}

fn manual_account_id(connection_id: Option<i64>, name: &str, owner_id: i64) -> String {
    let key = connection_id.map_or_else(|| "manual".to_owned(), |id| id.to_string());
    let hash = Sha256::digest(format!("{key}|{name}|{owner_id}").as_bytes());
    format!("manual-{}", hex::encode(hash)[..12].to_owned())
}

fn normalized_notes(notes: Option<&str>) -> Option<String> {
    notes
        .map(str::trim)
        .filter(|notes| !notes.is_empty())
        .map(ToOwned::to_owned)
}

struct AccountUpdateParams {
    id: i64,
    name: Option<String>,
    owner_id: Option<i64>,
    account_type: Option<String>,
    subtype: Option<Option<String>>,
    notes: Option<Option<String>>,
    closed: Option<bool>,
    hidden: Option<bool>,
    changed: bool,
}

impl AccountUpdateParams {
    fn query(&self) -> queries::UpdateAccountFieldsParams<'_> {
        queries::UpdateAccountFieldsParams {
            set_name: self.name.is_some(),
            name: self.name.as_deref().unwrap_or_default(),
            set_owner: self.owner_id.is_some(),
            owner_id: self.owner_id,
            set_type: self.account_type.is_some(),
            r#type: self.account_type.as_deref().unwrap_or_default(),
            set_subtype: self.subtype.is_some(),
            subtype: self.subtype.as_ref().and_then(|subtype| subtype.as_deref()),
            set_notes: self.notes.is_some(),
            notes: self.notes.as_ref().and_then(|notes| notes.as_deref()),
            set_closed: self.closed.is_some(),
            is_closed: self.closed.unwrap_or(false),
            set_hidden: self.hidden.is_some(),
            is_hidden: self.hidden.unwrap_or(false),
            id: self.id,
        }
    }
}

async fn account_update_params(pool: &SqlitePool, id: i64, update: &AccountUpdate) -> Result<AccountUpdateParams> {
    if let Some(owner_id) = update.owner_id
        && owner_by_id(pool, owner_id).await.context("lookup owner")?.is_none()
    {
        return Err(anyhow!("unknown owner id {owner_id}"));
    }
    let current = if update.account_type.is_some() || update.subtype.is_some() {
        Some(
            account_by_id(pool, id)
                .await
                .context("lookup account")?
                .ok_or_else(|| anyhow!("account {id} not found"))?,
        )
    } else {
        None
    };
    if let (Some(next_type), Some(current)) = (update.account_type, current.as_ref()) {
        if next_type == AccountType::Property || current.r#type == AccountType::Property {
            return Err(
                ApiError::bad_input("real estate account type is managed by linkRealEstate/unlinkRealEstate").into(),
            );
        }
        if (next_type == AccountType::CryptoWallet || current.r#type == AccountType::CryptoWallet) && !current.manual {
            return Err(
                ApiError::bad_input("crypto wallet account type is managed by linkEVMWallet/unlinkEVMWallet").into(),
            );
        }
    }
    let subtype = update.subtype.as_deref().map(|subtype| {
        let subtype = subtype.trim();
        (!subtype.is_empty()).then(|| subtype.to_owned())
    });
    if let Some(Some(subtype)) = subtype.as_ref() {
        let account_type = update
            .account_type
            .or_else(|| current.as_ref().map(|account| account.r#type))
            .expect("subtype lookup loads account");
        if !is_valid_subtype_for_type(account_type, subtype) {
            return Err(ApiError::bad_input(format!(
                "subtype {subtype:?} is not valid for account type {account_type}"
            ))
            .into());
        }
    }
    Ok(AccountUpdateParams {
        id,
        name: update.name.clone(),
        owner_id: update.owner_id,
        account_type: update.account_type.map(|account_type| account_type.to_string()),
        subtype,
        notes: update.notes.as_deref().map(|notes| normalized_notes(Some(notes))),
        closed: update.closed,
        hidden: update.hidden,
        changed: update.name.is_some()
            || update.owner_id.is_some()
            || update.account_type.is_some()
            || update.subtype.is_some()
            || update.notes.is_some()
            || update.closed.is_some()
            || update.hidden.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use crate::{
        accounts::{AccountType, CreateManualAccount},
        database::dbtest,
        testutil::store::{create_owner, linked_account, seed_plaid_account, seed_plaid_item},
    };

    use super::{super::test_support::account_update, *};

    #[tokio::test]
    async fn needs_review_is_set_once_and_cleared_by_type_update() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "alex").await?;
        let (_, connection) = seed_plaid_item(&pool, &owner, "item").await?;
        let mut account = linked_account(&owner, connection.id, "review");
        account.needs_review = true;
        let id = upsert_account(&pool, &account).await?;
        account.needs_review = false;
        upsert_account(&pool, &account).await?;
        assert!(account_by_id(&pool, id).await?.unwrap().needs_review);

        update_account(&pool, id, account_update(Some(AccountType::Depository), None)).await?;
        assert!(!account_by_id(&pool, id).await?.unwrap().needs_review);
        Ok(())
    }

    #[tokio::test]
    async fn account_type_locks_reject_provider_managed_changes() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "alex").await?;
        let (_, connection) = seed_plaid_item(&pool, &owner, "item").await?;
        let account_id = seed_plaid_account(&pool, &owner, &connection, "checking").await?;
        assert!(
            update_account(&pool, account_id, account_update(Some(AccountType::Property), None))
                .await
                .is_err()
        );

        let property = create_manual_account(
            &pool,
            CreateManualAccount {
                connection_id: None,
                name: "Home".into(),
                owner_id: owner.id,
                account_type: AccountType::Property,
                notes: None,
                closed: None,
                hidden: None,
            },
        )
        .await?;
        assert!(
            update_account(&pool, property.id, account_update(Some(AccountType::Other), None))
                .await
                .is_err()
        );

        let mut wallet = linked_account(&owner, connection.id, "wallet");
        wallet.account_type = AccountType::CryptoWallet;
        let wallet_id = upsert_account(&pool, &wallet).await?;
        assert!(
            update_account(&pool, wallet_id, account_update(Some(AccountType::Other), None))
                .await
                .is_err()
        );

        let manual_wallet = create_manual_account(
            &pool,
            CreateManualAccount {
                connection_id: None,
                name: "Wallet".into(),
                owner_id: owner.id,
                account_type: AccountType::CryptoWallet,
                notes: None,
                closed: None,
                hidden: None,
            },
        )
        .await?;
        assert_eq!(
            update_account(&pool, manual_wallet.id, account_update(Some(AccountType::Other), None))
                .await?
                .r#type,
            AccountType::Other
        );
        Ok(())
    }

    #[tokio::test]
    async fn account_subtypes_must_match_the_effective_type() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "alex").await?;
        let (_, connection) = seed_plaid_item(&pool, &owner, "item").await?;
        let id = seed_plaid_account(&pool, &owner, &connection, "checking").await?;
        assert!(
            update_account(&pool, id, account_update(Some(AccountType::Credit), Some("checking")))
                .await
                .is_err()
        );

        assert_eq!(
            update_account(
                &pool,
                id,
                account_update(Some(AccountType::Credit), Some("credit card"))
            )
            .await?
            .subtype
            .as_deref(),
            Some("credit card")
        );
        assert_eq!(
            update_account(&pool, id, account_update(None, Some(""))).await?.subtype,
            None
        );
        Ok(())
    }

    #[tokio::test]
    async fn manual_accounts_are_idempotent_and_linked_accounts_cannot_be_removed() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "alex").await?;
        let input = CreateManualAccount {
            connection_id: None,
            name: "Cash".into(),
            owner_id: owner.id,
            account_type: AccountType::Depository,
            notes: None,
            closed: None,
            hidden: None,
        };
        let first = create_manual_account(&pool, input.clone()).await?;
        let second = create_manual_account(&pool, input).await?;
        assert_eq!(first.id, second.id);
        assert_eq!(accounts(&pool).await?.len(), 1);

        let (_, connection) = seed_plaid_item(&pool, &owner, "item").await?;
        let linked_id = seed_plaid_account(&pool, &owner, &connection, "checking").await?;
        assert!(remove_manual_account(&pool, linked_id).await.is_err());
        remove_manual_account(&pool, first.id).await?;
        Ok(())
    }

    #[tokio::test]
    async fn empty_batch_lookups_return_empty_maps() -> Result<()> {
        let pool = dbtest::open().await?;
        assert!(accounts_by_ids(&pool, &[]).await?.is_empty());
        assert!(accounts_by_items(&pool, &[]).await?.is_empty());
        Ok(())
    }
}
