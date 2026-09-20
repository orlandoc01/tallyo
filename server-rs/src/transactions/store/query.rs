use anyhow::Result;
use async_graphql::ID;
use chrono::Utc;

use crate::{
    database::{Timestamp, queries},
    ids::{GlobalId, GlobalIdType},
    schema::{SortDirection, TransactionSort, TransactionSortField, TransactionsFilter},
};

use super::super::{Cursor, TransactionQuery};

#[derive(Default)]
pub(super) struct FilterValues {
    pub ids: Vec<i64>,
    search_match: Option<String>,
    datetime_from: Option<Timestamp>,
    datetime_to: Option<Timestamp>,
    category_ids: Vec<i64>,
    tag_ids: Vec<i64>,
    account_ids: Vec<i64>,
    owner_ids: Vec<i64>,
    is_reviewed: Option<bool>,
    is_recurring: Option<bool>,
    is_pending: Option<bool>,
    is_hidden: Option<bool>,
    merchant_prefix: Option<String>,
    original_prefix: Option<String>,
    exact_amount: Option<i64>,
    amount_min: Option<i64>,
    amount_max: Option<i64>,
    untagged: bool,
    exclude_transfers: bool,
    exclude_income: bool,
    excluded_kinds: Vec<String>,
}

impl FilterValues {
    pub(super) fn from_filter(filter: Option<&TransactionsFilter>, ids: Vec<i64>) -> Result<Self> {
        let Some(filter) = filter else {
            return Ok(Self { ids, ..Self::default() });
        };
        let (datetime_from, datetime_to) = filter.datetime_range.as_ref().map_or((None, None), |range| {
            (range.from.map(Into::into), range.to.map(Into::into))
        });
        let exact_amount = filter.exact_amount.map(|amount| amount.0);
        let exclude_transfers = filter.exclude_transfers.unwrap_or(false);
        let exclude_income = filter.exclude_income.unwrap_or(false);
        let excluded_kinds = [
            exclude_transfers.then(|| "TRANSFER".to_owned()),
            exclude_income.then(|| "INCOME".to_owned()),
        ]
        .into_iter()
        .flatten()
        .collect();
        Ok(Self {
            ids,
            search_match: search_match(filter.search.as_deref()),
            datetime_from,
            datetime_to,
            category_ids: local_ids(filter.category_ids.as_deref(), GlobalIdType::Category)?,
            tag_ids: local_ids(filter.tag_ids.as_deref(), GlobalIdType::Tag)?,
            account_ids: local_ids(filter.account_ids.as_deref(), GlobalIdType::Account)?,
            owner_ids: local_ids(filter.owner_ids.as_deref(), GlobalIdType::Owner)?,
            is_reviewed: filter.is_reviewed,
            is_recurring: filter.is_recurring,
            is_pending: filter.is_pending,
            is_hidden: filter.is_hidden,
            merchant_prefix: normalized_lower(filter.merchant_prefix.as_deref()),
            original_prefix: normalized_lower(filter.original_prefix.as_deref()),
            exact_amount,
            amount_min: exact_amount
                .is_none()
                .then_some(filter.amount_min.map(|amount| amount.0))
                .flatten(),
            amount_max: exact_amount
                .is_none()
                .then_some(filter.amount_max.map(|amount| amount.0))
                .flatten(),
            untagged: filter.untagged.unwrap_or(false),
            exclude_transfers,
            exclude_income,
            excluded_kinds,
        })
    }

    pub(super) fn has_criteria(&self) -> bool {
        self.search_match.is_some()
            || self.datetime_from.is_some()
            || self.datetime_to.is_some()
            || !self.category_ids.is_empty()
            || !self.tag_ids.is_empty()
            || !self.account_ids.is_empty()
            || !self.owner_ids.is_empty()
            || self.is_reviewed.is_some()
            || self.is_recurring.is_some()
            || self.is_pending.is_some()
            || self.is_hidden.is_some()
            || self.merchant_prefix.is_some()
            || self.original_prefix.is_some()
            || self.exact_amount.is_some()
            || self.amount_min.is_some()
            || self.amount_max.is_some()
            || self.untagged
            || self.exclude_transfers
            || self.exclude_income
    }

    pub(super) fn records_params(
        &self,
        cursor: Option<(Cursor, bool)>,
        sort: Option<&TransactionSort>,
        reverse: bool,
        limit: i64,
    ) -> queries::TransactionRecordsParams<'_> {
        let (by_amount, ascending) = sort_direction(sort, reverse);
        let (cursor, cursor_is_after) = cursor.unwrap_or((
            Cursor {
                datetime: Utc::now(),
                id: 0,
                amount: Default::default(),
            },
            false,
        ));
        let display_ascending = sort.is_some_and(|sort| sort.direction == SortDirection::Asc);
        let want_greater = cursor_is_after == display_ascending;
        let cursor_case = match (cursor_is_after, by_amount, want_greater) {
            (false, _, _) => queries::TransactionRecordsCursor::None,
            (true, false, true) => queries::TransactionRecordsCursor::DatetimeGt,
            (true, false, false) => queries::TransactionRecordsCursor::DatetimeLt,
            (true, true, true) => queries::TransactionRecordsCursor::AmountGt,
            (true, true, false) => queries::TransactionRecordsCursor::AmountLt,
        };
        let order = match (by_amount, ascending) {
            (true, true) => queries::TransactionRecordsOrder::AmountAsc,
            (true, false) => queries::TransactionRecordsOrder::AmountDesc,
            (false, true) => queries::TransactionRecordsOrder::DatetimeAsc,
            (false, false) => queries::TransactionRecordsOrder::DatetimeDesc,
        };
        queries::TransactionRecordsParams {
            ids: option_slice(&self.ids),
            search_match: self.search_match.as_deref(),
            datetime_from: self.datetime_from,
            datetime_to: self.datetime_to,
            category_ids: option_slice(&self.category_ids),
            tag_ids: option_slice(&self.tag_ids),
            account_ids: option_slice(&self.account_ids),
            owner_ids: option_slice(&self.owner_ids),
            is_reviewed: self.is_reviewed,
            is_recurring: self.is_recurring,
            is_pending: self.is_pending,
            is_hidden: self.is_hidden,
            merchant_prefix: self.merchant_prefix.as_deref(),
            original_prefix: self.original_prefix.as_deref(),
            exact_amount: self.exact_amount,
            amount_min: self.amount_min,
            amount_max: self.amount_max,
            cursor_datetime: cursor.datetime.into(),
            cursor_id: cursor.id,
            cursor_amount: cursor.amount.0,
            row_limit: limit,
            untagged: self.untagged,
            exclude_transfers: self.exclude_transfers,
            exclude_income: self.exclude_income,
            cursor: cursor_case,
            order,
        }
    }

    pub(super) fn count_params(&self) -> queries::CountTransactionRecordsParams<'_> {
        queries::CountTransactionRecordsParams {
            ids: option_slice(&self.ids),
            search_match: self.search_match.as_deref(),
            datetime_from: self.datetime_from,
            datetime_to: self.datetime_to,
            category_ids: option_slice(&self.category_ids),
            tag_ids: option_slice(&self.tag_ids),
            account_ids: option_slice(&self.account_ids),
            owner_ids: option_slice(&self.owner_ids),
            is_reviewed: self.is_reviewed,
            is_recurring: self.is_recurring,
            is_pending: self.is_pending,
            is_hidden: self.is_hidden,
            merchant_prefix: self.merchant_prefix.as_deref(),
            original_prefix: self.original_prefix.as_deref(),
            exact_amount: self.exact_amount,
            amount_min: self.amount_min,
            amount_max: self.amount_max,
            excluded_kinds: option_slice(&self.excluded_kinds),
            untagged: self.untagged,
        }
    }

    pub(super) fn summary_params(&self) -> queries::TransactionRecordsSummaryParams<'_> {
        queries::TransactionRecordsSummaryParams {
            ids: option_slice(&self.ids),
            search_match: self.search_match.as_deref(),
            datetime_from: self.datetime_from,
            datetime_to: self.datetime_to,
            category_ids: option_slice(&self.category_ids),
            tag_ids: option_slice(&self.tag_ids),
            account_ids: option_slice(&self.account_ids),
            owner_ids: option_slice(&self.owner_ids),
            is_reviewed: self.is_reviewed,
            is_recurring: self.is_recurring,
            is_pending: self.is_pending,
            is_hidden: self.is_hidden,
            merchant_prefix: self.merchant_prefix.as_deref(),
            original_prefix: self.original_prefix.as_deref(),
            exact_amount: self.exact_amount,
            amount_min: self.amount_min,
            amount_max: self.amount_max,
            excluded_kinds: option_slice(&self.excluded_kinds),
            untagged: self.untagged,
        }
    }

    pub(super) fn ids_params(&self) -> queries::TransactionIDsByFilterParams<'_> {
        queries::TransactionIDsByFilterParams {
            ids: option_slice(&self.ids),
            search_match: self.search_match.as_deref(),
            datetime_from: self.datetime_from,
            datetime_to: self.datetime_to,
            category_ids: option_slice(&self.category_ids),
            tag_ids: option_slice(&self.tag_ids),
            account_ids: option_slice(&self.account_ids),
            owner_ids: option_slice(&self.owner_ids),
            is_reviewed: self.is_reviewed,
            is_recurring: self.is_recurring,
            is_pending: self.is_pending,
            is_hidden: self.is_hidden,
            merchant_prefix: self.merchant_prefix.as_deref(),
            original_prefix: self.original_prefix.as_deref(),
            exact_amount: self.exact_amount,
            amount_min: self.amount_min,
            amount_max: self.amount_max,
            untagged: self.untagged,
            exclude_transfers: self.exclude_transfers,
            exclude_income: self.exclude_income,
        }
    }
}

pub(super) fn local_ids(ids: Option<&[ID]>, expected: GlobalIdType) -> Result<Vec<i64>> {
    ids.unwrap_or_default()
        .iter()
        .map(|id| GlobalId::decode(id.as_str())?.i64_of_type(expected))
        .collect()
}

pub(super) fn local_id(id: &ID, expected: GlobalIdType) -> Result<i64> {
    GlobalId::decode(id.as_str())?.i64_of_type(expected)
}

pub(super) fn query_cursor(query: &TransactionQuery) -> Result<Option<(Cursor, bool)>> {
    match (&query.after, &query.before) {
        (Some(after), None) => super::super::decode_cursor(after).map(|cursor| Some((cursor, true))),
        (None, Some(before)) => super::super::decode_cursor(before).map(|cursor| Some((cursor, false))),
        (None, None) => Ok(None),
        _ => Err(crate::apierror::ApiError::bad_input("invalid cursor").into()),
    }
}

pub(super) fn search_match(value: Option<&str>) -> Option<String> {
    let value = normalized_string(value)?;
    Some(
        value
            .split_whitespace()
            .map(|term| format!("\"{}\"*", term.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" AND "),
    )
}

pub(super) fn normalized_lower(value: Option<&str>) -> Option<String> {
    normalized_string(value).map(|value| value.to_ascii_lowercase())
}

fn normalized_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(super) fn option_slice<T>(values: &[T]) -> Option<&[T]> {
    (!values.is_empty()).then_some(values)
}

fn sort_direction(sort: Option<&TransactionSort>, reverse: bool) -> (bool, bool) {
    let by_amount = sort.is_some_and(|sort| sort.field == TransactionSortField::Amount);
    let ascending = sort.is_some_and(|sort| sort.direction == SortDirection::Asc) ^ reverse;
    (by_amount, ascending)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filter() -> TransactionsFilter {
        TransactionsFilter {
            datetime_range: None,
            category_ids: None,
            account_ids: None,
            owner_ids: None,
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
        }
    }

    #[test]
    fn false_boolean_filters_reach_every_query_parameter_set() -> Result<()> {
        let values = FilterValues::from_filter(
            Some(&TransactionsFilter {
                is_reviewed: Some(false),
                is_recurring: Some(false),
                is_pending: Some(false),
                is_hidden: Some(false),
                ..filter()
            }),
            Vec::new(),
        )?;

        let records = values.records_params(None, None, false, 1);
        let count = values.count_params();
        let summary = values.summary_params();
        let ids = values.ids_params();
        assert_eq!(
            (
                records.is_reviewed,
                records.is_recurring,
                records.is_pending,
                records.is_hidden
            ),
            (Some(false), Some(false), Some(false), Some(false))
        );
        assert_eq!(
            (count.is_reviewed, count.is_recurring, count.is_pending, count.is_hidden),
            (Some(false), Some(false), Some(false), Some(false))
        );
        assert_eq!(
            (
                summary.is_reviewed,
                summary.is_recurring,
                summary.is_pending,
                summary.is_hidden
            ),
            (Some(false), Some(false), Some(false), Some(false))
        );
        assert_eq!(
            (ids.is_reviewed, ids.is_recurring, ids.is_pending, ids.is_hidden),
            (Some(false), Some(false), Some(false), Some(false))
        );
        Ok(())
    }

    #[test]
    fn exclusion_filters_reach_count_and_summary_parameters() -> Result<()> {
        let values = FilterValues::from_filter(
            Some(&TransactionsFilter {
                exclude_transfers: Some(true),
                exclude_income: Some(true),
                ..filter()
            }),
            Vec::new(),
        )?;

        let expected = ["TRANSFER".to_owned(), "INCOME".to_owned()];
        assert_eq!(values.count_params().excluded_kinds, Some(expected.as_slice()));
        assert_eq!(values.summary_params().excluded_kinds, Some(expected.as_slice()));
        assert!(values.ids_params().exclude_transfers);
        assert!(values.ids_params().exclude_income);
        Ok(())
    }
}
