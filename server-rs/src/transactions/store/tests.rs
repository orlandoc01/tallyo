use anyhow::Result;
use async_graphql::ID;

use super::*;
use crate::{
    ids::{GlobalId, GlobalIdType},
    money::Cents,
    schema::{CategoryKind, DateTimeRange, Granularity, SpendingFilter, TransactionUpdates},
    testutil::transactions::{account, category, transaction},
    transactions::SpendingMode,
};

#[tokio::test]
async fn spending_and_cash_flow_keep_income_and_expenses_separate() -> Result<()> {
    let pool = crate::database::dbtest::open().await?;
    let account_id = account(&pool, "spending-account").await?;
    let expense = category(&pool, "Spending food", CategoryKind::Expense).await?;
    let income = category(&pool, "Spending salary", CategoryKind::Income).await?;
    transaction(
        &pool,
        "food",
        account_id,
        expense.id,
        Cents(250),
        "2026-01-03T12:00:00Z".parse()?,
    )
    .await?;
    transaction(
        &pool,
        "salary",
        account_id,
        income.id,
        Cents(-1000),
        "2026-01-04T12:00:00Z".parse()?,
    )
    .await?;
    let filter = SpendingFilter {
        datetime_range: DateTimeRange {
            from: Some("2026-01-01T00:00:00Z".parse()?),
            to: Some("2026-02-01T00:00:00Z".parse()?),
        },
        granularity: Some(Granularity::Monthly),
        category_ids: None,
        owner_ids: None,
        account_ids: None,
        is_hidden: None,
        tag_ids: None,
        untagged: None,
    };
    let rows = spending_rows(
        &pool,
        &filter,
        SpendingMode {
            by_category: false,
            exclude_income: true,
        },
        chrono_tz::UTC,
    )
    .await?;
    assert_eq!((rows.len(), rows[0].total_amount), (1, Cents(250)));
    let report = cash_flow(&pool, &filter, chrono_tz::UTC).await?;
    assert_eq!(
        (
            report.periods[0].summary.income,
            report.periods[0].summary.expenses,
            report.periods[0].summary.savings,
        ),
        (Cents(1000), Cents(250), Cents(750))
    );
    Ok(())
}

#[tokio::test]
async fn transaction_reads_hydrate_replaced_tags() -> Result<()> {
    let pool = crate::database::dbtest::open().await?;
    let account_id = account(&pool, "tagged-account").await?;
    let transaction_id = transaction(
        &pool,
        "tagged",
        account_id,
        0,
        Cents(100),
        "2026-01-01T12:00:00Z".parse()?,
    )
    .await?;
    let tag = create_tag(&pool, "Household", "#AABBCC").await?;
    let transaction = update_transaction(
        &pool,
        transaction_id,
        &TransactionUpdates {
            merchant_name: None,
            notes: None,
            is_recurring: None,
            is_hidden: None,
            category_id: None,
            tag_ids: Some(vec![ID::from(
                GlobalId::new(GlobalIdType::Tag, tag.id).encoded_string(),
            )]),
        },
    )
    .await?;
    let tags = tags_by_transaction_ids(&pool, &[transaction.id]).await?;
    assert_eq!(tags[&transaction.id][0].id, tag.id);
    Ok(())
}
