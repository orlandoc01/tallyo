use anyhow::Result;

use crate::database::{dbtest, queries};

use super::time;

struct MatrixFixture {
    expense_category_id: i64,
    income_category_id: i64,
    transfer_category_id: i64,
}

async fn matrix_pool() -> Result<(sqlx::SqlitePool, MatrixFixture)> {
    let pool = dbtest::open().await?;
    let categories = sqlx::query_as::<_, (i64, String)>("SELECT cat_id, group_kind FROM category_rows")
        .fetch_all(&pool)
        .await?;
    let category = |kind| {
        categories
            .iter()
            .find_map(|(id, group_kind)| (group_kind == kind).then_some(*id))
            .ok_or_else(|| anyhow::anyhow!("missing {kind} category"))
    };
    let fixture = MatrixFixture {
        expense_category_id: category("EXPENSE")?,
        income_category_id: category("INCOME")?,
        transfer_category_id: category("TRANSFER")?,
    };

    sqlx::query("INSERT INTO owners (id, name) VALUES (1, 'Ada'), (2, 'Bea')")
        .execute(&pool)
        .await?;
    sqlx::query(
        "INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES (1, 'ada-account', 1, 'Ada Account', 'CHECKING'), (2, 'bea-account', 2, 'Bea Account', 'SAVINGS')",
    )
    .execute(&pool)
    .await?;
    sqlx::query(
        "INSERT INTO tags (id, name) VALUES (1, 'tagged'); INSERT INTO transactions (id, account_id, category_id, amount_cents, datetime, posted_datetime, external_id, merchant_name, original_name, is_reviewed, is_recurring, is_hidden, pending) VALUES (101, 1, ?1, 100, '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z', 'alpha', 'Alpha', NULL, 0, 0, 0, 0), (102, 1, ?2, 200, '2026-05-02T00:00:00Z', '2026-05-02T00:00:00Z', 'beta', 'Beta', NULL, 1, 1, 1, 1), (103, 1, ?3, 300, '2026-05-03T00:00:00Z', '2026-05-03T00:00:00Z', 'gamma', 'Gamma', 'Original Only', 0, 0, 0, 0), (104, 2, ?1, 400, '2026-05-04T00:00:00Z', '2026-05-04T00:00:00Z', 'delta', 'Delta', NULL, 1, 0, 0, 0); INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (101, 1)",
    )
    .bind(fixture.expense_category_id)
    .bind(fixture.income_category_id)
    .bind(fixture.transfer_category_id)
    .execute(&pool)
    .await?;
    Ok((pool, fixture))
}

async fn record_ids(pool: &sqlx::SqlitePool, params: queries::TransactionRecordsParams<'_>) -> Result<Vec<i64>> {
    Ok(queries::transaction_records(pool, params)
        .await?
        .into_iter()
        .map(|row| row.id)
        .collect())
}

#[tokio::test]
async fn transaction_records_filter_and_order_matrix() -> Result<()> {
    let (pool, fixture) = matrix_pool().await?;
    let ids = [101];
    let empty_ids: [i64; 0] = [];
    let category_ids = [fixture.expense_category_id];
    let tag_ids = [1];
    let account_ids = [2];
    let owner_ids = [1];
    let datetime_from = time("2026-05-03T00:00:00Z")?;
    let datetime_to = time("2026-05-02T00:00:00Z")?;
    let cases = [
        (
            queries::TransactionRecordsParams {
                row_limit: 10,
                ..Default::default()
            },
            &[101, 102, 103, 104][..],
        ),
        (
            queries::TransactionRecordsParams {
                ids: None,
                row_limit: 10,
                ..Default::default()
            },
            &[101, 102, 103, 104][..],
        ),
        (
            queries::TransactionRecordsParams {
                ids: Some(&empty_ids),
                row_limit: 10,
                ..Default::default()
            },
            &[][..],
        ),
        (
            queries::TransactionRecordsParams {
                ids: Some(&ids),
                row_limit: 10,
                ..Default::default()
            },
            &[101][..],
        ),
        (
            queries::TransactionRecordsParams {
                search_match: Some("alpha"),
                row_limit: 10,
                ..Default::default()
            },
            &[101][..],
        ),
        (
            queries::TransactionRecordsParams {
                datetime_from: Some(datetime_from),
                row_limit: 10,
                ..Default::default()
            },
            &[103, 104][..],
        ),
        (
            queries::TransactionRecordsParams {
                datetime_to: Some(datetime_to),
                row_limit: 10,
                ..Default::default()
            },
            &[101][..],
        ),
        (
            queries::TransactionRecordsParams {
                category_ids: Some(&category_ids),
                row_limit: 10,
                ..Default::default()
            },
            &[101, 104][..],
        ),
        (
            queries::TransactionRecordsParams {
                tag_ids: Some(&tag_ids),
                row_limit: 10,
                ..Default::default()
            },
            &[101][..],
        ),
        (
            queries::TransactionRecordsParams {
                untagged: true,
                row_limit: 10,
                ..Default::default()
            },
            &[102, 103, 104][..],
        ),
        (
            queries::TransactionRecordsParams {
                account_ids: Some(&account_ids),
                row_limit: 10,
                ..Default::default()
            },
            &[104][..],
        ),
        (
            queries::TransactionRecordsParams {
                owner_ids: Some(&owner_ids),
                row_limit: 10,
                ..Default::default()
            },
            &[101, 102, 103][..],
        ),
        (
            queries::TransactionRecordsParams {
                is_reviewed: Some(false),
                row_limit: 10,
                ..Default::default()
            },
            &[101, 103][..],
        ),
        (
            queries::TransactionRecordsParams {
                is_recurring: Some(true),
                row_limit: 10,
                ..Default::default()
            },
            &[102][..],
        ),
        (
            queries::TransactionRecordsParams {
                is_pending: Some(true),
                row_limit: 10,
                ..Default::default()
            },
            &[102][..],
        ),
        (
            queries::TransactionRecordsParams {
                is_hidden: Some(true),
                row_limit: 10,
                ..Default::default()
            },
            &[102][..],
        ),
        (
            queries::TransactionRecordsParams {
                merchant_prefix: Some("alpha"),
                row_limit: 10,
                ..Default::default()
            },
            &[101][..],
        ),
        (
            queries::TransactionRecordsParams {
                original_prefix: Some("original only"),
                row_limit: 10,
                ..Default::default()
            },
            &[103][..],
        ),
        (
            queries::TransactionRecordsParams {
                exact_amount: Some(300),
                row_limit: 10,
                ..Default::default()
            },
            &[103][..],
        ),
        (
            queries::TransactionRecordsParams {
                amount_min: Some(300),
                row_limit: 10,
                ..Default::default()
            },
            &[103, 104][..],
        ),
        (
            queries::TransactionRecordsParams {
                amount_max: Some(200),
                row_limit: 10,
                ..Default::default()
            },
            &[101, 102][..],
        ),
        (
            queries::TransactionRecordsParams {
                exclude_transfers: true,
                row_limit: 10,
                ..Default::default()
            },
            &[101, 102, 104][..],
        ),
        (
            queries::TransactionRecordsParams {
                exclude_income: true,
                row_limit: 10,
                ..Default::default()
            },
            &[101, 103, 104][..],
        ),
    ];
    for (params, expected) in cases {
        assert_eq!(record_ids(&pool, params).await?, expected);
    }

    let all = queries::transaction_records(
        &pool,
        queries::TransactionRecordsParams {
            row_limit: 10,
            ..Default::default()
        },
    )
    .await?;
    assert_eq!(
        all.into_iter()
            .map(|row| (row.id, row.accounts.id, row.category_rows.cat_id))
            .collect::<Vec<_>>(),
        [
            (101, 1, fixture.expense_category_id),
            (102, 1, fixture.income_category_id),
            (103, 1, fixture.transfer_category_id),
            (104, 2, fixture.expense_category_id),
        ]
    );

    let order_cases = [
        (
            queries::TransactionRecordsParams {
                order: queries::TransactionRecordsOrder::AmountAsc,
                row_limit: 10,
                ..Default::default()
            },
            &[101, 102, 103, 104][..],
        ),
        (
            queries::TransactionRecordsParams {
                order: queries::TransactionRecordsOrder::AmountDesc,
                row_limit: 10,
                ..Default::default()
            },
            &[104, 103, 102, 101][..],
        ),
        (
            queries::TransactionRecordsParams {
                order: queries::TransactionRecordsOrder::DatetimeAsc,
                row_limit: 10,
                ..Default::default()
            },
            &[101, 102, 103, 104][..],
        ),
        (
            queries::TransactionRecordsParams {
                order: queries::TransactionRecordsOrder::DatetimeDesc,
                row_limit: 10,
                ..Default::default()
            },
            &[104, 103, 102, 101][..],
        ),
        (
            queries::TransactionRecordsParams {
                order: queries::TransactionRecordsOrder::IdAsc,
                row_limit: 10,
                ..Default::default()
            },
            &[101, 102, 103, 104][..],
        ),
        (
            queries::TransactionRecordsParams {
                order: queries::TransactionRecordsOrder::IdDesc,
                row_limit: 10,
                ..Default::default()
            },
            &[104, 103, 102, 101][..],
        ),
    ];
    for (params, expected) in order_cases {
        assert_eq!(record_ids(&pool, params).await?, expected);
    }

    assert_eq!(
        record_ids(
            &pool,
            queries::TransactionRecordsParams {
                cursor_amount: 300,
                cursor_id: 103,
                cursor: queries::TransactionRecordsCursor::AmountLt,
                row_limit: 10,
                ..Default::default()
            },
        )
        .await?,
        [101, 102]
    );
    assert_eq!(
        record_ids(
            &pool,
            queries::TransactionRecordsParams {
                cursor_amount: 200,
                cursor_id: 102,
                cursor: queries::TransactionRecordsCursor::AmountGt,
                row_limit: 10,
                ..Default::default()
            },
        )
        .await?,
        [103, 104]
    );
    Ok(())
}

#[tokio::test]
async fn transaction_records_datetime_cursors_preserve_ties() -> Result<()> {
    let pool = dbtest::open().await?;
    sqlx::query("INSERT INTO owners (id, name) VALUES (1, 'Ada')")
        .execute(&pool)
        .await?;
    sqlx::query(
        "INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES (1, 'account', 1, 'Account', 'CHECKING')",
    )
    .execute(&pool)
    .await?;
    sqlx::query(
        "INSERT INTO transactions (id, account_id, category_id, amount_cents, datetime, posted_datetime, external_id) VALUES (201, 1, 0, 100, '2026-05-10T12:00:00Z', '2026-05-10T12:00:00Z', 'equal-1'), (202, 1, 0, 100, '2026-05-10T12:00:00Z', '2026-05-10T12:00:00Z', 'equal-2'), (203, 1, 0, 100, '2026-05-10T12:00:00Z', '2026-05-10T12:00:00Z', 'equal-3')",
    )
    .execute(&pool)
    .await?;

    let equal_datetime = time("2026-05-10T12:00:00Z")?;
    assert_eq!(
        record_ids(
            &pool,
            queries::TransactionRecordsParams {
                order: queries::TransactionRecordsOrder::DatetimeDesc,
                row_limit: 2,
                ..Default::default()
            },
        )
        .await?[..2],
        [203, 202]
    );
    assert_eq!(
        record_ids(
            &pool,
            queries::TransactionRecordsParams {
                cursor_datetime: equal_datetime,
                cursor_id: 202,
                cursor: queries::TransactionRecordsCursor::DatetimeLt,
                order: queries::TransactionRecordsOrder::DatetimeDesc,
                row_limit: 10,
                ..Default::default()
            },
        )
        .await?,
        [201]
    );
    assert_eq!(
        record_ids(
            &pool,
            queries::TransactionRecordsParams {
                cursor_datetime: equal_datetime,
                cursor_id: 202,
                cursor: queries::TransactionRecordsCursor::DatetimeGt,
                order: queries::TransactionRecordsOrder::DatetimeDesc,
                row_limit: 10,
                ..Default::default()
            },
        )
        .await?,
        [203]
    );
    Ok(())
}

#[tokio::test]
async fn transaction_records_normalizes_offset_ranges_to_utc() -> Result<()> {
    let pool = dbtest::open().await?;
    sqlx::query("INSERT INTO owners (id, name) VALUES (1, 'Ada')")
        .execute(&pool)
        .await?;
    sqlx::query(
        "INSERT INTO accounts (id, external_id, owner_id, name, type) VALUES (1, 'account', 1, 'Account', 'CHECKING')",
    )
    .execute(&pool)
    .await?;
    sqlx::query(
        "INSERT INTO transactions (id, account_id, category_id, amount_cents, datetime, posted_datetime, external_id) VALUES (301, 1, 0, 100, '2026-05-01T02:00:00Z', '2026-05-01T02:00:00Z', 'before-offset-range'), (302, 1, 0, 200, '2026-05-01T05:00:00Z', '2026-05-01T05:00:00Z', 'inside-offset-range')",
    )
    .execute(&pool)
    .await?;

    assert_eq!(
        record_ids(
            &pool,
            queries::TransactionRecordsParams {
                datetime_from: Some(time("2026-05-01T00:00:00-04:00")?),
                datetime_to: Some(time("2026-05-01T02:00:00-04:00")?),
                row_limit: 10,
                ..Default::default()
            },
        )
        .await?,
        [302]
    );
    Ok(())
}
