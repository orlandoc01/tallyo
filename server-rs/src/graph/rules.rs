use anyhow::{Context, Result};

use super::{
    Resolver,
    ids::{local_id, validate_id, validate_ids, validate_optional_id},
};
use crate::{
    accounts::{Account, store as accounts},
    ids::GlobalIdType,
    schema::{
        CreateRuleInput, CreateRulePayload, DeleteRulePayload, RuleList, RulesInput, TransactionUpdates,
        UpdateRuleInput, UpdateRulePayload,
    },
    transactions::{Rule, Tag, store as transactions},
};

/// Go's hydrated rule shape for callers that bypass the GraphQL loaders (MCP).
#[derive(Clone, Debug, PartialEq)]
pub struct HydratedRule {
    pub rule: Rule,
    pub tags: Vec<Tag>,
    pub accounts: Vec<Account>,
}

impl Resolver {
    pub async fn rules(&self, input: Option<RulesInput>) -> Result<RuleList> {
        if let Some(input) = &input {
            validate_ids(input.account_ids.as_deref(), GlobalIdType::Account)?;
        }
        Ok(RuleList {
            items: transactions::rules(&self.pool, input.as_ref()).await?,
        })
    }

    pub async fn hydrate_rules(&self, rules: Vec<Rule>) -> Result<Vec<HydratedRule>> {
        let rule_ids = rules.iter().map(|rule| rule.id).collect::<Vec<_>>();
        let mut tags_by_rule = transactions::tags_by_rule_ids(&self.pool, &rule_ids)
            .await
            .context("load rule tags")?;
        let mut accounts_by_rule = accounts::accounts_by_rule_ids(&self.pool, &rule_ids)
            .await
            .context("load rule accounts")?;
        Ok(rules
            .into_iter()
            .map(|rule| HydratedRule {
                tags: tags_by_rule.remove(&rule.id).unwrap_or_default(),
                accounts: accounts_by_rule.remove(&rule.id).unwrap_or_default(),
                rule,
            })
            .collect())
    }

    pub async fn create_rule(&self, input: CreateRuleInput) -> Result<CreateRulePayload> {
        validate_rule_input(&input.changes, input.account_ids.as_deref())?;
        let (rule, retroactively_updated) = transactions::create_rule(&self.pool, input).await?;
        Ok(CreateRulePayload {
            rule,
            retroactively_updated: retroactively_updated as i32,
        })
    }

    pub async fn update_rule(&self, input: UpdateRuleInput) -> Result<UpdateRulePayload> {
        validate_id(&input.id, GlobalIdType::Rule)?;
        validate_rule_input(&input.changes, input.account_ids.as_deref())?;
        let (rule, retroactively_updated) = transactions::update_rule(&self.pool, input).await?;
        Ok(UpdateRulePayload {
            rule,
            retroactively_updated: retroactively_updated as i32,
        })
    }

    pub async fn delete_rule(&self, id: &async_graphql::ID) -> Result<DeleteRulePayload> {
        let rule_id = local_id(id, GlobalIdType::Rule)?;
        Ok(DeleteRulePayload {
            success: transactions::delete_rule(&self.pool, rule_id).await?,
        })
    }
}

fn validate_rule_input(changes: &TransactionUpdates, account_ids: Option<&[async_graphql::ID]>) -> Result<()> {
    validate_transaction_update_id_types(changes)?;
    validate_ids(account_ids, GlobalIdType::Account)
}

pub(super) fn validate_transaction_update_id_types(updates: &TransactionUpdates) -> Result<()> {
    validate_optional_id(updates.category_id.as_ref(), GlobalIdType::Category)?;
    validate_ids(updates.tag_ids.as_deref(), GlobalIdType::Tag)
}
