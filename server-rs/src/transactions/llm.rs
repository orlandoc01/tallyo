use std::fmt::Write;

use anyhow::Result;
use serde::Deserialize;

use crate::{clients::ollama::OllamaClient, money::Cents, transactions::store::llm_store};

const OLLAMA_BATCH_SIZE: usize = 5;

#[derive(Clone)]
pub struct OllamaCategorizer {
    client: OllamaClient,
    categories: Vec<CategoryRef>,
}

impl OllamaCategorizer {
    pub async fn new(pool: &sqlx::SqlitePool, base_url: impl Into<String>, model: impl Into<String>) -> Result<Self> {
        Self::with_categories(base_url, model, llm_store::categories_for_llm(pool).await?)
    }

    pub(crate) fn with_categories(
        base_url: impl Into<String>,
        model: impl Into<String>,
        categories: Vec<CategoryRef>,
    ) -> Result<Self> {
        Ok(Self {
            client: OllamaClient::new(base_url, model)?,
            categories,
        })
    }

    pub(crate) const fn batch_size(&self) -> usize {
        OLLAMA_BATCH_SIZE
    }

    pub(crate) fn category_count(&self) -> usize {
        self.categories.len()
    }

    pub(crate) async fn categorize_batch(
        &self,
        transactions: &[LlmTransaction],
        global_examples: &[ExampleTransaction],
    ) -> Result<Vec<LlmResult>> {
        if transactions.is_empty() {
            return Ok(Vec::new());
        }
        let response = self
            .client
            .generate(&build_prompt(&self.categories, transactions, global_examples))
            .await?;
        Ok(parse_response(&response, transactions, &self.categories))
    }
}

#[derive(Clone, Debug)]
pub(crate) struct CategoryRef {
    pub(crate) id: i64,
    pub(crate) name: String,
    pub(crate) group_name: String,
}

#[derive(Clone, Debug)]
pub(crate) struct ExampleTransaction {
    pub(crate) merchant_name: String,
    pub(crate) amount: Option<Cents>,
    pub(crate) category_id: i64,
    pub(crate) category_name: String,
}

#[derive(Clone, Debug)]
pub(crate) struct LlmTransaction {
    pub(crate) id: i64,
    pub(crate) merchant_name: String,
    pub(crate) original_name: String,
    pub(crate) amount: Cents,
    pub(crate) plaid_category: String,
    pub(crate) has_pfc2_match: bool,
    pub(crate) similar_examples: Vec<ExampleTransaction>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Confidence {
    High,
    Medium,
    Low,
}

#[derive(Clone, Debug)]
pub(crate) struct LlmResult {
    pub(crate) transaction_id: i64,
    pub(crate) category_id: i64,
    pub(crate) category_name: String,
    pub(crate) confidence: Confidence,
}

fn build_prompt(
    categories: &[CategoryRef],
    transactions: &[LlmTransaction],
    global_examples: &[ExampleTransaction],
) -> String {
    let mut prompt = String::from(
        "You are a personal finance transaction categorizer. Classify each transaction into exactly one category from the list below.\n\nCATEGORIES (id | group | name):\n",
    );
    let mut current_group = "";
    for category in categories {
        if category.group_name != current_group {
            current_group = &category.group_name;
            let _ = write!(prompt, "\n[{}]\n", category.group_name);
        }
        let _ = writeln!(prompt, "  {} | {}", category.id, category.name);
    }
    if !global_examples.is_empty() {
        prompt.push_str("\nEXAMPLES FROM YOUR TRANSACTION HISTORY:\n");
        for example in global_examples {
            let _ = writeln!(
                prompt,
                "  {:?} → {} (ID: {})",
                example.merchant_name, example.category_name, example.category_id
            );
        }
    }
    prompt.push_str(
        "\nIMPORTANT RULES:\n- Respond ONLY with valid JSON, no markdown, no explanation.\n- Use the exact category ID from the list above.\n- If you are not confident, set confidence to \"low\".\n- If you truly cannot determine a category, use category_id: 0.\n- plaid_hint is a hint only — it may be wrong. Prefer merchant name over plaid_hint.\n\nTRANSACTIONS TO CLASSIFY:\n",
    );
    for (index, transaction) in transactions.iter().enumerate() {
        let _ = write!(prompt, "\n{}. merchant: {:?}", index + 1, transaction.merchant_name);
        if !transaction.original_name.is_empty() && transaction.original_name != transaction.merchant_name {
            let _ = write!(prompt, ", raw_name: {:?}", transaction.original_name);
        }
        let _ = write!(prompt, ", amount: ${:.2}", transaction.amount.dollars());
        if !transaction.plaid_category.is_empty() {
            let _ = write!(prompt, ", plaid_hint: {:?}", transaction.plaid_category);
        }
        if !transaction.similar_examples.is_empty() {
            prompt.push_str("\n   (past categorized:");
            for (index, example) in transaction.similar_examples.iter().enumerate() {
                if index > 0 {
                    prompt.push(',');
                }
                let _ = write!(
                    prompt,
                    " ${:.2}→{} (ID: {})",
                    example.amount.unwrap_or_default().dollars(),
                    example.category_name,
                    example.category_id
                );
            }
            prompt.push(')');
        }
    }
    prompt.push_str(
        "\n\nRespond with a JSON array:\n[{\"transaction_index\": 1, \"category_id\": <id>, \"confidence\": \"high\"|\"medium\"|\"low\"}, ...]\n",
    );
    prompt
}

#[derive(Deserialize)]
struct Classification {
    transaction_index: usize,
    category_id: i64,
    #[serde(default)]
    confidence: String,
}

fn parse_response(raw: &str, transactions: &[LlmTransaction], categories: &[CategoryRef]) -> Vec<LlmResult> {
    let category_names = categories
        .iter()
        .map(|category| (category.id, category.name.as_str()))
        .collect::<std::collections::HashMap<_, _>>();
    let raw = strip_code_fences(raw);
    let classifications = match classifications(raw) {
        Ok(classifications) => classifications,
        Err(error) => {
            tracing::warn!(raw, %error, "llm: could not parse response");
            return Vec::new();
        }
    };
    classifications
        .into_iter()
        .filter_map(|classification| {
            let transaction = transactions.get(classification.transaction_index.checked_sub(1)?)?;
            if classification.category_id == 0 {
                return None;
            }
            let Some(category_name) = category_names.get(&classification.category_id) else {
                tracing::debug!(category_id = classification.category_id, "llm: invalid category_id");
                return None;
            };
            let confidence = confidence(&classification.confidence);
            (confidence != Confidence::Low).then(|| LlmResult {
                transaction_id: transaction.id,
                category_id: classification.category_id,
                category_name: (*category_name).to_owned(),
                confidence,
            })
        })
        .collect()
}

fn classifications(raw: &str) -> Result<Vec<Classification>> {
    if let Ok(classifications) = serde_json::from_str(raw) {
        return Ok(classifications);
    }
    if let Ok(response) = serde_json::from_str::<serde_json::Value>(raw) {
        let object = response.as_object();
        let results = object
            .and_then(|object| object.get("results"))
            .into_iter()
            .chain(object.into_iter().flat_map(|object| object.values()))
            .filter(|value| value.is_array())
            .find_map(|value| serde_json::from_value::<Vec<Classification>>(value.clone()).ok());
        if let Some(results) = results {
            return Ok(results);
        }
    }
    let classification = serde_json::from_str::<Classification>(raw)?;
    anyhow::ensure!(classification.transaction_index > 0, "invalid classification response");
    Ok(vec![classification])
}

fn confidence(value: &str) -> Confidence {
    match value {
        "high" => Confidence::High,
        "low" => Confidence::Low,
        _ => Confidence::Medium,
    }
}

fn strip_code_fences(raw: &str) -> &str {
    let raw = raw.trim();
    if !raw.starts_with("```") {
        return raw;
    }
    let raw = raw.strip_prefix("```").unwrap_or(raw);
    let raw = raw
        .find('\n')
        .map_or_else(|| raw.strip_prefix("json").unwrap_or(raw), |index| &raw[index + 1..]);
    raw.trim().strip_suffix("```").unwrap_or(raw).trim()
}

#[cfg(test)]
mod tests {
    use super::{
        CategoryRef, Confidence, ExampleTransaction, LlmTransaction, build_prompt, classifications, parse_response,
    };
    use crate::money::Cents;

    #[test]
    fn builds_the_verbatim_go_prompt() {
        let prompt = build_prompt(
            &categories(),
            &[LlmTransaction {
                id: 10,
                merchant_name: "Amazon".to_owned(),
                original_name: "AMAZON MKTPLACE".to_owned(),
                amount: Cents(3450),
                plaid_category: "SHOPPING".to_owned(),
                has_pfc2_match: false,
                similar_examples: vec![ExampleTransaction {
                    merchant_name: "Amazon".to_owned(),
                    amount: Some(Cents(999)),
                    category_id: 2,
                    category_name: "Coffee Shops".to_owned(),
                }],
            }],
            &[ExampleTransaction {
                merchant_name: "Whole Foods".to_owned(),
                amount: None,
                category_id: 1,
                category_name: "Groceries".to_owned(),
            }],
        );

        assert_eq!(
            prompt,
            r#"You are a personal finance transaction categorizer. Classify each transaction into exactly one category from the list below.

CATEGORIES (id | group | name):

[Food & Drink]
  1 | Groceries
  2 | Coffee Shops

[Transportation]
  3 | Gas

EXAMPLES FROM YOUR TRANSACTION HISTORY:
  "Whole Foods" → Groceries (ID: 1)

IMPORTANT RULES:
- Respond ONLY with valid JSON, no markdown, no explanation.
- Use the exact category ID from the list above.
- If you are not confident, set confidence to "low".
- If you truly cannot determine a category, use category_id: 0.
- plaid_hint is a hint only — it may be wrong. Prefer merchant name over plaid_hint.

TRANSACTIONS TO CLASSIFY:

1. merchant: "Amazon", raw_name: "AMAZON MKTPLACE", amount: $34.50, plaid_hint: "SHOPPING"
   (past categorized: $9.99→Coffee Shops (ID: 2))

Respond with a JSON array:
[{"transaction_index": 1, "category_id": <id>, "confidence": "high"|"medium"|"low"}, ...]
"#
        );
    }

    #[test]
    fn parses_classification_response_variants() {
        struct Case {
            raw: &'static str,
            expected: &'static [(i64, i64, Confidence)],
        }

        let cases = [
            Case {
                raw: r#"[{"transaction_index":1,"category_id":1,"confidence":"high"},{"transaction_index":2,"category_id":3,"confidence":"medium"}]"#,
                expected: &[(10, 1, Confidence::High), (11, 3, Confidence::Medium)],
            },
            Case {
                raw: "```json\n{\"results\":[{\"transaction_index\":1,\"category_id\":2,\"confidence\":\"high\"}]}\n```",
                expected: &[(10, 2, Confidence::High)],
            },
            Case {
                raw: r#"{"transactions":[{"transaction_index":1,"category_id":2,"confidence":"high"},{"transaction_index":2,"category_id":3,"confidence":"medium"}]}"#,
                expected: &[(10, 2, Confidence::High), (11, 3, Confidence::Medium)],
            },
            Case {
                raw: r#"{"skipped":[{"transaction_index":1,"category_id":3,"confidence":"high"}],"results":[{"transaction_index":1,"category_id":2,"confidence":"high"}]}"#,
                expected: &[(10, 2, Confidence::High)],
            },
            Case {
                raw: r#"{"transaction_index":1,"category_id":1}"#,
                expected: &[(10, 1, Confidence::Medium)],
            },
            Case {
                raw: r#"[{"transaction_index":1,"category_id":4294967296,"confidence":"high"}]"#,
                expected: &[(10, 4_294_967_296, Confidence::High)],
            },
            Case {
                raw: r#"[{"transaction_index":1,"category_id":999,"confidence":"high"},{"transaction_index":2,"category_id":1,"confidence":"medium"}]"#,
                expected: &[(11, 1, Confidence::Medium)],
            },
            Case {
                raw: r#"[{"transaction_index":1,"category_id":0,"confidence":"low"}]"#,
                expected: &[],
            },
            Case {
                raw: r#"[{"transaction_index":99,"category_id":1,"confidence":"high"},{"transaction_index":0,"category_id":1,"confidence":"high"}]"#,
                expected: &[],
            },
            Case {
                raw: r#"[{"transaction_index":1,"category_id":1,"confidence":"high"},{"transaction_index":2,"category_id":2,"confidence":"low"}]"#,
                expected: &[(10, 1, Confidence::High)],
            },
            Case {
                raw: r#"[{"transaction_index":1,"category_id":1,"confidence":"high"},{"transaction_index":1,"category_id":3,"confidence":"low"}]"#,
                expected: &[(10, 1, Confidence::High)],
            },
            Case {
                raw: r#"[{"transaction_index":1,"category_id":1,"confidence":"high"},{"transaction_index":"bad","category_id":2}]"#,
                expected: &[],
            },
            Case {
                raw: "I think this is a grocery store",
                expected: &[],
            },
            Case {
                raw: "[]",
                expected: &[],
            },
        ];

        for case in cases {
            let results = parse_response(case.raw, &transactions(), &parser_categories())
                .into_iter()
                .map(|result| (result.transaction_id, result.category_id, result.confidence))
                .collect::<Vec<_>>();
            assert_eq!(results, case.expected, "{}", case.raw);
        }
    }

    #[test]
    fn rejects_partially_decoded_arrays() {
        assert!(classifications(r#"[{"transaction_index":1,"category_id":1},{"transaction_index":"bad"}]"#).is_err());
    }

    fn categories() -> Vec<CategoryRef> {
        vec![
            CategoryRef {
                id: 1,
                name: "Groceries".to_owned(),
                group_name: "Food & Drink".to_owned(),
            },
            CategoryRef {
                id: 2,
                name: "Coffee Shops".to_owned(),
                group_name: "Food & Drink".to_owned(),
            },
            CategoryRef {
                id: 3,
                name: "Gas".to_owned(),
                group_name: "Transportation".to_owned(),
            },
        ]
    }

    fn parser_categories() -> Vec<CategoryRef> {
        let mut categories = categories();
        categories.push(CategoryRef {
            id: 4_294_967_296,
            name: "Large ID".to_owned(),
            group_name: "Transportation".to_owned(),
        });
        categories
    }

    fn transactions() -> Vec<LlmTransaction> {
        ["Whole Foods", "Shell"]
            .into_iter()
            .enumerate()
            .map(|(index, merchant_name)| LlmTransaction {
                id: 10 + index as i64,
                merchant_name: merchant_name.to_owned(),
                original_name: String::new(),
                amount: Cents(1000),
                plaid_category: String::new(),
                has_pfc2_match: false,
                similar_examples: Vec::new(),
            })
            .collect()
    }
}
