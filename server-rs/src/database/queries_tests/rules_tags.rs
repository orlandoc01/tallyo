use anyhow::Result;

use crate::database::{dbtest, queries};

#[tokio::test]
async fn dynamic_rule_queries_omit_empty_filters() -> Result<()> {
    let pool = dbtest::open().await?;
    let owner_id = sqlx::query_scalar::<_, i64>("INSERT INTO owners (name) VALUES ('Rule owner') RETURNING id")
        .fetch_one(&pool)
        .await?;
    let account_id = sqlx::query_scalar::<_, i64>("INSERT INTO accounts (external_id, owner_id, name, type) VALUES ('rule-account', ?, 'Rule account', 'depository') RETURNING id")
        .bind(owner_id)
        .fetch_one(&pool)
        .await?;
    let rule_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO rules (merchant_pattern, original_pattern, priority) VALUES ('coffee', '', 1) RETURNING id",
    )
    .fetch_one(&pool)
    .await?;
    let other_rule_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO rules (merchant_pattern, original_pattern, priority) VALUES ('tea', '', 0) RETURNING id",
    )
    .fetch_one(&pool)
    .await?;
    let tag_id =
        sqlx::query_scalar::<_, i64>("INSERT INTO tags (name, color) VALUES ('Rule tag', '#000') RETURNING id")
            .fetch_one(&pool)
            .await?;
    sqlx::query("INSERT INTO rule_accounts (rule_id, account_id) VALUES (?, ?)")
        .bind(rule_id)
        .bind(account_id)
        .execute(&pool)
        .await?;
    sqlx::query("INSERT INTO rule_tags (rule_id, tag_id) VALUES (?, ?)")
        .bind(rule_id)
        .bind(tag_id)
        .execute(&pool)
        .await?;
    let transaction_id = sqlx::query_scalar::<_, i64>("INSERT INTO transactions (source, external_id, account_id, amount_cents, datetime, posted_datetime, category_id, merchant_name) VALUES ('test', 'rule-txn', ?, 50, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0, 'Coffee shop') RETURNING id")
        .bind(account_id)
        .fetch_one(&pool)
        .await?;

    assert!(
        queries::accounts_by_rule_ids(&pool, queries::AccountsByRuleIDsParams { rule_ids: &[] },)
            .await?
            .is_empty()
    );
    assert_eq!(
        queries::accounts_by_rule_ids(&pool, queries::AccountsByRuleIDsParams { rule_ids: &[rule_id] },).await?[0]
            .accounts
            .id,
        account_id
    );
    assert_eq!(
        queries::list_rules(&pool, queries::ListRulesParams::default())
            .await?
            .into_iter()
            .map(|row| row.rules.id)
            .collect::<Vec<_>>(),
        [rule_id, other_rule_id]
    );
    assert_eq!(
        queries::list_rules(
            &pool,
            queries::ListRulesParams {
                id: Some(rule_id),
                ..Default::default()
            },
        )
        .await?[0]
            .rules
            .id,
        rule_id
    );
    assert_eq!(
        queries::list_rules(
            &pool,
            queries::ListRulesParams {
                search_match: Some("\"cof\"*"),
                ..Default::default()
            },
        )
        .await?
        .into_iter()
        .map(|row| row.rules.id)
        .collect::<Vec<_>>(),
        [rule_id]
    );
    sqlx::query("UPDATE rules SET merchant_pattern = 'latte' WHERE id = ?")
        .bind(rule_id)
        .execute(&pool)
        .await?;
    assert!(
        queries::list_rules(
            &pool,
            queries::ListRulesParams {
                search_match: Some("\"cof\"*"),
                ..Default::default()
            },
        )
        .await?
        .is_empty()
    );
    sqlx::query("DELETE FROM rules WHERE id = ?")
        .bind(other_rule_id)
        .execute(&pool)
        .await?;
    assert!(
        queries::list_rules(
            &pool,
            queries::ListRulesParams {
                search_match: Some("\"tea\"*"),
                ..Default::default()
            },
        )
        .await?
        .is_empty()
    );
    assert!(
        queries::retroactive_rule_transaction_ids(&pool, queries::RetroactiveRuleTransactionIDsParams::default(),)
            .await?
            .is_empty()
    );
    let account_ids = [account_id];
    assert_eq!(
        queries::retroactive_rule_transaction_ids(
            &pool,
            queries::RetroactiveRuleTransactionIDsParams {
                merchant_pattern: Some("coffee"),
                account_ids: Some(&account_ids),
                ..Default::default()
            },
        )
        .await?[0]
            .id,
        transaction_id
    );
    assert!(
        queries::tags_by_rule_ids(&pool, queries::TagsByRuleIDsParams { rule_ids: &[] },)
            .await?
            .is_empty()
    );
    assert_eq!(
        queries::tags_by_rule_ids(&pool, queries::TagsByRuleIDsParams { rule_ids: &[rule_id] },).await?[0]
            .tags
            .id,
        tag_id
    );
    Ok(())
}

#[tokio::test]
async fn dynamic_tag_queries_omit_empty_slices() -> Result<()> {
    let pool = dbtest::open().await?;
    let owner_id = sqlx::query_scalar::<_, i64>("INSERT INTO owners (name) VALUES ('Tag owner') RETURNING id")
        .fetch_one(&pool)
        .await?;
    let account_id = sqlx::query_scalar::<_, i64>("INSERT INTO accounts (external_id, owner_id, name, type) VALUES ('tag-account', ?, 'Tag account', 'depository') RETURNING id")
        .bind(owner_id)
        .fetch_one(&pool)
        .await?;
    let transaction_id = sqlx::query_scalar::<_, i64>("INSERT INTO transactions (source, external_id, account_id, amount_cents, datetime, posted_datetime, category_id) VALUES ('test', 'tag-txn', ?, 50, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0) RETURNING id")
        .bind(account_id)
        .fetch_one(&pool)
        .await?;
    let tag_id =
        sqlx::query_scalar::<_, i64>("INSERT INTO tags (name, color) VALUES ('Dynamic tag', '#000') RETURNING id")
            .fetch_one(&pool)
            .await?;
    let other_tag_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO tags (name, color) VALUES ('Other dynamic tag', '#111') RETURNING id",
    )
    .fetch_one(&pool)
    .await?;
    queries::add_transaction_tags_by_transaction_ids(
        &pool,
        queries::AddTransactionTagsByTransactionIDsParams {
            tag_ids: &[],
            transaction_ids: &[transaction_id],
        },
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transaction_tags")
            .fetch_one(&pool)
            .await?,
        0
    );
    queries::add_transaction_tags_by_transaction_ids(
        &pool,
        queries::AddTransactionTagsByTransactionIDsParams {
            tag_ids: &[tag_id],
            transaction_ids: &[transaction_id],
        },
    )
    .await?;
    assert!(
        queries::tags_by_transaction_ids(&pool, queries::TagsByTransactionIDsParams { transaction_ids: &[] },)
            .await?
            .is_empty()
    );
    assert_eq!(
        queries::tags_by_transaction_ids(
            &pool,
            queries::TagsByTransactionIDsParams {
                transaction_ids: &[transaction_id],
            },
        )
        .await?[0]
            .tags
            .id,
        tag_id
    );
    assert_eq!(
        queries::list_tags(&pool, queries::ListTagsParams::default())
            .await?
            .into_iter()
            .map(|row| row.id)
            .collect::<Vec<_>>(),
        [tag_id, other_tag_id]
    );
    assert_eq!(
        queries::list_tags(&pool, queries::ListTagsParams { id: Some(tag_id) },).await?[0].id,
        tag_id
    );
    queries::delete_transaction_tags_by_transaction_ids(
        &pool,
        queries::DeleteTransactionTagsByTransactionIDsParams { transaction_ids: &[] },
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transaction_tags")
            .fetch_one(&pool)
            .await?,
        1
    );
    queries::delete_transaction_tags_by_transaction_ids(
        &pool,
        queries::DeleteTransactionTagsByTransactionIDsParams {
            transaction_ids: &[transaction_id],
        },
    )
    .await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM transaction_tags")
            .fetch_one(&pool)
            .await?,
        0
    );
    Ok(())
}
