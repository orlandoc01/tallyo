use crate::{
    accounts::{
        Account, AccountRecord, ConnectionRecord, EvmWallet, Owner, PlaidItemRecord, SimpleFinAccessToken,
        SimpleFinConnection, SimpleFinConnectionRecord,
        types::{account_type_from_db, plaid_item_health_state_from_db},
    },
    database::queries,
};
use anyhow::{Context, Result};

impl From<(queries::Accounts, String)> for Account {
    fn from((row, owner_name): (queries::Accounts, String)) -> Self {
        Self {
            id: row.id,
            owner: Owner {
                id: row.owner_id,
                name: owner_name,
            },
            name: row.name,
            r#type: account_type_from_db(&row.r#type),
            subtype: row.subtype,
            mask: row.mask,
            notes: row.notes,
            closed: row.is_closed,
            hidden: row.is_hidden,
            needs_review: row.needs_review,
            manual: row.manual,
            created_at: row.created_at.into(),
            updated_at: row.updated_at.into(),
        }
    }
}

impl From<queries::AccountRecordsRow> for AccountRecord {
    fn from(row: queries::AccountRecordsRow) -> Self {
        Self {
            connection_id: row.accounts.connection_id,
            account: (row.accounts, row.owner_name).into(),
        }
    }
}

impl From<queries::AccountRecordsRow> for Account {
    fn from(row: queries::AccountRecordsRow) -> Self {
        AccountRecord::from(row).account
    }
}

impl TryFrom<queries::ConnectionsRow> for ConnectionRecord {
    type Error = anyhow::Error;

    fn try_from(row: queries::ConnectionsRow) -> Result<Self> {
        Ok(Self {
            source_table: row
                .source_table
                .parse()
                .with_context(|| format!("parse connection source table {:?}", row.source_table))?,
            source_id: row.source_id,
            connection: crate::accounts::Connection {
                id: row.id,
                name: row.name,
                owner: Owner {
                    id: row.owner_id,
                    name: row.owner_name,
                },
                is_active: row.is_active,
            },
        })
    }
}

impl From<queries::OwnersRow> for Owner {
    fn from(row: queries::OwnersRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
        }
    }
}

impl From<queries::CreateOwnerRow> for Owner {
    fn from(row: queries::CreateOwnerRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
        }
    }
}

impl From<queries::ListPlaidItemsRow> for PlaidItemRecord {
    fn from(row: queries::ListPlaidItemsRow) -> Self {
        Self {
            credential_id: row.credential_id,
            item: crate::accounts::PlaidItem {
                id: row.item_id,
                institution_id: row.institution_id,
                last_synced_at: row.last_synced_at.map(Into::into),
                health_state: plaid_item_health_state_from_db(&row.health_state),
                health_error_code: row.health_error_code,
                health_error_message: row.health_error_message,
                health_updated_at: row.health_updated_at.map(Into::into),
                sync_cron: row.sync_cron,
                recurring_sync_cron: row.recurring_sync_cron,
                next_sync_at: row.next_sync_at.map(Into::into),
                next_recurring_sync_at: row.next_recurring_sync_at.map(Into::into),
                is_active: row.connection_is_active,
                created_at: row.created_at.into(),
                updated_at: row.updated_at.into(),
            },
        }
    }
}

impl From<queries::EvmWalletsRow> for EvmWallet {
    fn from(row: queries::EvmWalletsRow) -> Self {
        Self {
            id: row.id,
            address: row.address,
            chain_ids: row
                .chain_ids
                .split(',')
                .filter(|chain_id| !chain_id.is_empty())
                .map(ToOwned::to_owned)
                .collect(),
            owner_id: row.owner_id,
            label: row.label,
            created_at: row.created_at.into(),
            next_balance_sync_at: row.next_balance_sync_at.map(Into::into),
        }
    }
}

impl From<(queries::SimpleFinConnectionsRow, Vec<Account>)> for SimpleFinConnectionRecord {
    fn from((row, accounts): (queries::SimpleFinConnectionsRow, Vec<Account>)) -> Self {
        Self {
            connection_id: row.connection_id,
            connection: SimpleFinConnection {
                id: row.id,
                org_domain: row.org_domain,
                org_url: row.org_url,
                accounts,
                last_synced_at: row.last_synced_at.map(Into::into),
                created_at: row.created_at.into(),
                updated_at: row.updated_at.into(),
            },
        }
    }
}

impl From<queries::SimpleFinAccessTokensRow> for SimpleFinAccessToken {
    fn from(row: queries::SimpleFinAccessTokensRow) -> Self {
        Self {
            id: row.id,
            label: row.label,
            owner: Owner {
                id: row.owner_id,
                name: row.owner_name,
            },
            sync_cron: row.sync_cron,
            last_synced_at: row.last_synced_at.map(Into::into),
            next_sync_at: row.next_sync_at.map(Into::into),
            created_at: row.created_at.into(),
        }
    }
}
