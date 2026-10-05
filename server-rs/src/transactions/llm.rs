use std::{collections::HashMap, fmt::Write};

use anyhow::Result;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    clients::ollama::{GenerationOptions, OllamaClient},
    money::Cents,
    schema::CategoryKind,
};

#[derive(Clone)]
pub struct OllamaCategorizer {
    client: OllamaClient,
    categories: Vec<CategoryRef>,
}

impl OllamaCategorizer {
    #[cfg(test)]
    pub(crate) async fn new(
        pool: &sqlx::SqlitePool,
        base_url: impl Into<String>,
        model: impl Into<String>,
        options: GenerationOptions,
    ) -> Result<Self> {
        Self::with_categories(
            base_url,
            model,
            options,
            crate::transactions::store::llm_store::categories_for_llm(pool).await?,
        )
    }

    pub(crate) fn with_categories(
        base_url: impl Into<String>,
        model: impl Into<String>,
        options: GenerationOptions,
        categories: Vec<CategoryRef>,
    ) -> Result<Self> {
        Ok(Self {
            client: OllamaClient::new(base_url, model, options)?,
            categories,
        })
    }

    pub(crate) fn batch_size(&self) -> usize {
        self.client.options.batch_size
    }

    pub(crate) fn category_count(&self) -> usize {
        self.categories.len()
    }

    pub(crate) fn system_prompt(&self, global_examples: &[ExampleTransaction]) -> String {
        build_system_prompt(&self.categories, global_examples)
    }

    pub(crate) async fn categorize_batch(
        &self,
        system_prompt: &str,
        transactions: &[LlmTransaction],
    ) -> Result<Vec<LlmResult>> {
        if transactions.is_empty() {
            return Ok(Vec::new());
        }
        let schema = build_schema(&self.categories, transactions.len());
        let response = self
            .client
            .generate(system_prompt, &build_batch_prompt(transactions), &schema)
            .await?;
        Ok(parse_response(&response, transactions, &self.categories))
    }
}

#[derive(Clone, Debug)]
pub(crate) struct CategoryRef {
    pub(crate) id: i64,
    pub(crate) name: String,
    pub(crate) group_name: String,
    pub(crate) group_kind: CategoryKind,
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

impl LlmTransaction {
    pub(crate) fn display_name(&self) -> &str {
        if self.merchant_name.is_empty() { &self.original_name } else { &self.merchant_name }
    }
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

fn build_system_prompt(categories: &[CategoryRef], global_examples: &[ExampleTransaction]) -> String {
    let mut prompt = String::from(
        "You are a personal finance transaction categorizer. Classify each transaction into exactly one category from the list below.\n\nCATEGORIES (id | group | name):\n",
    );
    let mut current_group = "";
    for category in categories {
        if category.group_name != current_group {
            current_group = &category.group_name;
            let _ = write!(prompt, "\n[{}] ({})\n", category.group_name, category.group_kind);
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
        "\nIMPORTANT RULES:\n- Use the exact category ID from the list above.\n- If you are not confident, set confidence to \"low\".\n- If you truly cannot determine a category, use category_id: 0.\n- plaid_hint is a hint only — it may be wrong. Prefer merchant name over plaid_hint.\n- Amount sign: positive = money spent, negative = money received (refund, income, or an incoming transfer).\n- Paychecks, interest, dividends → an INCOME category. Credit card payments and moves between own accounts → a TRANSFER category.\n",
    );
    prompt
}

fn build_batch_prompt(transactions: &[LlmTransaction]) -> String {
    let mut prompt = String::from("TRANSACTIONS TO CLASSIFY:\n");
    for (index, transaction) in transactions.iter().enumerate() {
        let display_name = transaction.display_name();
        let _ = write!(prompt, "\n{}. merchant: {:?}", index + 1, display_name);
        if !transaction.original_name.is_empty() && transaction.original_name != display_name {
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
                let _ = write!(prompt, " {:?}", example.merchant_name);
                if let Some(amount) = example.amount {
                    let _ = write!(prompt, " ${:.2}", amount.dollars());
                }
                let _ = write!(prompt, "→{} (ID: {})", example.category_name, example.category_id);
            }
            prompt.push(')');
        }
    }
    prompt.push('\n');
    prompt
}

// Stays within the schema subset both Ollama and Anthropic structured outputs accept.
fn build_schema(categories: &[CategoryRef], batch_len: usize) -> Value {
    let category_ids = std::iter::once(0)
        .chain(categories.iter().map(|category| category.id).filter(|&id| id != 0))
        .collect::<Vec<_>>();
    json!({
        "type": "object",
        "properties": {
            "classifications": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "transaction_index": {"type": "integer", "enum": (1..=batch_len).collect::<Vec<_>>()},
                        "category_id": {"type": "integer", "enum": category_ids},
                        "confidence": {"type": "string", "enum": ["high", "medium", "low"]}
                    },
                    "required": ["transaction_index", "category_id", "confidence"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["classifications"],
        "additionalProperties": false
    })
}

#[derive(Deserialize)]
struct Classifications {
    classifications: Vec<Classification>,
}

#[derive(Deserialize)]
struct Classification {
    transaction_index: usize,
    category_id: i64,
    confidence: String,
}

fn parse_response(raw: &str, transactions: &[LlmTransaction], categories: &[CategoryRef]) -> Vec<LlmResult> {
    let category_names = categories
        .iter()
        .map(|category| (category.id, category.name.as_str()))
        .collect::<HashMap<_, _>>();
    let classifications = match serde_json::from_str::<Classifications>(raw) {
        Ok(response) => response.classifications,
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

fn confidence(value: &str) -> Confidence {
    match value.to_lowercase().as_str() {
        "high" => Confidence::High,
        "low" => Confidence::Low,
        _ => Confidence::Medium,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        CategoryRef, Confidence, ExampleTransaction, LlmTransaction, build_batch_prompt, build_schema,
        build_system_prompt, parse_response,
    };
    use crate::{money::Cents, schema::CategoryKind};

    const SYSTEM_PROMPT: &str = r#"You are a personal finance transaction categorizer. Classify each transaction into exactly one category from the list below.

CATEGORIES (id | group | name):

[Food & Drink] (EXPENSE)
  1 | Groceries
  2 | Coffee Shops

[Transportation] (EXPENSE)
  3 | Gas

[Income] (INCOME)
  4 | Paychecks

[Transfers] (TRANSFER)
  5 | Transfer

EXAMPLES FROM YOUR TRANSACTION HISTORY:
  "Whole Foods" → Groceries (ID: 1)

IMPORTANT RULES:
- Use the exact category ID from the list above.
- If you are not confident, set confidence to "low".
- If you truly cannot determine a category, use category_id: 0.
- plaid_hint is a hint only — it may be wrong. Prefer merchant name over plaid_hint.
- Amount sign: positive = money spent, negative = money received (refund, income, or an incoming transfer).
- Paychecks, interest, dividends → an INCOME category. Credit card payments and moves between own accounts → a TRANSFER category.
"#;

    const BATCH_PROMPT: &str = r#"TRANSACTIONS TO CLASSIFY:

1. merchant: "Amazon", raw_name: "AMAZON MKTPLACE", amount: $34.50, plaid_hint: "SHOPPING"
   (past categorized: "Amazon" $9.99→Coffee Shops (ID: 2))
"#;

    #[test]
    fn builds_the_system_and_batch_prompts() {
        let system = build_system_prompt(
            &categories(),
            &[ExampleTransaction {
                merchant_name: "Whole Foods".to_owned(),
                amount: None,
                category_id: 1,
                category_name: "Groceries".to_owned(),
            }],
        );
        let batch = build_batch_prompt(&[LlmTransaction {
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
        }]);

        assert_eq!(system, SYSTEM_PROMPT);
        assert_eq!(batch, BATCH_PROMPT);
    }

    #[test]
    fn batch_prompt_falls_back_to_the_raw_name_when_the_merchant_is_blank() {
        let batch = build_batch_prompt(&[LlmTransaction {
            id: 10,
            merchant_name: String::new(),
            original_name: "ANDON LABS".to_owned(),
            amount: Cents(1200),
            plaid_category: String::new(),
            has_pfc2_match: false,
            similar_examples: Vec::new(),
        }]);
        assert_eq!(
            batch,
            "TRANSACTIONS TO CLASSIFY:\n\n1. merchant: \"ANDON LABS\", amount: $12.00\n"
        );
    }

    #[test]
    fn builds_a_schema_enumerating_indexes_and_category_ids() {
        assert_eq!(
            build_schema(&categories(), 2),
            json!({
                "type": "object",
                "properties": {
                    "classifications": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "transaction_index": {"type": "integer", "enum": [1, 2]},
                                "category_id": {"type": "integer", "enum": [0, 1, 2, 3, 4, 5]},
                                "confidence": {"type": "string", "enum": ["high", "medium", "low"]}
                            },
                            "required": ["transaction_index", "category_id", "confidence"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["classifications"],
                "additionalProperties": false
            })
        );
    }

    #[test]
    fn schema_dedupes_the_zero_sentinel_against_an_id_zero_category() {
        let mut categories = categories();
        categories.push(CategoryRef {
            id: 0,
            name: "uncategorized".to_owned(),
            group_name: "Other".to_owned(),
            group_kind: CategoryKind::Expense,
        });
        let schema = build_schema(&categories, 1);
        let ids = &schema["properties"]["classifications"]["items"]["properties"]["category_id"]["enum"];
        assert_eq!(*ids, json!([0, 1, 2, 3, 4, 5]));
    }

    #[test]
    fn parses_classification_response_variants() {
        struct Case {
            raw: &'static str,
            expected: &'static [(i64, i64, Confidence)],
        }

        let cases = [
            Case {
                raw: r#"{"classifications":[{"transaction_index":1,"category_id":1,"confidence":"high"},{"transaction_index":2,"category_id":3,"confidence":"medium"}]}"#,
                expected: &[(10, 1, Confidence::High), (11, 3, Confidence::Medium)],
            },
            Case {
                raw: r#"{"classifications":[{"transaction_index":1,"category_id":1,"confidence":"High"}]}"#,
                expected: &[(10, 1, Confidence::High)],
            },
            Case {
                raw: r#"{"classifications":[{"transaction_index":1,"category_id":4294967296,"confidence":"high"}]}"#,
                expected: &[(10, 4_294_967_296, Confidence::High)],
            },
            Case {
                raw: r#"{"classifications":[{"transaction_index":1,"category_id":999,"confidence":"high"},{"transaction_index":2,"category_id":1,"confidence":"medium"}]}"#,
                expected: &[(11, 1, Confidence::Medium)],
            },
            Case {
                raw: r#"{"classifications":[{"transaction_index":1,"category_id":0,"confidence":"low"}]}"#,
                expected: &[],
            },
            Case {
                raw: r#"{"classifications":[{"transaction_index":99,"category_id":1,"confidence":"high"},{"transaction_index":0,"category_id":1,"confidence":"high"}]}"#,
                expected: &[],
            },
            Case {
                raw: r#"{"classifications":[{"transaction_index":1,"category_id":1,"confidence":"high"},{"transaction_index":2,"category_id":2,"confidence":"low"}]}"#,
                expected: &[(10, 1, Confidence::High)],
            },
            Case {
                raw: r#"{"classifications":[{"transaction_index":1,"category_id":1,"confidence":"low"},{"transaction_index":1,"category_id":3,"confidence":"medium"}]}"#,
                expected: &[(10, 3, Confidence::Medium)],
            },
            Case {
                raw: r#"{"classifications":[{"transaction_index":1,"category_id":1,"confidence":"high"},{"transaction_index":"bad","category_id":2}]}"#,
                expected: &[],
            },
            Case {
                raw: r#"{"classifications":[{"transaction_index":1,"category_id":1}]}"#,
                expected: &[],
            },
            Case {
                raw: r#"[{"transaction_index":1,"category_id":1,"confidence":"high"}]"#,
                expected: &[],
            },
            Case {
                raw: "```json\n{\"classifications\":[{\"transaction_index\":1,\"category_id\":2,\"confidence\":\"high\"}]}\n```",
                expected: &[],
            },
            Case {
                raw: "I think this is a grocery store",
                expected: &[],
            },
            Case {
                raw: r#"{"classifications":[]}"#,
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

    fn categories() -> Vec<CategoryRef> {
        [
            (1, "Groceries", "Food & Drink", CategoryKind::Expense),
            (2, "Coffee Shops", "Food & Drink", CategoryKind::Expense),
            (3, "Gas", "Transportation", CategoryKind::Expense),
            (4, "Paychecks", "Income", CategoryKind::Income),
            (5, "Transfer", "Transfers", CategoryKind::Transfer),
        ]
        .into_iter()
        .map(|(id, name, group_name, group_kind)| CategoryRef {
            id,
            name: name.to_owned(),
            group_name: group_name.to_owned(),
            group_kind,
        })
        .collect()
    }

    fn parser_categories() -> Vec<CategoryRef> {
        let mut categories = categories();
        categories.push(CategoryRef {
            id: 4_294_967_296,
            name: "Large ID".to_owned(),
            group_name: "Transportation".to_owned(),
            group_kind: CategoryKind::Expense,
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
