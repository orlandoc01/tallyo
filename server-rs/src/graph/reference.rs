use anyhow::{Context, Result, ensure};

use super::{Resolver, ids::local_id};
use crate::{
    accounts::{AccountType, AccountUpdate, CreateManualAccount, Owner, store as accounts},
    apierror::ApiError,
    clients::debank::DEBANK_CHAINS,
    ids::GlobalIdType,
    pfc2,
    schema::{
        AccountList, CategoryGroupList, CategoryList, CreateManualAccountInput, CreateManualAccountPayload,
        CreateOwnerInput, EvmChain, EvmChainList, OwnerList, RecurringChargeList, RemoveManualAccountInput,
        RemoveManualAccountPayload, UpdateAccountInput, UpdateAccountPayload,
    },
    transactions::store as transactions,
    wealth::{RealEstateDetails, SnapshotPersister, UpdateRealEstate, store as wealth},
};

impl Resolver {
    pub async fn categories(&self) -> Result<CategoryList> {
        Ok(CategoryList {
            items: transactions::categories(&self.pool).await?,
        })
    }

    pub async fn category_groups(&self) -> Result<CategoryGroupList> {
        Ok(CategoryGroupList {
            items: transactions::category_groups(&self.pool).await?,
        })
    }

    pub fn plaid_pfc2_codes(&self) -> Vec<String> {
        pfc2::codes().to_vec()
    }

    pub async fn accounts(&self) -> Result<AccountList> {
        Ok(AccountList {
            items: accounts::accounts(&self.pool).await?,
        })
    }

    pub async fn recurring_charges(&self) -> Result<RecurringChargeList> {
        Ok(RecurringChargeList {
            items: transactions::recurring_charges(&self.pool).await?,
        })
    }

    pub fn evm_chains(&self) -> EvmChainList {
        EvmChainList {
            items: DEBANK_CHAINS
                .iter()
                .map(|chain| EvmChain {
                    id: chain.id.clone(),
                    name: chain.name.clone(),
                })
                .collect(),
        }
    }

    pub async fn owners(&self) -> Result<OwnerList> {
        Ok(OwnerList {
            items: accounts::owners(&self.pool).await?,
        })
    }

    pub async fn create_owner(&self, input: CreateOwnerInput) -> Result<Owner> {
        accounts::create_owner(&self.pool, &input.name).await
    }

    pub async fn delete_owner(&self, id: &async_graphql::ID) -> Result<bool> {
        let owner_id = local_id(id, GlobalIdType::Owner)?;
        accounts::delete_owner(&self.pool, owner_id)
            .await
            .context("delete owner")
    }

    pub async fn create_manual_account(&self, input: CreateManualAccountInput) -> Result<CreateManualAccountPayload> {
        let owner_id = local_id(&input.owner_id, GlobalIdType::Owner)?;
        let connection_id = input
            .connection_id
            .as_ref()
            .map(|id| local_id(id, GlobalIdType::Connection))
            .transpose()?;
        ensure!(
            input.r#type != AccountType::Property,
            ApiError::bad_input("real estate accounts must be created via linkRealEstate")
        );
        let account = accounts::create_manual_account(
            &self.pool,
            CreateManualAccount {
                connection_id,
                name: input.name,
                owner_id,
                account_type: input.r#type,
                notes: input.notes,
                closed: input.closed,
                hidden: input.hidden,
            },
        )
        .await?;
        self.manual_snapshots
            .seed_initial_snapshot(account.id, &SnapshotPersister::new(self.pool.clone()))
            .await
            .context("seed initial snapshot")?;
        Ok(CreateManualAccountPayload { account })
    }

    pub async fn update_account(&self, input: UpdateAccountInput) -> Result<UpdateAccountPayload> {
        let account_id = local_id(&input.id, GlobalIdType::Account)?;
        let owner_id = input
            .owner_id
            .as_ref()
            .map(|id| local_id(id, GlobalIdType::Owner))
            .transpose()?;
        let name = input.name.clone();
        let account = accounts::update_account(
            &self.pool,
            account_id,
            AccountUpdate {
                name: input.name,
                owner_id,
                account_type: input.r#type,
                subtype: input.subtype,
                notes: input.notes,
                closed: input.closed,
                hidden: input.hidden,
            },
        )
        .await?;
        if let Some(name) = name.filter(|_| account.r#type == AccountType::Property) {
            self.sync_real_estate_name(account_id, name).await?;
        }
        Ok(UpdateAccountPayload { account })
    }

    async fn sync_real_estate_name(&self, account_id: i64, name: String) -> Result<()> {
        let Some(connection_id) = accounts::accounts_by_ids(&self.pool, &[account_id])
            .await?
            .remove(&account_id)
            .and_then(|record| record.connection_id)
        else {
            return Ok(());
        };
        wealth::update_real_estate(
            &self.pool,
            UpdateRealEstate {
                connection_id,
                name: Some(name),
                details: RealEstateDetails::default(),
                valuation: None,
            },
        )
        .await
        .context("sync real estate name")
        .map(drop)
    }

    pub async fn remove_manual_account(&self, input: RemoveManualAccountInput) -> Result<RemoveManualAccountPayload> {
        let account_id = local_id(&input.id, GlobalIdType::Account)?;
        accounts::remove_manual_account(&self.pool, account_id).await?;
        Ok(RemoveManualAccountPayload { success: true })
    }
}
