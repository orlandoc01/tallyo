use std::collections::{HashMap, HashSet};

use anyhow::{Context, Result};
use sqlx::{Sqlite, SqlitePool, Transaction};

use crate::pfc2;

use super::{queries, with_tx};

const SENTINEL_CATEGORY_GROUP_ID: i64 = 0;
const SENTINEL_CATEGORY_ID: i64 = 0;
const SENTINEL_SORT_ORDER: i64 = 2_147_483_647;
const SENTINEL_EMOJI: &str = "❓";
const SEED_DATA: &str = include_str!("seed-categories.md");

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum CategoryKind {
    Expense,
    Income,
    Transfer,
}

impl CategoryKind {
    const fn as_sql(self) -> &'static str {
        match self {
            Self::Expense => "EXPENSE",
            Self::Income => "INCOME",
            Self::Transfer => "TRANSFER",
        }
    }
}

/// Seed the sentinel and reference categories when a database is first initialized.
pub async fn seed_reference_categories(pool: &SqlitePool) -> Result<()> {
    let sentinel_count = queries::count_sentinel_categories(pool)
        .await
        .context("count sentinel categories")?
        .count;
    if sentinel_count > 0 {
        return Ok(());
    }

    with_tx(pool, |transaction| {
        Box::pin(async move {
            upsert_sentinel_categories(transaction).await?;
            seed_categories(transaction).await?;
            seed_plaid_mappings(transaction).await
        })
    })
    .await
}

async fn upsert_sentinel_categories(transaction: &mut Transaction<'_, Sqlite>) -> Result<()> {
    queries::upsert_sentinel_category_group(
        &mut **transaction,
        queries::UpsertSentinelCategoryGroupParams {
            id: SENTINEL_CATEGORY_GROUP_ID,
            name: "Other",
            emoji: SENTINEL_EMOJI,
            kind: CategoryKind::Expense.as_sql(),
            sort_order: SENTINEL_SORT_ORDER,
        },
    )
    .await
    .context("upsert sentinel category group")?;
    queries::upsert_sentinel_category(
        &mut **transaction,
        queries::UpsertSentinelCategoryParams {
            id: SENTINEL_CATEGORY_ID,
            name: "uncategorized",
            emoji: SENTINEL_EMOJI,
            sort_order: SENTINEL_SORT_ORDER,
            group_id: SENTINEL_CATEGORY_GROUP_ID,
        },
    )
    .await
    .context("upsert sentinel category")?;
    Ok(())
}

async fn seed_categories(transaction: &mut Transaction<'_, Sqlite>) -> Result<()> {
    let category_count = queries::count_non_sentinel_categories(&mut **transaction)
        .await
        .context("count reference categories")?
        .count;
    if category_count > 0 {
        return Ok(());
    }

    let mut group_ids = HashMap::from([("Other", SENTINEL_CATEGORY_GROUP_ID)]);
    for group in seed_category_groups(SEED_DATA) {
        if group.name == "Other" {
            continue;
        }
        let group_name = group.name;
        let id = queries::create_category_group(&mut **transaction, group)
            .await
            .with_context(|| format!("create category group: {group_name}"))?
            .id;
        group_ids.insert(group_name, id);
    }

    for category in seed_category_params(SEED_DATA, &group_ids)? {
        let category_name = category.name;
        queries::create_seed_category(&mut **transaction, category)
            .await
            .with_context(|| format!("create category: {category_name}"))?;
    }
    Ok(())
}

async fn seed_plaid_mappings(transaction: &mut Transaction<'_, Sqlite>) -> Result<()> {
    upsert_plaid_mapping(transaction, "OTHER_OTHER", SENTINEL_CATEGORY_ID).await?;
    for raw_line in SEED_DATA.lines() {
        let line = raw_line.trim();
        let Some(category_line) = line.strip_prefix("- ") else {
            continue;
        };
        let (category_text, codes_text) = category_line.split_once('|').unwrap_or((category_line, ""));
        let (_, category_name) = split_emoji_name(category_text.trim());
        if category_name == "Uncategorized" {
            continue;
        }
        for code in pfc2::normalize(&codes_text.split(',').collect::<Vec<_>>()) {
            queries::upsert_category_plaid_mapping_by_category_name(
                &mut **transaction,
                queries::UpsertCategoryPlaidMappingByCategoryNameParams {
                    plaid_detailed: &code,
                    category_name,
                },
            )
            .await
            .with_context(|| format!("upsert Plaid category mapping: {code}"))?;
        }
    }
    Ok(())
}

async fn upsert_plaid_mapping(transaction: &mut Transaction<'_, Sqlite>, code: &str, category_id: i64) -> Result<()> {
    queries::upsert_category_plaid_mapping(
        &mut **transaction,
        queries::UpsertCategoryPlaidMappingParams {
            plaid_detailed: code,
            category_id,
        },
    )
    .await
    .with_context(|| format!("upsert Plaid category mapping: {code}"))?;
    Ok(())
}

fn seed_category_groups(markdown: &str) -> Vec<queries::CreateCategoryGroupParams<'_>> {
    let mut group_names = HashSet::new();
    let mut group_name = "Other";
    let mut group_emoji = "?";
    markdown
        .lines()
        .filter_map(|raw_line| {
            let line = raw_line.trim();
            if let Some(header) = line.strip_prefix("## ") {
                (group_emoji, group_name) = split_emoji_name(header);
                return None;
            }
            let category_line = line.strip_prefix("- ")?;
            let (category_text, _) = category_line.split_once('|').unwrap_or((category_line, ""));
            let (_, category_name) = split_emoji_name(category_text.trim());
            (category_name != "Uncategorized").then_some((group_name, group_emoji))
        })
        .enumerate()
        .filter(|(_, (name, _))| group_names.insert(*name))
        .map(|(sort_order, (name, emoji))| queries::CreateCategoryGroupParams {
            name,
            emoji,
            kind: category_kind_for_group(name).as_sql(),
            sort_order: i64::try_from(sort_order).expect("category group sort order fits i64") + 1,
        })
        .collect()
}

fn seed_category_params<'a>(
    markdown: &'a str,
    group_ids: &HashMap<&str, i64>,
) -> Result<Vec<queries::CreateSeedCategoryParams<'a>>> {
    let mut group_name = "Other";
    markdown
        .lines()
        .filter_map(|raw_line| {
            let line = raw_line.trim();
            if let Some(header) = line.strip_prefix("## ") {
                (_, group_name) = split_emoji_name(header);
                return None;
            }
            let category_line = line.strip_prefix("- ")?;
            let (category_text, _) = category_line.split_once('|').unwrap_or((category_line, ""));
            let (emoji, name) = split_emoji_name(category_text.trim());
            (name != "Uncategorized").then_some((name, emoji, group_name))
        })
        .enumerate()
        .map(|(sort_order, (name, emoji, group_name))| {
            let group_id = group_ids
                .get(group_name)
                .copied()
                .with_context(|| format!("resolve category group: {group_name}"))?;
            Ok(queries::CreateSeedCategoryParams {
                name,
                emoji,
                group_id,
                sort_order: i64::try_from(sort_order).context("convert category sort order")?,
            })
        })
        .collect()
}

fn category_kind_for_group(group_name: &str) -> CategoryKind {
    match group_name {
        "Income" => CategoryKind::Income,
        "Transfers" => CategoryKind::Transfer,
        _ => CategoryKind::Expense,
    }
}

fn split_emoji_name(value: &str) -> (&str, &str) {
    let Some(emoji) = value.split_whitespace().next() else {
        return ("?", value);
    };
    (emoji, value.strip_prefix(emoji).unwrap_or(value).trim())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use anyhow::Result;

    use super::{seed_category_groups, seed_category_params, seed_reference_categories};
    use crate::database::{open_database, queries};

    #[test]
    fn parses_seed_query_params() -> Result<()> {
        let markdown =
            "## $ Income\n- $ Pay | INCOME_SALARY\n## > Transfers\n- > Move | TRANSFER_IN_ACCOUNT_TRANSFER\n";
        let groups = seed_category_groups(markdown);
        let group_ids = HashMap::from([("Income", 1), ("Transfers", 2)]);
        let categories = seed_category_params(markdown, &group_ids)?;

        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].kind, "INCOME");
        assert_eq!(groups[1].kind, "TRANSFER");
        assert_eq!(categories[0].name, "Pay");
        assert_eq!(categories[0].group_id, 1);
        assert_eq!(categories[1].group_id, 2);
        Ok(())
    }

    #[tokio::test]
    async fn seeds_reference_categories_once() -> Result<()> {
        let pool = open_database(":memory:", None).await?;
        assert_eq!(queries::count_sentinel_categories(&pool).await?.count, 1);
        let category_count = queries::count_non_sentinel_categories(&pool).await?.count;
        assert!(category_count > 0);
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT c.name\n                 FROM plaid_category_mappings m\n                 JOIN categories c ON c.id = m.category_id\n                 WHERE m.plaid_detailed = 'INCOME_SALARY'"
            )
            .fetch_one(&pool)
            .await?,
            "Paychecks"
        );

        sqlx::query("DELETE FROM plaid_category_mappings WHERE plaid_detailed = 'OTHER_OTHER'")
            .execute(&pool)
            .await?;
        seed_reference_categories(&pool).await?;
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM plaid_category_mappings WHERE plaid_detailed = 'OTHER_OTHER'"
            )
            .fetch_one(&pool)
            .await?,
            0
        );
        assert_eq!(
            queries::count_non_sentinel_categories(&pool).await?.count,
            category_count
        );
        Ok(())
    }
}
