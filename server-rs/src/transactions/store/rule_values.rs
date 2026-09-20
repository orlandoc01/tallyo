use anyhow::Result;

use crate::{
    apierror::ApiError,
    database::queries,
    ids::GlobalIdType,
    money::Cents,
    schema::{CreateRuleInput, TransactionUpdates, UpdateRuleInput},
};

use super::query::{local_id, local_ids};

const RULE_ACTION_REQUIRED: &str =
    "changes.categoryId, changes.merchantName, changes.tagIds, changes.isHidden, or changes.isRecurring is required";
const RULE_PATTERN_REQUIRED: &str = "merchantPattern or originalPattern is required";

pub(super) struct RuleChanges {
    pub(super) category_id: Option<i64>,
    pub(super) merchant_name: Option<String>,
    pub(super) tag_ids: Vec<i64>,
    pub(super) should_hide: Option<bool>,
    pub(super) should_be_recurring: Option<bool>,
}

impl RuleChanges {
    fn from_updates(updates: &TransactionUpdates) -> Result<Self> {
        Ok(Self {
            category_id: updates
                .category_id
                .as_ref()
                .map(|id| local_id(id, GlobalIdType::Category))
                .transpose()?,
            merchant_name: trimmed(updates.merchant_name.as_deref()),
            tag_ids: local_ids(updates.tag_ids.as_deref(), GlobalIdType::Tag)?,
            should_hide: updates.is_hidden,
            should_be_recurring: updates.is_recurring,
        })
    }

    fn has_action(&self) -> bool {
        self.category_id.is_some()
            || self.merchant_name.is_some()
            || !self.tag_ids.is_empty()
            || self.should_hide.is_some()
            || self.should_be_recurring.is_some()
    }
}

pub(super) struct RuleValues {
    pub(super) id: Option<i64>,
    pub(super) merchant_pattern: String,
    pub(super) original_pattern: String,
    pub(super) amount_min: Option<Cents>,
    pub(super) amount_max: Option<Cents>,
    pub(super) account_ids: Vec<i64>,
    pub(super) priority: i64,
    apply_retroactively: bool,
    pub(super) changes: RuleChanges,
}

impl RuleValues {
    pub(super) fn from_create(input: CreateRuleInput) -> Result<Self> {
        Self::from_raw(RuleRaw {
            id: None,
            merchant_pattern: input.merchant_pattern,
            original_pattern: input.original_pattern,
            amount_min: input.amount_min,
            amount_max: input.amount_max,
            account_ids: input.account_ids,
            priority: input.priority,
            apply_retroactively: input.apply_retroactively,
            updates: input.changes,
        })
    }

    pub(super) fn from_update(input: UpdateRuleInput) -> Result<Self> {
        Self::from_raw(RuleRaw {
            id: Some(local_id(&input.id, GlobalIdType::Rule)?),
            merchant_pattern: input.merchant_pattern,
            original_pattern: input.original_pattern,
            amount_min: input.amount_min,
            amount_max: input.amount_max,
            account_ids: input.account_ids,
            priority: input.priority,
            apply_retroactively: input.apply_retroactively,
            updates: input.changes,
        })
    }

    fn from_raw(raw: RuleRaw) -> Result<Self> {
        let changes = RuleChanges::from_updates(&raw.updates)?;
        anyhow::ensure!(changes.has_action(), ApiError::bad_input(RULE_ACTION_REQUIRED));
        let merchant_pattern = trimmed(raw.merchant_pattern.as_deref()).unwrap_or_default();
        let original_pattern = trimmed(raw.original_pattern.as_deref()).unwrap_or_default();
        anyhow::ensure!(
            !merchant_pattern.is_empty() || !original_pattern.is_empty(),
            ApiError::bad_input(RULE_PATTERN_REQUIRED)
        );
        Ok(Self {
            id: raw.id,
            merchant_pattern,
            original_pattern,
            amount_min: raw.amount_min,
            amount_max: raw.amount_max,
            account_ids: local_ids(raw.account_ids.as_deref(), GlobalIdType::Account)?,
            priority: i64::from(raw.priority.unwrap_or_default()),
            apply_retroactively: raw.apply_retroactively.unwrap_or(false),
            changes,
        })
    }
}

struct RuleRaw {
    id: Option<i64>,
    merchant_pattern: Option<String>,
    original_pattern: Option<String>,
    amount_min: Option<Cents>,
    amount_max: Option<Cents>,
    account_ids: Option<Vec<async_graphql::ID>>,
    priority: Option<i32>,
    apply_retroactively: Option<bool>,
    updates: TransactionUpdates,
}

pub(super) async fn apply_retroactively(executor: &mut sqlx::SqliteConnection, values: &RuleValues) -> Result<i64> {
    if !values.apply_retroactively {
        return Ok(0);
    }
    let merchant_pattern = (!values.merchant_pattern.is_empty()).then(|| values.merchant_pattern.to_ascii_lowercase());
    let original_pattern = (!values.original_pattern.is_empty()).then(|| values.original_pattern.to_ascii_lowercase());
    let ids = queries::retroactive_rule_transaction_ids(
        &mut *executor,
        queries::RetroactiveRuleTransactionIDsParams {
            merchant_pattern: merchant_pattern.as_deref(),
            original_pattern: original_pattern.as_deref(),
            amount_min: values.amount_min.map(|amount| amount.0),
            amount_max: values.amount_max.map(|amount| amount.0),
            account_ids: (!values.account_ids.is_empty()).then_some(values.account_ids.as_slice()),
        },
    )
    .await?
    .into_iter()
    .map(|row| row.id)
    .collect::<Vec<_>>();
    if ids.is_empty() {
        return Ok(0);
    }
    let params = queries::UpdateTransactionFieldsByIDsParams {
        set_merchant_name: values.changes.merchant_name.is_some(),
        merchant_name: values.changes.merchant_name.as_deref(),
        set_notes: false,
        notes: None,
        set_recurring: values.changes.should_be_recurring.is_some(),
        is_recurring: values.changes.should_be_recurring.unwrap_or(false),
        set_hidden: values.changes.should_hide.is_some(),
        is_hidden: values.changes.should_hide.unwrap_or(false),
        set_category: values.changes.category_id.is_some(),
        category_id: values.changes.category_id.unwrap_or_default(),
        ids: &ids,
    };
    if params.set_merchant_name || params.set_recurring || params.set_hidden || params.set_category {
        queries::update_transaction_fields_by_ids(&mut *executor, params).await?;
    }
    if !values.changes.tag_ids.is_empty() {
        queries::add_transaction_tags_by_transaction_ids(
            &mut *executor,
            queries::AddTransactionTagsByTransactionIDsParams {
                tag_ids: &values.changes.tag_ids,
                transaction_ids: &ids,
            },
        )
        .await?;
    }
    Ok(ids.len() as i64)
}

pub(super) async fn replace_rule_accounts(
    executor: &mut sqlx::SqliteConnection,
    rule_id: i64,
    account_ids: &[i64],
) -> Result<()> {
    queries::delete_rule_accounts(&mut *executor, queries::DeleteRuleAccountsParams { rule_id }).await?;
    for account_id in account_ids {
        queries::insert_rule_account(
            &mut *executor,
            queries::InsertRuleAccountParams {
                rule_id,
                account_id: *account_id,
            },
        )
        .await?;
    }
    Ok(())
}

pub(super) async fn replace_rule_tags(
    executor: &mut sqlx::SqliteConnection,
    rule_id: i64,
    tag_ids: &[i64],
) -> Result<()> {
    queries::delete_rule_tags(&mut *executor, queries::DeleteRuleTagsParams { rule_id }).await?;
    for tag_id in tag_ids {
        queries::insert_rule_tag(
            &mut *executor,
            queries::InsertRuleTagParams {
                rule_id,
                tag_id: *tag_id,
            },
        )
        .await?;
    }
    Ok(())
}

fn trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}
