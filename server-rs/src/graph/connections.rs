use anyhow::{Context, Result, anyhow};
use chrono::{DateTime, Utc};

use super::{Resolver, ids::local_id};
use crate::{
    accounts::{ConnectionUpdate, store},
    apierror::ApiError,
    ids::GlobalIdType,
    schema::{
        ConnectionList, ConnectionsInput, DeleteConnectionInput, DeleteConnectionPayload, LinkEvmWalletInput,
        LinkEvmWalletPayload, UpdateConnectionInput, UpdateConnectionPayload,
    },
    utils::cron::{next_after, validate_min_interval},
};

const CRONS_REQUIRED_TOGETHER: &str = "syncCron and recurringSyncCron are required together";

impl Resolver {
    pub async fn connections(&self, input: Option<ConnectionsInput>) -> Result<ConnectionList> {
        let include_inactive = input.is_some_and(|input| input.include_inactive.unwrap_or_default());
        Ok(ConnectionList {
            items: store::connections(&self.pool, include_inactive)
                .await?
                .into_iter()
                .map(|record| record.connection)
                .collect(),
        })
    }

    pub async fn update_connection(&self, input: UpdateConnectionInput) -> Result<UpdateConnectionPayload> {
        let connection_id = local_id(&input.connection_id, GlobalIdType::Connection)?;
        let next_syncs = next_sync_times(input.sync_cron.as_deref(), input.recurring_sync_cron.as_deref())?;
        let connection = store::update_connection(
            &self.pool,
            connection_id,
            ConnectionUpdate {
                is_active: input.is_active,
                sync_cron: input.sync_cron,
                recurring_sync_cron: input.recurring_sync_cron,
                next_sync_at: next_syncs.map(|times| times.sync),
                next_recurring_sync_at: next_syncs.map(|times| times.recurring),
                evm_chain_ids: input.chain_ids,
            },
        )
        .await?
        .ok_or_else(|| ApiError::bad_input(format!("connection {connection_id} not found")))?;
        Ok(UpdateConnectionPayload {
            connection: connection.connection,
        })
    }

    pub async fn delete_connection(&self, input: DeleteConnectionInput) -> Result<DeleteConnectionPayload> {
        let connection_id = local_id(&input.connection_id, GlobalIdType::Connection)?;
        Ok(DeleteConnectionPayload {
            success: store::delete_connection(&self.pool, connection_id).await?,
        })
    }

    pub async fn link_evm_wallet(&self, input: LinkEvmWalletInput) -> Result<LinkEvmWalletPayload> {
        let owner_id = local_id(&input.owner_id, GlobalIdType::Owner)?;
        self.linker
            .link_evm_wallet(
                &input.address,
                owner_id,
                input.label.as_deref().unwrap_or_default(),
                &input.chain_ids,
            )
            .await
    }

    pub async fn unlink_evm_wallet(&self, id: &async_graphql::ID) -> Result<bool> {
        let connection_id = local_id(id, GlobalIdType::Connection)?;
        store::delete_evm_wallet(&self.pool, connection_id)
            .await
            .context("unlink evm wallet")?;
        Ok(true)
    }
}

#[derive(Clone, Copy)]
struct NextSyncTimes {
    sync: DateTime<Utc>,
    recurring: DateTime<Utc>,
}

fn next_sync_times(sync_cron: Option<&str>, recurring_sync_cron: Option<&str>) -> Result<Option<NextSyncTimes>> {
    let (sync_cron, recurring_sync_cron) = match (sync_cron, recurring_sync_cron) {
        (None, None) => return Ok(None),
        (Some(sync), Some(recurring)) => (sync, recurring),
        _ => return Err(ApiError::bad_input(CRONS_REQUIRED_TOGETHER).into()),
    };
    for (name, expr) in [("syncCron", sync_cron), ("recurringSyncCron", recurring_sync_cron)] {
        validate_min_interval(expr, chrono::Duration::hours(1)).map_err(|error| public(name, error))?;
    }
    let now = Utc::now();
    Ok(Some(NextSyncTimes {
        sync: next_after(sync_cron, now).map_err(|error| public("syncCron", error))?,
        recurring: next_after(recurring_sync_cron, now).map_err(|error| public("recurringSyncCron", error))?,
    }))
}

fn public(name: &str, error: anyhow::Error) -> ApiError {
    ApiError::public(anyhow!("{name}: {error}"))
}
