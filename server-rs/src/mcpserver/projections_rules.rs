use serde::Serialize;

use super::{
    projections::{LeanAccount, LeanList, encode, map_accounts, map_category_ref, map_list},
    projections_transactions::{LeanTransaction, map_transaction},
};
use crate::{
    graph::HydratedRule,
    ids::{Date, GlobalIdType},
    money::Cents,
    schema::{RecurrenceInterval, RecurringCharge, RecurringStreamStatus, Tag},
};

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanRecurringCharge {
    pub(super) id: String,
    pub(super) merchant_name: String,
    pub(super) estimated_amount: Cents,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) interval: Option<RecurrenceInterval>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) category_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) category_name: Option<String>,
    pub(super) transactions: Vec<LeanTransaction>,
    pub(super) first_date: Date,
    pub(super) last_date: Date,
    pub(super) last_amount: Cents,
    pub(super) is_user_modified: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) next_expected_date: Option<Date>,
    pub(super) status: RecurringStreamStatus,
    pub(super) is_active: bool,
}

pub(super) fn map_recurring_charge_list(charges: Vec<RecurringCharge>) -> LeanList<LeanRecurringCharge> {
    map_list(charges, |charge| {
        let category = charge.category.as_ref().map(map_category_ref);
        LeanRecurringCharge {
            id: encode(GlobalIdType::RecurringCharge, charge.id),
            merchant_name: charge.merchant_name,
            estimated_amount: charge.estimated_amount,
            interval: charge.interval,
            category_id: category.as_ref().map(|category| category.id.clone()),
            category_name: category.map(|category| category.name),
            transactions: charge.transactions.into_iter().map(map_transaction).collect(),
            first_date: charge.first_date,
            last_date: charge.last_date,
            last_amount: charge.last_amount,
            is_user_modified: charge.is_user_modified,
            next_expected_date: charge.next_expected_date,
            status: charge.status,
            is_active: charge.is_active,
        }
    })
}

#[derive(Debug, PartialEq, Serialize)]
pub(super) struct LeanRuleTag {
    pub(super) id: String,
    pub(super) name: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanRule {
    pub(super) id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) merchant_pattern: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) original_pattern: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) merchant_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) category_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) category_name: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(super) tags: Vec<LeanRuleTag>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) should_hide: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) should_be_recurring: Option<bool>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(super) accounts: Vec<LeanAccount>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) amount_min: Option<Cents>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) amount_max: Option<Cents>,
    pub(super) priority: i32,
}

pub(super) fn map_rule(hydrated: HydratedRule) -> LeanRule {
    let HydratedRule { rule, tags, accounts } = hydrated;
    let to_rule_tag = |tag: Tag| LeanRuleTag {
        id: encode(GlobalIdType::Tag, tag.id),
        name: tag.name,
    };
    let category = rule.category.as_ref().map(map_category_ref);
    LeanRule {
        id: encode(GlobalIdType::Rule, rule.id),
        merchant_pattern: rule.merchant_pattern,
        original_pattern: rule.original_pattern,
        merchant_name: rule.merchant_name,
        category_id: category.as_ref().map(|category| category.id.clone()),
        category_name: category.map(|category| category.name),
        tags: tags.into_iter().map(to_rule_tag).collect(),
        should_hide: rule.should_hide,
        should_be_recurring: rule.should_be_recurring,
        accounts: map_accounts(accounts),
        amount_min: rule.amount_min,
        amount_max: rule.amount_max,
        priority: rule.priority,
    }
}

pub(super) fn map_rule_list(rules: Vec<HydratedRule>) -> LeanList<LeanRule> {
    map_list(rules, map_rule)
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LeanRulePayload {
    pub(super) rule: LeanRule,
    pub(super) retroactively_updated: i32,
}
