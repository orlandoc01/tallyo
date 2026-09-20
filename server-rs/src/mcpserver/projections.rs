use serde::Serialize;

use crate::{
    ids::{GlobalId, GlobalIdType},
    schema::{Account, AccountType, Asset, AssetClassifier, AssetType, Category, CategoryGroup, CategoryKind, Owner},
};

pub(super) fn encode(typ: GlobalIdType, id: i64) -> String {
    GlobalId::new(typ, id).encoded_string()
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanAsset {
    pub(super) id: String,
    pub(super) asset_type: AssetType,
    pub(super) identifier: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) name: Option<String>,
    pub(super) classifier: AssetClassifier,
}

pub(super) fn map_asset(asset: Asset) -> LeanAsset {
    LeanAsset {
        id: encode(GlobalIdType::Asset, asset.id),
        asset_type: asset.asset_type,
        identifier: asset.identifier,
        name: asset.name,
        classifier: asset.classifier,
    }
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanAccount {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) r#type: AccountType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) subtype: Option<String>,
    pub(super) owner_id: String,
    pub(super) owner_name: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub(super) manual: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub(super) closed: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub(super) hidden: bool,
}

pub(super) fn map_account(account: Account) -> LeanAccount {
    LeanAccount {
        id: encode(GlobalIdType::Account, account.id),
        name: account.name,
        r#type: account.r#type,
        subtype: account.subtype,
        owner_id: encode(GlobalIdType::Owner, account.owner.id),
        owner_name: account.owner.name,
        manual: account.manual,
        closed: account.closed,
        hidden: account.hidden,
    }
}

pub(super) fn map_accounts(accounts: Vec<Account>) -> Vec<LeanAccount> {
    accounts.into_iter().map(map_account).collect()
}

#[derive(Debug, PartialEq, Serialize)]
pub(super) struct LeanList<T> {
    pub(super) items: Vec<T>,
}

pub(super) fn map_list<S, T>(items: Vec<S>, map: impl FnMut(S) -> T) -> LeanList<T> {
    LeanList {
        items: items.into_iter().map(map).collect(),
    }
}

#[derive(Debug, PartialEq, Serialize)]
pub(super) struct LeanAccountPayload {
    pub(super) account: LeanAccount,
}

#[derive(Debug, PartialEq, Serialize)]
pub(super) struct LeanCategoryRef {
    pub(super) id: String,
    pub(super) name: String,
}

pub(super) fn map_category_ref(category: &Category) -> LeanCategoryRef {
    LeanCategoryRef {
        id: encode(GlobalIdType::Category, category.id),
        name: category.name.clone(),
    }
}

// Go returned these model types as-is; their generated Rust counterparts carry raw ids.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanCategory {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) emoji: String,
    pub(super) group_name: String,
    pub(super) group_emoji: String,
    pub(super) kind: CategoryKind,
    pub(super) sort_order: i32,
    #[serde(rename = "plaidPFC2Codes")]
    pub(super) plaid_pfc2_codes: Vec<String>,
}

pub(super) fn map_category(category: Category) -> LeanCategory {
    LeanCategory {
        id: encode(GlobalIdType::Category, category.id),
        name: category.name,
        emoji: category.emoji,
        group_name: category.group_name,
        group_emoji: category.group_emoji,
        kind: category.kind,
        sort_order: category.sort_order,
        plaid_pfc2_codes: category.plaid_pfc2_codes,
    }
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanCategoryGroup {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) emoji: String,
    pub(super) kind: CategoryKind,
    pub(super) categories: Vec<LeanCategory>,
}

pub(super) fn map_category_group(group: CategoryGroup) -> LeanCategoryGroup {
    LeanCategoryGroup {
        id: encode(GlobalIdType::CategoryGroup, group.id),
        name: group.name,
        emoji: group.emoji,
        kind: group.kind,
        categories: group.categories.into_iter().map(map_category).collect(),
    }
}

#[derive(Debug, PartialEq, Serialize)]
pub(super) struct LeanOwner {
    pub(super) id: String,
    pub(super) name: String,
}

pub(super) fn map_owner(owner: Owner) -> LeanOwner {
    LeanOwner {
        id: encode(GlobalIdType::Owner, owner.id),
        name: owner.name,
    }
}
