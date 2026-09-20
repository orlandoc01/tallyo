use anyhow::Result;
use serde_json::json;

use super::{all_scopes, code, global_id, seed};
use crate::ids::GlobalIdType;

#[tokio::test]
async fn budgets_delegate_to_the_service() -> Result<()> {
    let fixture = seed().await?;
    let category_id = sqlx::query_scalar::<_, i64>("SELECT id FROM categories WHERE name = 'Groceries'")
        .fetch_one(&fixture.pool)
        .await?;
    let (data, errors) = fixture
        .execute_with(
            r#"mutation($category: ID!) { setBudget(input: { month: "2026-06", categoryId: $category, amount: 250 }) { budget { id amount category { name } } } }"#,
            all_scopes(),
            json!({"category": global_id(GlobalIdType::Category, category_id)}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["setBudget"]["budget"]["amount"], 250);
    assert_eq!(data["setBudget"]["budget"]["category"]["name"], "Groceries");
    let budget_id = data["setBudget"]["budget"]["id"].as_str().unwrap().to_owned();

    let (data, errors) = fixture
        .execute(
            r#"{ budgetReport(input: { month: "2026-06" }) { month expensesBudgeted sections { label lines { budgeted category { name } } } } budgetReportHistory { items { month expensesBudgeted sections { label } } } }"#,
            all_scopes(),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["budgetReport"]["expensesBudgeted"], 250);
    assert_eq!(data["budgetReportHistory"]["items"].as_array().unwrap().len(), 1);
    assert_eq!(data["budgetReportHistory"]["items"][0]["month"], "2026-06");
    assert_eq!(data["budgetReportHistory"]["items"][0]["expensesBudgeted"], 250);
    assert!(
        !data["budgetReportHistory"]["items"][0]["sections"]
            .as_array()
            .unwrap()
            .is_empty()
    );

    let (data, errors) = fixture
        .execute_with(
            r#"mutation($id: ID!) { copyBudgets(input: { fromMonth: "2026-06", toMonth: "2026-07" }) { copiedCount } deleteBudget(input: { id: $id }) { success } }"#,
            all_scopes(),
            json!({"id": budget_id}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["copyBudgets"]["copiedCount"], 1);
    assert_eq!(data["deleteBudget"]["success"], true);

    let wrong = global_id(GlobalIdType::Owner, 1);
    let (_, errors) = fixture
        .execute_with(
            r#"mutation($wrong: ID!) { setBudget(input: { month: "2026-06", categoryId: $wrong, amount: 1 }) { budget { id } } deleteBudget(input: { id: $wrong }) { success } }"#,
            all_scopes(),
            json!({"wrong": wrong}),
        )
        .await?;
    assert_eq!(errors.len(), 2, "{errors:?}");
    assert!(errors.iter().all(|error| code(error) == "BAD_USER_INPUT"));

    let (_, errors) = fixture
        .execute(
            r#"{ budgetReportHistory(input: { startMonth: "2026-08", endMonth: "2026-07" }) { items { month } } }"#,
            all_scopes(),
        )
        .await?;
    assert_eq!(errors[0].message, "startMonth must be before endMonth");
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");
    Ok(())
}
