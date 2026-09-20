use anyhow::Result;
use sqlx::SqliteConnection;

use crate::{database::queries, money::Cents};

#[derive(Default)]
pub(super) struct AutoCategoryResult {
    pub(super) category_id: Option<i64>,
    pub(super) merchant_name: Option<String>,
    pub(super) tag_ids: Vec<i64>,
    pub(super) should_hide: Option<bool>,
    pub(super) should_be_recurring: Option<bool>,
    pub(super) from_pfc2: bool,
}

pub(super) async fn auto_categorization_result(
    executor: &mut SqliteConnection,
    merchant_name: Option<&str>,
    original_name: Option<&str>,
    amount: Cents,
    account_id: i64,
) -> Result<AutoCategoryResult> {
    let original_name = original_name.unwrap_or_default();
    let merchant = merchant_name.unwrap_or(original_name);
    let Some(rule) = queries::auto_rule_result_opt(
        &mut *executor,
        queries::AutoRuleResultParams {
            merchant,
            original_name,
            amount_cents: Some(amount.0),
            account_id,
        },
    )
    .await?
    else {
        return Ok(AutoCategoryResult::default());
    };
    let result = AutoCategoryResult {
        category_id: rule.category_id,
        merchant_name: rule.merchant_name,
        tag_ids: rule
            .tag_ids
            .split(',')
            .filter(|id| !id.is_empty())
            .map(str::parse)
            .collect::<std::result::Result<_, _>>()?,
        should_hide: rule.should_hide,
        should_be_recurring: rule.should_be_recurring,
        ..Default::default()
    };
    Ok(result)
}

pub(super) async fn auto_categorization_result_with_plaid_category(
    executor: &mut SqliteConnection,
    merchant_name: Option<&str>,
    original_name: Option<&str>,
    amount: Cents,
    account_id: i64,
    plaid_category: Option<&str>,
) -> Result<AutoCategoryResult> {
    let mut result = auto_categorization_result(executor, merchant_name, original_name, amount, account_id).await?;
    if result.category_id.is_some() {
        return Ok(result);
    }
    let detailed = plaid_detailed_category(plaid_category);
    let Some(row) = (!detailed.is_empty()).then_some(queries::PlaidCategoryIdByDetailedParams {
        plaid_detailed: detailed.as_str(),
    }) else {
        return Ok(result);
    };
    if let Some(category) = queries::plaid_category_id_by_detailed_opt(&mut *executor, row).await? {
        result.category_id = Some(category.category_id);
        result.from_pfc2 = true;
    }
    Ok(result)
}

pub(super) fn plaid_detailed_category(category: Option<&str>) -> String {
    let category = category.unwrap_or_default();
    let detailed = category.split_once(':').map_or(category, |(_, detailed)| detailed);
    detailed.trim().to_ascii_uppercase()
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::*;
    use crate::database::dbtest;

    #[tokio::test]
    async fn returns_the_matching_rule_actions() -> Result<()> {
        let pool = dbtest::open().await?;
        let rule_id = queries::create_rule(
            &pool,
            queries::CreateRuleParams {
                merchant_pattern: "coffee",
                original_pattern: "",
                merchant_name: Some("Cafe"),
                category_id: Some(0),
                should_hide: Some(true),
                should_be_recurring: Some(false),
                amount_min_cents: Some(Cents(100)),
                amount_max_cents: Some(Cents(100)),
                priority: 1,
            },
        )
        .await?
        .id;
        let tag_id = queries::create_tag(
            &pool,
            queries::CreateTagParams {
                name: "Coffee",
                color: "#AABBCC",
            },
        )
        .await?
        .id;
        queries::insert_rule_tag(&pool, queries::InsertRuleTagParams { rule_id, tag_id }).await?;

        let mut connection = pool.acquire().await?;
        let matched = auto_categorization_result(&mut connection, Some("COFFEE SHOP"), None, Cents(100), 1).await?;
        assert_eq!(matched.category_id, Some(0));
        assert_eq!(matched.merchant_name.as_deref(), Some("Cafe"));
        assert_eq!(matched.tag_ids, [tag_id]);
        assert_eq!(matched.should_hide, Some(true));
        assert_eq!(matched.should_be_recurring, Some(false));
        assert_eq!(
            auto_categorization_result(&mut connection, Some("Tea"), None, Cents(100), 1)
                .await?
                .category_id,
            None
        );
        Ok(())
    }

    #[test]
    fn extracts_the_detailed_plaid_category() {
        assert_eq!(
            plaid_detailed_category(Some(" FOOD_AND_DRINK : GROCERIES ")),
            "GROCERIES"
        );
        assert_eq!(plaid_detailed_category(Some(" groceries ")), "GROCERIES");
        assert_eq!(plaid_detailed_category(None), "");
    }
}
