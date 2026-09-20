use chrono::{DateTime, Utc};
use strum_macros::{Display, EnumString};

use crate::clients::plaid::AccountBase;

pub use crate::database::queries::PlaidItemsDueRow as PlaidItemSecret;
pub use crate::schema::{AccountType, PlaidItemHealthState};

pub(super) fn account_type_from_db(value: &str) -> AccountType {
    value.parse().unwrap_or(AccountType::Other)
}

pub(super) fn plaid_item_health_state_from_db(value: &str) -> PlaidItemHealthState {
    value.parse().unwrap_or(PlaidItemHealthState::Healthy)
}

#[derive(Clone, Copy, Debug, Display, EnumString, Eq, PartialEq)]
pub enum SourceTable {
    #[strum(serialize = "plaid_items")]
    PlaidItems,
    #[strum(serialize = "evm_wallets")]
    EvmWallets,
    #[strum(serialize = "simplefin_connections")]
    SimpleFinConnections,
    #[strum(serialize = "assets")]
    Assets,
}

#[derive(Clone, Copy, Debug, Display, EnumString, Eq, PartialEq)]
#[strum(serialize_all = "lowercase")]
pub enum PlaidSyncKind {
    Sync,
    Recurring,
    Balance,
}

#[derive(Clone, Copy, Debug, Display, EnumString, Eq, PartialEq)]
#[strum(serialize_all = "lowercase")]
pub enum SimpleFinTokenSecretKind {
    Sync,
    Balance,
}

pub use crate::schema::{
    Account, CompleteLinkUpdatePayload, Connection, CreateLinkTokenPayload, CreateSimpleFinAccessTokenPayload,
    ExchangePublicTokenPayload, LinkEvmWalletPayload, Owner, PlaidItem, SimpleFinAccessToken, SimpleFinConnection,
};

#[derive(Clone, Debug, PartialEq)]
pub struct AccountRecord {
    pub account: Account,
    pub connection_id: Option<i64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ConnectionRecord {
    pub connection: Connection,
    pub source_table: SourceTable,
    pub source_id: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlaidItemRecord {
    pub item: PlaidItem,
    pub credential_id: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SimpleFinConnectionRecord {
    pub connection: SimpleFinConnection,
    pub connection_id: i64,
}

impl PlaidItemSecret {
    pub fn last_synced_at(&self) -> Option<DateTime<Utc>> {
        self.plaid_items.last_synced_at.map(Into::into)
    }

    pub fn next_sync_at(&self) -> Option<DateTime<Utc>> {
        self.plaid_items.next_sync_at.map(Into::into)
    }

    pub fn next_recurring_sync_at(&self) -> Option<DateTime<Utc>> {
        self.plaid_items.next_recurring_sync_at.map(Into::into)
    }

    pub fn next_balance_sync_at(&self) -> Option<DateTime<Utc>> {
        self.plaid_items.next_balance_sync_at.map(Into::into)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlaidAccountFields {
    pub id: String,
    pub name: String,
    pub account_type: AccountType,
    pub subtype: Option<String>,
    pub mask: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct UpsertAccount {
    pub external_id: String,
    pub connection_id: Option<i64>,
    pub owner_id: i64,
    pub name: String,
    pub account_type: AccountType,
    pub subtype: Option<String>,
    pub mask: Option<String>,
    pub notes: Option<String>,
    pub closed: bool,
    pub hidden: bool,
    pub needs_review: bool,
}

pub fn fields_from_plaid_account(account: &AccountBase) -> PlaidAccountFields {
    PlaidAccountFields {
        id: account.account_id.clone(),
        name: account.name.clone(),
        account_type: type_from_plaid(&account.account_type),
        subtype: account.subtype.clone(),
        mask: account.mask.clone(),
    }
}

pub fn type_from_plaid(value: &str) -> AccountType {
    match value {
        "depository" => AccountType::Depository,
        "credit" => AccountType::Credit,
        "loan" => AccountType::Loan,
        "investment" => AccountType::Investment,
        _ => AccountType::Other,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct EvmWallet {
    pub id: i64,
    pub address: String,
    pub chain_ids: Vec<String>,
    pub owner_id: i64,
    pub label: String,
    pub created_at: DateTime<Utc>,
    pub next_balance_sync_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AccountUpdate {
    pub name: Option<String>,
    pub owner_id: Option<i64>,
    pub account_type: Option<AccountType>,
    pub subtype: Option<String>,
    pub notes: Option<String>,
    pub closed: Option<bool>,
    pub hidden: Option<bool>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CreateManualAccount {
    pub connection_id: Option<i64>,
    pub name: String,
    pub owner_id: i64,
    pub account_type: AccountType,
    pub notes: Option<String>,
    pub closed: Option<bool>,
    pub hidden: Option<bool>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ConnectionUpdate {
    pub is_active: Option<bool>,
    pub sync_cron: Option<String>,
    pub recurring_sync_cron: Option<String>,
    pub next_sync_at: Option<DateTime<Utc>>,
    pub next_recurring_sync_at: Option<DateTime<Utc>>,
    pub evm_chain_ids: Option<Vec<String>>,
}
