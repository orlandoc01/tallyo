use anyhow::Result;
use sqlx::{Executor, Sqlite, SqlitePool};

use crate::{
    apierror::ApiError,
    database::{self, queries},
    schema::{CreateRuleInput, RulesInput, UpdateRuleInput},
    transactions::Rule,
};

use super::{
    mapping::rule_from_row,
    query::{local_ids, normalized_lower, option_slice, search_match},
    rule_values::{RuleValues, apply_retroactively, replace_rule_accounts, replace_rule_tags},
};

pub async fn rules(pool: &SqlitePool, input: Option<&RulesInput>) -> Result<Vec<Rule>> {
    let search = RuleSearch::from_input(input)?;
    Ok(queries::list_rules(pool, search.params())
        .await?
        .into_iter()
        .map(rule_from_row)
        .collect())
}

pub async fn rule_by_id(pool: &SqlitePool, id: i64) -> Result<Option<Rule>> {
    queries::list_rules(
        pool,
        queries::ListRulesParams {
            id: Some(id),
            ..Default::default()
        },
    )
    .await
    .map(|rows| rows.into_iter().next().map(rule_from_row))
    .map_err(Into::into)
}

pub async fn create_rule(pool: &SqlitePool, input: CreateRuleInput) -> Result<(Rule, i64)> {
    let values = RuleValues::from_create(input)?;
    let (id, updated) = database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let id = queries::create_rule(
                &mut **transaction,
                queries::CreateRuleParams {
                    merchant_pattern: &values.merchant_pattern,
                    original_pattern: &values.original_pattern,
                    merchant_name: values.changes.merchant_name.as_deref(),
                    category_id: values.changes.category_id,
                    should_hide: values.changes.should_hide,
                    should_be_recurring: values.changes.should_be_recurring,
                    amount_min_cents: values.amount_min,
                    amount_max_cents: values.amount_max,
                    priority: values.priority,
                },
            )
            .await?
            .id;
            replace_rule_accounts(transaction, id, &values.account_ids).await?;
            replace_rule_tags(transaction, id, &values.changes.tag_ids).await?;
            Ok((id, apply_retroactively(transaction, &values).await?))
        })
    })
    .await?;
    let rule = rule_by_id(pool, id)
        .await?
        .expect("newly created rule must be readable");
    Ok((rule, updated))
}

pub async fn update_rule(pool: &SqlitePool, input: UpdateRuleInput) -> Result<(Rule, i64)> {
    let values = RuleValues::from_update(input)?;
    let id = values.id.expect("update rule has id");
    let updated = database::with_tx(pool, |transaction| {
        Box::pin(async move {
            if queries::update_rule(
                &mut **transaction,
                queries::UpdateRuleParams {
                    merchant_pattern: &values.merchant_pattern,
                    original_pattern: &values.original_pattern,
                    merchant_name: values.changes.merchant_name.as_deref(),
                    category_id: values.changes.category_id,
                    should_hide: values.changes.should_hide,
                    should_be_recurring: values.changes.should_be_recurring,
                    amount_min_cents: values.amount_min,
                    amount_max_cents: values.amount_max,
                    priority: values.priority,
                    id,
                },
            )
            .await?
                == 0
            {
                return Err(ApiError::bad_input(format!("rule {id} not found")).into());
            }
            replace_rule_accounts(transaction, id, &values.account_ids).await?;
            replace_rule_tags(transaction, id, &values.changes.tag_ids).await?;
            apply_retroactively(transaction, &values).await
        })
    })
    .await?;
    let rule = rule_by_id(pool, id).await?.expect("updated rule must be readable");
    Ok((rule, updated))
}

pub async fn delete_rule(executor: impl Executor<'_, Database = Sqlite>, id: i64) -> Result<bool> {
    queries::delete_rule(executor, queries::DeleteRuleParams { id })
        .await
        .map(|rows| rows > 0)
        .map_err(Into::into)
}

#[derive(Default)]
struct RuleSearch {
    merchant_pattern: Option<String>,
    original_pattern: Option<String>,
    amount_min: Option<crate::money::Cents>,
    amount_max: Option<crate::money::Cents>,
    account_ids: Vec<i64>,
    search_match: Option<String>,
}

impl RuleSearch {
    fn from_input(input: Option<&RulesInput>) -> Result<Self> {
        let Some(input) = input else {
            return Ok(Self::default());
        };
        Ok(Self {
            merchant_pattern: normalized_lower(input.merchant_pattern.as_deref()),
            original_pattern: normalized_lower(input.original_pattern.as_deref()),
            amount_min: input.amount_min,
            amount_max: input.amount_max,
            account_ids: local_ids(input.account_ids.as_deref(), crate::ids::GlobalIdType::Account)?,
            search_match: search_match(input.search.as_deref()),
        })
    }

    fn params(&self) -> queries::ListRulesParams<'_> {
        queries::ListRulesParams {
            id: None,
            merchant_pattern: self.merchant_pattern.as_deref(),
            original_pattern: self.original_pattern.as_deref(),
            amount_min_cents: self.amount_min,
            amount_max_cents: self.amount_max,
            account_ids: option_slice(&self.account_ids),
            search_match: self.search_match.as_deref(),
        }
    }
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use async_graphql::ID;

    use super::*;
    use crate::{
        ids::{GlobalId, GlobalIdType},
        money::Cents,
        schema::{CategoryKind, TransactionUpdates},
        testutil::transactions::{account, category, transaction},
    };

    fn id(typ: GlobalIdType, value: i64) -> ID {
        ID::from(GlobalId::new(typ, value).encoded_string())
    }

    #[tokio::test]
    async fn manages_rules_filters_relations_and_retroactive_updates() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        let account_id = account(&pool, "rule-account").await?;
        let category = category(&pool, "Coffee", CategoryKind::Expense).await?;
        let tag = super::super::create_tag(&pool, "Morning", "#AABBCC").await?;
        let transaction_id = transaction(
            &pool,
            "coffee purchase",
            account_id,
            0,
            Cents(250),
            "2026-01-01T12:00:00Z".parse()?,
        )
        .await?;
        let (rule, updated) = create_rule(
            &pool,
            CreateRuleInput {
                merchant_pattern: Some("coffee".into()),
                original_pattern: None,
                changes: TransactionUpdates {
                    merchant_name: Some("Cafe".into()),
                    notes: None,
                    is_recurring: Some(true),
                    is_hidden: Some(false),
                    category_id: Some(id(GlobalIdType::Category, category.id)),
                    tag_ids: Some(vec![id(GlobalIdType::Tag, tag.id)]),
                },
                account_ids: Some(vec![id(GlobalIdType::Account, account_id)]),
                amount_min: Some(Cents(250)),
                amount_max: Some(Cents(250)),
                priority: Some(4),
                apply_retroactively: Some(true),
            },
        )
        .await?;
        assert_eq!(updated, 1);
        let tags = super::super::tags_by_rule_ids(&pool, &[rule.id]).await?;
        let accounts = crate::accounts::store::accounts_by_rule_ids(&pool, &[rule.id]).await?;
        assert_eq!(
            (
                rule.category.as_ref().map(|item| item.id),
                tags[&rule.id][0].id,
                accounts[&rule.id][0].id
            ),
            (Some(category.id), tag.id, account_id)
        );
        assert_eq!(
            super::super::transaction_by_id(&pool, transaction_id)
                .await?
                .unwrap()
                .merchant_name,
            Some("Cafe".into())
        );
        assert_eq!(
            rules(
                &pool,
                Some(&RulesInput {
                    merchant_pattern: Some(" COFFEE ".into()),
                    original_pattern: None,
                    account_ids: Some(vec![id(GlobalIdType::Account, account_id)]),
                    amount_min: Some(Cents(250)),
                    amount_max: Some(Cents(250)),
                    search: None,
                }),
            )
            .await?
            .len(),
            1
        );
        assert_eq!(
            rules(
                &pool,
                Some(&RulesInput {
                    merchant_pattern: None,
                    original_pattern: None,
                    account_ids: None,
                    amount_min: None,
                    amount_max: None,
                    search: Some("cof".into()),
                }),
            )
            .await?
            .len(),
            1
        );
        assert!(
            rules(
                &pool,
                Some(&RulesInput {
                    merchant_pattern: None,
                    original_pattern: None,
                    account_ids: None,
                    amount_min: None,
                    amount_max: None,
                    search: Some("zzz".into()),
                }),
            )
            .await?
            .is_empty()
        );
        assert_eq!(rule_by_id(&pool, 999).await?, None);

        let (updated_rule, retroactive) = update_rule(
            &pool,
            UpdateRuleInput {
                id: id(GlobalIdType::Rule, rule.id),
                merchant_pattern: Some("coffee".into()),
                original_pattern: Some("receipt".into()),
                changes: TransactionUpdates {
                    merchant_name: None,
                    notes: None,
                    is_recurring: None,
                    is_hidden: None,
                    category_id: Some(id(GlobalIdType::Category, category.id)),
                    tag_ids: Some(Vec::new()),
                },
                account_ids: Some(vec![id(GlobalIdType::Account, account_id)]),
                amount_min: None,
                amount_max: None,
                priority: Some(5),
                apply_retroactively: Some(false),
            },
        )
        .await?;
        assert_eq!(retroactive, 0);
        assert_eq!(updated_rule.priority, 5);
        assert!(super::super::tags_by_rule_ids(&pool, &[rule.id]).await?.is_empty());
        assert!(delete_rule(&pool, rule.id).await?);
        assert!(!delete_rule(&pool, rule.id).await?);
        Ok(())
    }
}
