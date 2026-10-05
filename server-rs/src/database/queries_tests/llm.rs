use std::collections::HashSet;

use anyhow::Result;

use crate::{
    database::dbtest,
    schema::CategoryKind,
    testutil::transactions::account,
    transactions::store::llm_store::{
        categories_for_llm, similar_examples_by_key, similar_merchant_key, top_merchant_examples,
    },
};

#[tokio::test]
async fn llm_queries_cover_every_kind_and_exclude_uncategorized() -> Result<()> {
    let pool = dbtest::open().await?;
    let categories = categories_for_llm(&pool).await?;
    assert!(categories.iter().all(|category| category.id != 0));
    for kind in [CategoryKind::Expense, CategoryKind::Income, CategoryKind::Transfer] {
        assert!(categories.iter().any(|category| category.group_kind == kind), "{kind}");
    }
    let mut group_runs = categories
        .iter()
        .map(|category| category.group_name.as_str())
        .collect::<Vec<_>>();
    group_runs.dedup();
    let unique_groups = group_runs.iter().collect::<HashSet<_>>();
    assert_eq!(
        group_runs.len(),
        unique_groups.len(),
        "group names must be contiguous: {group_runs:?}"
    );

    let income_id = categories
        .iter()
        .find(|category| category.group_kind == CategoryKind::Income)
        .expect("seeded income category")
        .id;
    let expense_id = categories
        .iter()
        .find(|category| category.group_kind == CategoryKind::Expense)
        .expect("seeded expense category")
        .id;
    let account_id = account(&pool, "checking").await?;
    sqlx::query("INSERT INTO transactions (source, external_id, account_id, merchant_name, original_name, amount_cents, datetime, posted_datetime, category_id, is_reviewed) VALUES ('test', 'pay-0', ?, 'Payroll', 'Payroll', -1000, '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z', 0, 1), ('test', 'pay-1', ?, 'Payroll', 'Payroll', -1000, '2020-01-02T00:00:00Z', '2020-01-02T00:00:00Z', ?, 1), ('test', 'goog-0', ?, 'GOOGLE *Storage', 'GOOGLE *Storage', 199, '2020-01-03T00:00:00Z', '2020-01-03T00:00:00Z', ?, 1), ('test', 'andon-0', ?, '', 'ANDON LABS', 1200, '2020-01-04T00:00:00Z', '2020-01-04T00:00:00Z', ?, 1), ('test', 'fetch-0', ?, '*Fetch', '*Fetch', 500, '2020-01-05T00:00:00Z', '2020-01-05T00:00:00Z', ?, 1), ('test', 'goog-1', ?, 'Google Play', 'Google Play', 299, '2020-01-06T00:00:00Z', '2020-01-06T00:00:00Z', ?, 1), ('test', 'goog-2', ?, 'Google Play', 'Google Play', 399, '2020-01-07T00:00:00Z', '2020-01-07T00:00:00Z', ?, 1), ('test', 'goog-3', ?, 'Google Play', 'Google Play', 499, '2020-01-02T00:00:00Z', '2020-01-02T00:00:00Z', ?, 1), ('test', 'blank-0', ?, '', NULL, 100, '2020-01-08T00:00:00Z', '2020-01-08T00:00:00Z', ?, 1), ('test', 'sq-0', ?, 'SQ_*PAYPAL', 'SQ_*PAYPAL', 700, '2020-01-09T00:00:00Z', '2020-01-09T00:00:00Z', ?, 1)")
        .bind(account_id)
        .bind(account_id)
        .bind(income_id)
        .bind(account_id)
        .bind(expense_id)
        .bind(account_id)
        .bind(expense_id)
        .bind(account_id)
        .bind(expense_id)
        .bind(account_id)
        .bind(expense_id)
        .bind(account_id)
        .bind(expense_id)
        .bind(account_id)
        .bind(expense_id)
        .bind(account_id)
        .bind(expense_id)
        .bind(account_id)
        .bind(expense_id)
        .execute(&pool)
        .await?;

    let top = top_merchant_examples(&pool, 10).await?;
    let mut top_merchants = top
        .iter()
        .map(|example| (example.merchant_name.as_str(), example.category_id))
        .collect::<Vec<_>>();
    top_merchants.sort_unstable();
    assert_eq!(
        top_merchants,
        [
            ("*Fetch", expense_id),
            ("ANDON LABS", expense_id),
            ("GOOGLE *Storage", expense_id),
            ("Google Play", expense_id),
            ("Payroll", income_id),
            ("SQ_*PAYPAL", expense_id)
        ]
    );
    let similar = similar_examples_by_key(
        &pool,
        &["Payroll", "Google", "Andon Labs", "*Fetch", "", "SQ_*PAYPAL", "sqa"].map(similar_merchant_key),
    )
    .await?;
    let mut keys = similar.keys().map(String::as_str).collect::<Vec<_>>();
    keys.sort_unstable();
    assert_eq!(keys, ["*fetch", "andon", "google", "payroll", "sq_*paypal"]);
    assert_eq!(
        similar["sq_*paypal"]
            .iter()
            .map(|example| example.merchant_name.as_str())
            .collect::<Vec<_>>(),
        ["SQ_*PAYPAL"]
    );
    assert_eq!(
        similar["*fetch"]
            .iter()
            .map(|example| example.merchant_name.as_str())
            .collect::<Vec<_>>(),
        ["*Fetch"]
    );
    assert_eq!(
        similar["payroll"]
            .iter()
            .map(|example| example.category_id)
            .collect::<Vec<_>>(),
        [income_id]
    );
    assert_eq!(
        similar["google"]
            .iter()
            .map(|example| (example.merchant_name.as_str(), example.amount.map(|cents| cents.0)))
            .collect::<Vec<_>>(),
        [
            ("Google Play", Some(399)),
            ("Google Play", Some(299)),
            ("GOOGLE *Storage", Some(199))
        ]
    );
    assert_eq!(
        similar["andon"]
            .iter()
            .map(|example| (example.merchant_name.as_str(), example.category_id))
            .collect::<Vec<_>>(),
        [("ANDON LABS", expense_id)]
    );
    Ok(())
}
