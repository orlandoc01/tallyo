use anyhow::Result;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde_json::{Value, json};

use super::{all_scopes, code, global_id, seed};
use crate::{
    auth::Identity,
    graph::Resolver,
    ids::GlobalIdType,
    money::Cents,
    schema::{
        BulkDeleteTransactionsInput, CreateTransactionInput, DateTimeRange, HistoricalNetWorthInput, NetWorthInput,
        NetWorthRange, SpendingFilter, TransactionsFilter, TransactionsInput, UpdateTransactionInput,
    },
    testutil::transactions::transaction,
    transactions::{llm::OllamaCategorizer, store as transactions_store},
};

#[tokio::test]
async fn transaction_reports_execute() -> Result<()> {
    let fixture = seed().await?;
    let staged = transaction(
        &fixture.pool,
        "staged",
        fixture.plaid_account_id,
        0,
        Cents(2345),
        "2026-01-03T12:00:00Z".parse()?,
    )
    .await?;
    sqlx::query("UPDATE transactions SET staged_for_llm = 1 WHERE id = ?")
        .bind(staged)
        .execute(&fixture.pool)
        .await?;
    let (data, errors) = fixture
        .execute_with(
            r#"query($id: ID!) {
                transactions(input: { first: 10 }) { totalCount edges { node { id } } }
                transaction(id: $id) { id }
                transactionsSummary(filter: {}) { totalCount }
                transactionsStagedForCategorization { count }
                spendingByCategory(filter: { datetimeRange: { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" } }) { transactionCount }
                cashFlow(filter: { datetimeRange: { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" } }) { periods { periodLabel } }
            }"#,
            all_scopes(),
            json!({"id": global_id(GlobalIdType::Transaction, fixture.tagged_transaction_id)}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    // Transactions staged for LLM categorization stay out of the lists and reports, as in Go.
    assert_eq!(data["transactions"]["totalCount"], 1);
    assert_eq!(data["transactions"]["edges"].as_array().unwrap().len(), 1);
    assert_eq!(
        data["transaction"]["id"],
        global_id(GlobalIdType::Transaction, fixture.tagged_transaction_id).as_str()
    );
    assert_eq!(data["transactionsSummary"]["totalCount"], 1);
    assert_eq!(data["transactionsStagedForCategorization"]["count"], 1);
    assert_eq!(data["spendingByCategory"]["transactionCount"], 1);
    assert_eq!(data["cashFlow"]["periods"].as_array().unwrap().len(), 1);
    Ok(())
}

#[tokio::test]
async fn transactions_reject_invalid_page_args() -> Result<()> {
    let fixture = seed().await?;
    let cursor = |json: &str| URL_SAFE_NO_PAD.encode(json);
    let valid = cursor(r#"{"datetime":"2026-01-02T00:00:00Z","id":1}"#);
    for (name, input) in [
        ("first and last together", "{first: 1, last: 1}".to_owned()),
        (
            "after and before together",
            format!("{{first: 1, after: {valid:?}, before: {valid:?}}}"),
        ),
        ("non-positive first", "{first: 0}".to_owned()),
        ("non-positive last", "{last: -1}".to_owned()),
        ("first above max", "{first: 100000}".to_owned()),
        (
            "malformed base64 cursor",
            r#"{first: 1, after: "not-valid-base64!!"}"#.to_owned(),
        ),
        (
            "empty cursor object",
            format!("{{first: 1, after: {:?}}}", cursor("{}")),
        ),
        (
            "invalid datetime cursor",
            format!(
                "{{first: 1, after: {:?}}}",
                cursor(r#"{"datetime":"not-a-date","id":1}"#)
            ),
        ),
        (
            "zero id cursor",
            format!(
                "{{first: 1, after: {:?}}}",
                cursor(r#"{"datetime":"2026-01-02T00:00:00Z","id":0}"#)
            ),
        ),
    ] {
        let (data, errors) = fixture
            .execute(
                &format!("{{ transactions(input: {input}) {{ totalCount }} }}"),
                all_scopes(),
            )
            .await?;
        assert_eq!(data, Value::Null, "{name}");
        assert_eq!(errors.len(), 1, "{name}: {errors:?}");
        assert_eq!(code(&errors[0]), "BAD_USER_INPUT", "{name}: {errors:?}");
    }
    Ok(())
}

#[tokio::test]
async fn filter_and_scalar_ids_reject_wrong_types() -> Result<()> {
    let fixture = seed().await?;
    let resolver = fixture.resolver();
    let identity = Identity::with_scopes(all_scopes());
    let owner = global_id(GlobalIdType::Owner, 1);
    let account = global_id(GlobalIdType::Account, 1);
    let filter = |account_ids: Option<Vec<async_graphql::ID>>,
                  owner_ids: Option<Vec<async_graphql::ID>>,
                  category_ids| TransactionsFilter {
        datetime_range: None,
        category_ids,
        account_ids,
        owner_ids,
        is_reviewed: None,
        is_recurring: None,
        is_pending: None,
        is_hidden: None,
        merchant_prefix: None,
        original_prefix: None,
        exclude_transfers: None,
        exclude_income: None,
        amount_min: None,
        amount_max: None,
        exact_amount: None,
        tag_ids: None,
        untagged: None,
        search: None,
    };
    let spending = |category_ids: Option<Vec<async_graphql::ID>>, owner_ids| SpendingFilter {
        datetime_range: DateTimeRange { from: None, to: None },
        granularity: None,
        category_ids,
        owner_ids,
        account_ids: None,
        is_hidden: None,
        tag_ids: None,
        untagged: None,
    };
    let transactions_input = |filter| TransactionsInput {
        filter: Some(filter),
        sort: None,
        first: None,
        after: None,
        last: None,
        before: None,
    };
    let failures: Vec<(&str, anyhow::Error)> = vec![
        (
            "transactions account",
            resolver
                .transactions(Some(transactions_input(filter(Some(vec![owner.clone()]), None, None))))
                .await
                .unwrap_err(),
        ),
        (
            "transactions owner",
            resolver
                .transactions(Some(transactions_input(filter(
                    None,
                    Some(vec![account.clone()]),
                    None,
                ))))
                .await
                .unwrap_err(),
        ),
        (
            "transactions category",
            resolver
                .transactions(Some(transactions_input(filter(
                    None,
                    None,
                    Some(vec![account.clone()]),
                ))))
                .await
                .unwrap_err(),
        ),
        (
            "summary category",
            resolver
                .transactions_summary(Some(filter(None, None, Some(vec![account.clone()]))))
                .await
                .unwrap_err(),
        ),
        (
            "bulk delete account",
            resolver
                .bulk_delete_transactions(BulkDeleteTransactionsInput {
                    transaction_ids: None,
                    filter: Some(filter(Some(vec![owner.clone()]), None, None)),
                })
                .await
                .unwrap_err(),
        ),
        (
            "bulk delete ids",
            resolver
                .bulk_delete_transactions(BulkDeleteTransactionsInput {
                    transaction_ids: Some(vec![owner.clone()]),
                    filter: None,
                })
                .await
                .unwrap_err(),
        ),
        (
            "spending category",
            resolver
                .spending_by_category(&identity, spending(Some(vec![account.clone()]), None))
                .await
                .unwrap_err(),
        ),
        (
            "cash flow owner",
            resolver
                .cash_flow(&identity, spending(None, Some(vec![account.clone()])))
                .await
                .unwrap_err(),
        ),
        (
            "net worth owner",
            resolver
                .net_worth(NetWorthInput {
                    owner_ids: Some(vec![account.clone()]),
                    account_ids: None,
                    as_of_date: None,
                })
                .await
                .unwrap_err(),
        ),
        (
            "net worth account",
            resolver
                .net_worth(NetWorthInput {
                    owner_ids: None,
                    account_ids: Some(vec![owner.clone()]),
                    as_of_date: None,
                })
                .await
                .unwrap_err(),
        ),
        (
            "historical owner",
            resolver
                .historical_net_worth(HistoricalNetWorthInput {
                    range: NetWorthRange::OneMonth,
                    granularity: None,
                    filters: Some(NetWorthInput {
                        owner_ids: Some(vec![account.clone()]),
                        account_ids: None,
                        as_of_date: None,
                    }),
                })
                .await
                .unwrap_err(),
        ),
        ("transaction", resolver.transaction(&owner).await.unwrap_err()),
        (
            "update transaction",
            resolver
                .update_transaction(UpdateTransactionInput {
                    id: owner.clone(),
                    updates: super::updates(),
                })
                .await
                .unwrap_err(),
        ),
        (
            "delete transaction",
            resolver.delete_transaction(&owner).await.unwrap_err(),
        ),
        (
            "create transaction account",
            resolver
                .create_transaction(CreateTransactionInput {
                    account_id: owner.clone(),
                    date: crate::ids::Date::new("2026-01-02")?,
                    amount: Cents(100),
                    merchant_name: None,
                    original_name: None,
                    category_id: None,
                    notes: None,
                    is_recurring: None,
                    is_hidden: None,
                })
                .await
                .unwrap_err(),
        ),
        ("account query", resolver.account(&owner).await.unwrap_err()),
    ];
    assert_public_errors(&failures);
    Ok(())
}

pub(super) fn assert_public_errors(failures: &[(&str, anyhow::Error)]) {
    for (name, error) in failures {
        let public = error
            .chain()
            .any(|cause| cause.downcast_ref::<crate::apierror::ApiError>().is_some());
        assert!(public, "{name}: {error:?} is not a public boundary error");
    }
}

#[tokio::test]
async fn transaction_mutations_execute() -> Result<()> {
    let fixture = seed().await?;
    let account = global_id(GlobalIdType::Account, fixture.plaid_account_id);
    let shopping_id = sqlx::query_scalar::<_, i64>("SELECT id FROM categories WHERE name = 'Groceries'")
        .fetch_one(&fixture.pool)
        .await?;
    let shopping = global_id(GlobalIdType::Category, shopping_id);
    let (data, errors) = fixture
        .execute_with(
            r#"mutation($account: ID!, $category: ID!) {
                createTransaction(input: { accountId: $account, date: "2026-01-05", amount: 12.34, merchantName: "Manual Store", categoryId: $category }) {
                    transaction { id merchantName amount account { id } category { name } }
                }
            }"#,
            all_scopes(),
            json!({"account": account, "category": shopping}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    let created = &data["createTransaction"]["transaction"];
    assert_eq!(created["merchantName"], "Manual Store");
    assert_eq!(created["amount"], 12.34);
    assert_eq!(created["account"]["id"], account.as_str());
    assert_eq!(created["category"]["name"], "Groceries");
    let created_id = created["id"].as_str().unwrap().to_owned();

    let existing = global_id(GlobalIdType::Transaction, fixture.tagged_transaction_id);
    let (data, errors) = fixture
        .execute_with(
            r#"mutation($id: ID!, $category: ID!, $tag: ID!, $ids: [ID!]!) {
                updateTransaction(input: { id: $id, updates: { categoryId: $category, merchantName: "Updated Store", notes: "memo", tagIds: [$tag] } }) {
                    transaction { merchantName notes tags { name } }
                }
                bulkUpdateTransactions(input: { transactionIds: $ids, updates: { categoryId: $category } }) { updatedCount }
            }"#,
            all_scopes(),
            json!({"id": existing, "category": shopping, "tag": global_id(GlobalIdType::Tag, fixture.tag_id), "ids": [existing, created_id]}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        data["updateTransaction"]["transaction"],
        json!({"merchantName": "Updated Store", "notes": "memo", "tags": [{"name": "Household"}]})
    );
    assert_eq!(data["bulkUpdateTransactions"]["updatedCount"], 2);

    let (data, errors) = fixture
        .execute_with(
            "mutation($id: ID!, $ids: [ID!]!) { deleteTransaction(id: $id) { success } bulkDeleteTransactions(input: { transactionIds: $ids }) { deletedCount } }",
            all_scopes(),
            json!({"id": created_id, "ids": [existing]}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["deleteTransaction"]["success"], true);
    assert_eq!(data["bulkDeleteTransactions"]["deletedCount"], 1);
    assert_eq!(
        transactions_store::transactions_summary(&fixture.pool, None)
            .await?
            .total_count,
        0
    );

    let (_, errors) = fixture
        .execute_with(
            "mutation($id: ID!) { updateTransaction(input: { id: $id, updates: { notes: \"gone\" } }) { transaction { id } } }",
            all_scopes(),
            json!({"id": existing}),
        )
        .await?;
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].message, "transaction not found");
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");
    Ok(())
}

#[tokio::test]
async fn rules_tags_categories_and_owners_execute() -> Result<()> {
    let fixture = seed().await?;
    let account = global_id(GlobalIdType::Account, fixture.plaid_account_id);
    let (data, errors) = fixture
        .execute_with(
            r##"mutation($account: ID!) {
                createTag(input: { name: "Work", color: "#3B82F6" }) { tag { id name } }
                createCategoryGroup(input: { name: "Transport", emoji: "car", kind: EXPENSE }) { group { id name } }
                createOwner(input: { name: "temporary" }) { id name }
                createRule(input: { merchantPattern: "store", changes: { merchantName: "Store" }, accountIds: [$account] }) { rule { id merchantPattern accounts { name } } retroactivelyUpdated }
            }"##,
            all_scopes(),
            json!({"account": account}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    let tag = data["createTag"]["tag"]["id"].as_str().unwrap().to_owned();
    let group = data["createCategoryGroup"]["group"]["id"].as_str().unwrap().to_owned();
    let owner = data["createOwner"]["id"].as_str().unwrap().to_owned();
    let rule = data["createRule"]["rule"]["id"].as_str().unwrap().to_owned();
    assert_eq!(data["createRule"]["rule"]["accounts"], json!([{"name": "Checking"}]));

    let (data, errors) = fixture
        .execute_with(
            r##"mutation($tag: ID!, $group: ID!, $rule: ID!, $account: ID!) {
                updateTag(input: { id: $tag, name: "Travel", color: "#22C55E" }) { tag { name } }
                updateCategoryGroup(input: { id: $group, name: "Travel", emoji: "plane" }) { group { name } }
                createCategory(input: { name: "Train", emoji: "train", groupId: $group }) { category { id name } }
                updateRule(input: { id: $rule, merchantPattern: "store", changes: { merchantName: "Store", tagIds: [$tag] }, accountIds: [$account] }) { rule { tags { name } } }
            }"##,
            all_scopes(),
            json!({"tag": tag, "group": group, "rule": rule, "account": account}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["updateTag"]["tag"]["name"], "Travel");
    assert_eq!(data["updateCategoryGroup"]["group"]["name"], "Travel");
    assert_eq!(data["updateRule"]["rule"]["tags"], json!([{"name": "Travel"}]));
    let category = data["createCategory"]["category"]["id"].as_str().unwrap().to_owned();

    let (data, errors) = fixture
        .execute_with(
            r#"mutation($category: ID!, $group: ID!) {
                updateCategory(input: { id: $category, name: "Metro", emoji: "metro", groupId: $group }) { category { name } }
                reorderCategories(input: { groupId: $group, categoryIds: [$category] }) { group { categories { name } } }
            }"#,
            all_scopes(),
            json!({"category": category, "group": group}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["updateCategory"]["category"]["name"], "Metro");
    assert_eq!(
        data["reorderCategories"]["group"]["categories"],
        json!([{"name": "Metro"}])
    );

    let (data, errors) = fixture
        .execute(
            "{ categories { items { name } } categoryGroups { items { name } } tags { items { name } } rules(input: { merchantPattern: \"store\" }) { items { merchantPattern } } plaidPFC2Codes recurringCharges { items { id } } owners { items { name } } }",
            all_scopes(),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert!(
        data["categories"]["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|category| category["name"] == "Metro")
    );
    assert!(
        data["categoryGroups"]["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|group| group["name"] == "Travel")
    );
    assert_eq!(data["tags"]["items"].as_array().unwrap().len(), 2);
    assert_eq!(data["rules"]["items"], json!([{"merchantPattern": "store"}]));
    assert!(data["plaidPFC2Codes"].as_array().unwrap().len() > 10);
    assert_eq!(data["recurringCharges"]["items"], json!([]));
    assert_eq!(data["owners"]["items"].as_array().unwrap().len(), 2);

    let (data, errors) = fixture
        .execute(
            "{ rules(input: { search: \"store\" }) { items { merchantPattern } } }",
            all_scopes(),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["rules"]["items"], json!([{"merchantPattern": "store"}]));

    let (data, errors) = fixture
        .execute_with(
            r#"mutation($tag: ID!, $group: ID!, $category: ID!, $rule: ID!, $owner: ID!) {
                deleteRule(id: $rule) { success }
                deleteCategory(id: $category) { success }
                deleteCategoryGroup(id: $group) { success }
                deleteTag(id: $tag) { success }
                deleteOwner(id: $owner)
            }"#,
            all_scopes(),
            json!({"tag": tag, "group": group, "category": category, "rule": rule, "owner": owner}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        data,
        json!({"deleteRule": {"success": true}, "deleteCategory": {"success": true}, "deleteCategoryGroup": {"success": true}, "deleteTag": {"success": true}, "deleteOwner": true})
    );
    Ok(())
}

#[tokio::test]
async fn reprocess_uncategorized_requires_an_enabled_llm() -> Result<()> {
    let fixture = seed().await?;
    let (data, errors) = fixture
        .execute(
            "mutation { reprocessUncategorizedTransactions { stagedCount } }",
            all_scopes(),
        )
        .await?;
    assert_eq!(data, Value::Null);
    assert_eq!(errors[0].message, "LLM categorization is not enabled");
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");
    assert_eq!(transactions_store::llm_store::count_staged(&fixture.pool).await?, 0);

    let resolver = fixture.resolver();
    resolver
        .syncer
        .set_llm(Some(
            OllamaCategorizer::new(&fixture.pool, "http://localhost:11434", "test").await?,
        ))
        .await?;
    let response = crate::graph::build_schema(resolver)
        .execute(super::request(
            "mutation { reprocessUncategorizedTransactions { stagedCount } }",
            all_scopes(),
        ))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json()?["reprocessUncategorizedTransactions"]["stagedCount"],
        1
    );
    assert_eq!(transactions_store::llm_store::count_staged(&fixture.pool).await?, 1);
    Ok(())
}

#[tokio::test]
async fn analysis_decodes_filters_and_rejects_wrong_ids() -> Result<()> {
    let fixture = seed().await?;
    let (data, errors) = fixture
        .execute_with(
            "query($owner: ID!, $account: ID!) { analysis(input: { view: SECTORS, ownerIds: [$owner], accountIds: [$account], accountSubtypes: [\"401k\"], includeUnclassified: true }) { view totalValueUSD slices { label } } }",
            all_scopes(),
            json!({"owner": global_id(GlobalIdType::Owner, fixture.owner.id), "account": global_id(GlobalIdType::Account, fixture.plaid_account_id)}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["analysis"]["view"], "SECTORS");

    let (_, errors) = fixture
        .execute_with(
            "query($owner: ID!) { analysis(input: { view: COMPOSITION, ownerIds: [$owner] }) { view } }",
            all_scopes(),
            json!({"owner": global_id(GlobalIdType::Account, 1)}),
        )
        .await?;
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");
    let _: &Resolver = &fixture.resolver();
    Ok(())
}
