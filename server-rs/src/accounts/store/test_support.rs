use crate::accounts::{AccountType, AccountUpdate, simplefin_types::UpsertSimpleFinConnectionParams};

pub(super) fn account_update(account_type: Option<AccountType>, subtype: Option<&str>) -> AccountUpdate {
    AccountUpdate {
        name: None,
        owner_id: None,
        account_type,
        subtype: subtype.map(str::to_owned),
        notes: None,
        closed: None,
        hidden: None,
    }
}

pub(super) fn simplefin_connection(token_id: i64, owner_id: i64, external_id: &str) -> UpsertSimpleFinConnectionParams {
    UpsertSimpleFinConnectionParams {
        external_id: external_id.to_owned(),
        access_token_id: token_id,
        org_id: None,
        org_domain: None,
        org_url: None,
        sfin_url: None,
        logo_url: None,
        name: "Bank".to_owned(),
        owner_id,
    }
}
