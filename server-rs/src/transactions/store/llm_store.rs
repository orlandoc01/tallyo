use std::collections::{BTreeSet, HashMap};

use anyhow::Result;
use sqlx::SqlitePool;

use super::mapping::category_kind;
use crate::{
    database::queries,
    money::Cents,
    transactions::llm::{CategoryRef, ExampleTransaction, LlmTransaction},
};

// Hand-written like Go's: sqlc cannot resolve a window-function alias filtered through a derived table.
pub const SIMILAR_CATEGORIZED_BY_MERCHANTS_SQL: &str = r#"
SELECT
  merchant_key,
  merchant_name,
  amount_cents,
  category_id,
  category_name
FROM (
  SELECT
    CAST(k.value AS TEXT) AS merchant_key,
    CAST(COALESCE(NULLIF(t.merchant_name, ''), t.original_name, '') AS TEXT) AS merchant_name,
    t.amount_cents,
    cr.cat_id AS category_id,
    cr.cat_name AS category_name,
    t.datetime,
    t.id,
    CAST(ROW_NUMBER() OVER (
      PARTITION BY k.value
      ORDER BY t.datetime DESC, t.id DESC
    ) AS INTEGER) AS merchant_rank
  FROM json_each(CAST(? AS TEXT)) k
  JOIN transactions t
    ON LTRIM(LOWER(COALESCE(NULLIF(t.merchant_name, ''), t.original_name))) >= k.value
    AND LTRIM(LOWER(COALESCE(NULLIF(t.merchant_name, ''), t.original_name))) < k.value || char(1114111)
  JOIN category_rows cr ON cr.cat_id = t.category_id
  WHERE t.is_reviewed = 1
    AND cr.cat_id != 0
    AND t.datetime < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')
) ranked
WHERE merchant_rank <= ?
ORDER BY datetime DESC, id DESC"#;

#[derive(sqlx::FromRow)]
struct SimilarCategorizedByMerchantRow {
    merchant_key: String,
    merchant_name: String,
    amount_cents: Cents,
    category_id: i64,
    category_name: String,
}

pub(crate) async fn categories_for_llm(pool: &SqlitePool) -> Result<Vec<CategoryRef>> {
    queries::categories_for_llm(pool)
        .await
        .map(|categories| {
            categories
                .into_iter()
                .map(|category| CategoryRef {
                    id: category.id,
                    name: category.name,
                    group_name: category.group_name,
                    group_kind: category_kind(&category.group_kind),
                })
                .collect()
        })
        .map_err(Into::into)
}

pub(crate) async fn uncategorized_for_llm(pool: &SqlitePool, limit: i64) -> Result<Vec<LlmTransaction>> {
    queries::uncategorized_for_llm(pool, queries::UncategorizedForLlmParams { row_limit: limit })
        .await
        .map(|transactions| {
            transactions
                .into_iter()
                .map(|transaction| LlmTransaction {
                    id: transaction.id,
                    merchant_name: transaction.merchant_name.unwrap_or_default(),
                    original_name: transaction.original_name.unwrap_or_default(),
                    amount: transaction.amount_cents,
                    plaid_category: transaction.plaid_category.unwrap_or_default(),
                    has_pfc2_match: transaction.pfc_2_categorized,
                    similar_examples: Vec::new(),
                })
                .collect()
        })
        .map_err(Into::into)
}

pub(crate) async fn top_merchant_examples(pool: &SqlitePool, limit: i64) -> Result<Vec<ExampleTransaction>> {
    queries::top_merchant_examples(pool, queries::TopMerchantExamplesParams { row_limit: limit })
        .await
        .map(|examples| {
            examples
                .into_iter()
                .map(|example| ExampleTransaction {
                    merchant_name: example.merchant_name,
                    amount: None,
                    category_id: example.category_id,
                    category_name: example.category_name,
                })
                .collect()
        })
        .map_err(Into::into)
}

// ponytail: first-token prefix key; processor prefixes (SQ *, TST*) share a key.
pub(crate) fn similar_merchant_key(name: &str) -> String {
    let lowered = name.trim().to_ascii_lowercase();
    lowered
        .split_whitespace()
        .next()
        .map(|token| token.trim_end_matches(|c: char| !c.is_alphanumeric()))
        .filter(|token| !token.is_empty())
        .unwrap_or(&lowered)
        .to_owned()
}

pub(crate) async fn similar_examples_by_key(
    pool: &SqlitePool,
    keys: &[String],
) -> Result<HashMap<String, Vec<ExampleTransaction>>> {
    let merchant_keys = keys.iter().filter(|key| !key.is_empty()).collect::<BTreeSet<_>>();
    if merchant_keys.is_empty() {
        return Ok(HashMap::new());
    }
    let merchant_keys_json = serde_json::to_string(&merchant_keys)?;
    let rows = sqlx::query_as::<_, SimilarCategorizedByMerchantRow>(SIMILAR_CATEGORIZED_BY_MERCHANTS_SQL)
        .bind(merchant_keys_json)
        .bind(3_i64)
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().fold(HashMap::new(), |mut examples_by_merchant, row| {
        examples_by_merchant
            .entry(row.merchant_key)
            .or_default()
            .push(ExampleTransaction {
                merchant_name: row.merchant_name,
                amount: Some(row.amount_cents),
                category_id: row.category_id,
                category_name: row.category_name,
            });
        examples_by_merchant
    }))
}

pub(crate) async fn apply_category(pool: &SqlitePool, transaction_id: i64, category_id: i64) -> Result<()> {
    queries::apply_llm_category(
        pool,
        queries::ApplyLlmCategoryParams {
            category_id,
            id: transaction_id,
            uncategorized_category_id: 0,
        },
    )
    .await
    .map_err(Into::into)
}

pub(crate) async fn clear_staged(pool: &SqlitePool, ids: Option<&[i64]>) -> Result<()> {
    queries::clear_staged_for_llm(pool, queries::ClearStagedForLlmParams { ids })
        .await
        .map_err(Into::into)
}

pub async fn count_staged(pool: &SqlitePool) -> Result<i64> {
    queries::count_staged_for_llm(pool)
        .await
        .map(|row| row.count)
        .map_err(Into::into)
}

pub(crate) async fn stage_uncategorized(pool: &SqlitePool) -> Result<u64> {
    queries::stage_uncategorized_for_llm(pool).await.map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::similar_merchant_key;

    #[test]
    fn similar_merchant_key_takes_the_first_token() {
        let cases = [
            ("Google *Storage", "google"),
            ("GOOGLE", "google"),
            ("Terminal X", "terminal"),
            ("7-Eleven", "7-eleven"),
            ("*Fetch", "*fetch"),
            ("SQ_*PAYPAL", "sq_*paypal"),
            ("* UBER EATS", "* uber eats"),
            ("", ""),
            ("   ", ""),
        ];
        for (name, expected) in cases {
            assert_eq!(similar_merchant_key(name), expected, "{name:?}");
        }
    }
}
