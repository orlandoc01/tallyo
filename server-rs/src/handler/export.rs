use std::{collections::HashMap, convert::Infallible};

use anyhow::{Context, Result};
use async_graphql::ID;
use axum::{
    body::{Body, Bytes},
    extract::{RawQuery, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Local, Utc};
use futures_util::{Stream, stream};
use sqlx::SqlitePool;

use crate::{
    ids::{GlobalId, GlobalIdType},
    money::Cents,
    schema::{DateTimeRange, TransactionsFilter},
    transactions::{Cursor, EXPORT_CSV_HEADER, ExportTransaction, export_row, store::export_transaction_page},
};

const PAGE_SIZE: usize = 500;
const ID_LISTS: [(&str, GlobalIdType); 4] = [
    ("categoryIds", GlobalIdType::Category),
    ("accountIds", GlobalIdType::Account),
    ("ownerIds", GlobalIdType::Owner),
    ("tagIds", GlobalIdType::Tag),
];

type Page = (Vec<ExportTransaction>, Option<Cursor>);

pub(super) async fn handler(State(pool): State<SqlitePool>, RawQuery(query): RawQuery) -> Response {
    let filter = match parse_export_filter(query.as_deref().unwrap_or_default()) {
        Ok(filter) => filter,
        Err(error) => return (StatusCode::BAD_REQUEST, format!("{error:#}")).into_response(),
    };
    let first = match export_transaction_page(&pool, Some(&filter), None, PAGE_SIZE).await {
        Ok(page) => page,
        Err(error) => {
            tracing::error!(%error, "export query failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, "export failed").into_response();
        }
    };
    let filename = format!("transactions-{}.csv", Local::now().format("%Y-%m-%d"));
    (
        [
            (header::CONTENT_TYPE, "text/csv".to_owned()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        Body::from_stream(pages(pool, filter, first)),
    )
        .into_response()
}

fn pages(pool: SqlitePool, filter: TransactionsFilter, first: Page) -> impl Stream<Item = Result<Bytes, Infallible>> {
    stream::unfold(Some((first, true)), move |state| {
        let pool = pool.clone();
        let filter = filter.clone();
        async move {
            let ((page, cursor), header) = state?;
            let chunk = csv_chunk(header, &page)
                .inspect_err(|error| tracing::error!(%error, "csv flush error"))
                .ok()?;
            let next = match cursor {
                None => None,
                Some(cursor) => match export_transaction_page(&pool, Some(&filter), Some(cursor), PAGE_SIZE).await {
                    Ok(page) => Some((page, false)),
                    Err(error) => {
                        tracing::error!(%error, "export query failed mid-stream");
                        None
                    }
                },
            };
            Some((Ok(chunk), next))
        }
    })
}

fn csv_chunk(header: bool, page: &[ExportTransaction]) -> csv::Result<Bytes> {
    let mut buffer = Vec::new();
    let mut writer = csv::Writer::from_writer(&mut buffer);
    if header {
        writer.write_record(EXPORT_CSV_HEADER)?;
    }
    page.iter().try_for_each(|row| writer.write_record(export_row(row)))?;
    writer.flush()?;
    drop(writer);
    Ok(Bytes::from(buffer))
}

fn parse_export_filter(raw_query: &str) -> Result<TransactionsFilter> {
    let params = url::form_urlencoded::parse(raw_query.as_bytes()).fold(HashMap::new(), |mut params, (key, value)| {
        params.entry(key.into_owned()).or_insert(value.into_owned());
        params
    });
    let value = |name: &str| params.get(name).map(String::as_str).filter(|value| !value.is_empty());
    let datetime = |name| {
        value(name)
            .map(|raw| parse_datetime(raw).with_context(|| format!("invalid {name}")))
            .transpose()
    };
    let boolean = |name| {
        value(name)
            .map(|raw| parse_bool(raw).with_context(|| format!("invalid {name}")))
            .transpose()
    };
    let money = |name| {
        value(name)
            .map(|raw| parse_money(raw).with_context(|| format!("invalid {name}")))
            .transpose()
    };
    let ids = |(name, expected): (&str, GlobalIdType)| {
        value(name)
            .map(|raw| decode_ids(raw).with_context(|| format!("invalid {name}")))
            .transpose()
            .map(|list| (expected, list))
    };

    let (from, to) = (datetime("datetimeFrom")?, datetime("datetimeTo")?);
    let [category_ids, account_ids, owner_ids, tag_ids] = ID_LISTS.map(ids);
    // Every list decodes before any type check so the error precedence matches Go.
    let (category_ids, account_ids, owner_ids, tag_ids) = (category_ids?, account_ids?, owner_ids?, tag_ids?);
    Ok(TransactionsFilter {
        datetime_range: (from.is_some() || to.is_some()).then_some(DateTimeRange { from, to }),
        category_ids: typed(category_ids)?,
        account_ids: typed(account_ids)?,
        owner_ids: typed(owner_ids)?,
        tag_ids: typed(tag_ids)?,
        is_reviewed: boolean("isReviewed")?,
        is_recurring: boolean("isRecurring")?,
        is_pending: boolean("isPending")?,
        is_hidden: boolean("isHidden")?,
        merchant_prefix: value("merchantPrefix").map(ToOwned::to_owned),
        original_prefix: value("originalPrefix").map(ToOwned::to_owned),
        search: value("search").map(ToOwned::to_owned),
        exclude_transfers: boolean("excludeTransfers")?,
        exclude_income: boolean("excludeIncome")?,
        untagged: boolean("untagged")?,
        amount_min: money("amountMin")?,
        amount_max: money("amountMax")?,
        exact_amount: money("exactAmount")?,
    })
}

fn decode_ids(list: &str) -> Result<Vec<GlobalId>> {
    list.split(',').map(|id| GlobalId::decode(id.trim())).collect()
}

fn typed((expected, ids): (GlobalIdType, Option<Vec<GlobalId>>)) -> Result<Option<Vec<ID>>> {
    ids.map(|ids| {
        ids.into_iter()
            .map(|id| id.validate_type(expected).map(|()| ID::from(id.encoded_string())))
            .collect()
    })
    .transpose()
}

fn parse_datetime(value: &str) -> Result<DateTime<Utc>> {
    Ok(DateTime::parse_from_rfc3339(value)?.with_timezone(&Utc))
}

fn parse_bool(value: &str) -> Result<bool> {
    match value {
        "true" | "1" => Ok(true),
        "false" | "0" => Ok(false),
        _ => anyhow::bail!("value {value:?} is not a boolean"),
    }
}

fn parse_money(value: &str) -> Result<Cents> {
    let dollars = value
        .parse::<f64>()
        .with_context(|| format!("value {value:?} is not a number"))?;
    Cents::from_dollars_checked(dollars)
}

#[cfg(test)]
mod tests {
    use super::parse_export_filter;
    use crate::{
        ids::{GlobalId, GlobalIdType},
        money::Cents,
    };

    fn id(typ: GlobalIdType, id: i64) -> String {
        GlobalId::new(typ, id).encoded_string()
    }

    #[test]
    fn parses_every_supported_query_parameter() {
        let query = format!(
            "datetimeFrom=2026-01-01T00:00:00Z&datetimeTo=2027-01-01T00:00:00Z&merchantPrefix=foo&categoryIds={},{}&ownerIds={}&tagIds={}&untagged=false&isReviewed=true&isHidden=0&amountMin=5.5&amountMax=100&excludeTransfers=1&search=coffee",
            id(GlobalIdType::Category, 1),
            id(GlobalIdType::Category, 3),
            id(GlobalIdType::Owner, 1),
            id(GlobalIdType::Tag, 1)
        );
        let filter = parse_export_filter(&query).unwrap();
        let range = filter.datetime_range.unwrap();
        assert_eq!(range.from.unwrap().to_rfc3339(), "2026-01-01T00:00:00+00:00");
        assert_eq!(range.to.unwrap().to_rfc3339(), "2027-01-01T00:00:00+00:00");
        assert_eq!(filter.merchant_prefix.as_deref(), Some("foo"));
        assert_eq!(filter.search.as_deref(), Some("coffee"));
        assert_eq!(
            filter.category_ids.unwrap(),
            [id(GlobalIdType::Category, 1), id(GlobalIdType::Category, 3)].map(async_graphql::ID::from)
        );
        assert_eq!(filter.owner_ids.unwrap().len(), 1);
        assert_eq!(filter.tag_ids.unwrap().len(), 1);
        assert_eq!(filter.untagged, Some(false));
        assert_eq!(filter.is_reviewed, Some(true));
        assert_eq!(filter.is_hidden, Some(false));
        assert_eq!(filter.amount_min, Some(Cents(550)));
        assert_eq!(filter.amount_max, Some(Cents(10_000)));
        assert_eq!(filter.exclude_transfers, Some(true));
        assert_eq!(filter.account_ids, None);

        let query = format!(
            "accountIds={}, {}&originalPrefix=orig&exactAmount=42.5",
            id(GlobalIdType::Account, 1),
            id(GlobalIdType::Account, 2)
        );
        let filter = parse_export_filter(&query).unwrap();
        assert_eq!(filter.account_ids.unwrap().len(), 2);
        assert_eq!(filter.original_prefix.as_deref(), Some("orig"));
        assert_eq!(filter.exact_amount, Some(Cents(4_250)));

        let filter = parse_export_filter("").unwrap();
        assert_eq!(filter.datetime_range, None);
        assert_eq!(filter.merchant_prefix, None);
        assert_eq!(filter.is_reviewed, None);
    }

    #[test]
    fn fails_closed_on_malformed_parameters() {
        for (query, message) in [
            (
                "datetimeFrom=not-a-date".to_owned(),
                "invalid datetimeFrom: premature end of input",
            ),
            (
                "amountMin=not-a-number".to_owned(),
                "invalid amountMin: value \"not-a-number\" is not a number: invalid float literal",
            ),
            (
                "amountMax=inf".to_owned(),
                "invalid amountMax: parse money: not a finite number",
            ),
            (
                "isReviewed=maybe".to_owned(),
                "invalid isReviewed: value \"maybe\" is not a boolean",
            ),
            (
                "untagged=maybe".to_owned(),
                "invalid untagged: value \"maybe\" is not a boolean",
            ),
            (
                "categoryIds=not-a-valid-id".to_owned(),
                "invalid categoryIds: invalid global id",
            ),
            ("tagIds=not-a-valid-id".to_owned(), "invalid tagIds: invalid global id"),
            (
                format!("categoryIds={}", id(GlobalIdType::Account, 1)),
                "wrong global id type \"Account\", expected \"Category\"",
            ),
        ] {
            let error = parse_export_filter(&query).unwrap_err();
            assert_eq!(format!("{error:#}"), message, "{query}");
        }
    }
}
