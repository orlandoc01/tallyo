use serde::Serialize;

use super::projections::{LeanAccount, LeanList, encode, map_accounts, map_list};
use crate::{
    graph::HydratedPlaidItem,
    ids::GlobalIdType,
    schema::{PlaidCredential, PlaidEnvironment, PlaidItemHealthState},
};

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanPlaidCredentialRef {
    pub(super) id: i32,
    pub(super) client_id: String,
    pub(super) environment: PlaidEnvironment,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) label: Option<String>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanPlaidCredential {
    #[serde(flatten)]
    pub(super) credential: LeanPlaidCredentialRef,
    pub(super) item_count: i32,
}

fn map_plaid_credential_ref(credential: PlaidCredential) -> LeanPlaidCredentialRef {
    LeanPlaidCredentialRef {
        id: credential.id,
        client_id: credential.client_id,
        environment: credential.environment,
        label: credential.label,
    }
}

pub(super) fn map_plaid_credential_list(credentials: Vec<PlaidCredential>) -> LeanList<LeanPlaidCredential> {
    map_list(credentials, |credential| LeanPlaidCredential {
        item_count: credential.item_count,
        credential: map_plaid_credential_ref(credential),
    })
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanPlaidItem {
    pub(super) id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) credential: Option<LeanPlaidCredentialRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) institution_id: Option<String>,
    pub(super) accounts: Vec<LeanAccount>,
    pub(super) health_state: PlaidItemHealthState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) health_error_code: Option<String>,
    pub(super) is_active: bool,
}

pub(super) fn map_plaid_item_list(items: Vec<HydratedPlaidItem>) -> LeanList<LeanPlaidItem> {
    map_list(items, |hydrated| {
        let HydratedPlaidItem {
            item,
            credential,
            accounts,
        } = hydrated;
        LeanPlaidItem {
            id: encode(GlobalIdType::PlaidItem, item.id),
            credential: credential.map(map_plaid_credential_ref),
            institution_id: item.institution_id,
            accounts: map_accounts(accounts),
            health_state: item.health_state,
            health_error_code: item.health_error_code,
            is_active: item.is_active,
        }
    })
}
