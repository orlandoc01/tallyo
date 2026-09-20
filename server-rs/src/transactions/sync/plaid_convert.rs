use std::collections::HashSet;

use anyhow::{Context, Result};
use chrono::{DateTime, Datelike, NaiveDate, TimeZone, Timelike, Utc};
use serde_json::to_string;

use crate::{
    clients::plaid::Transaction,
    money::Cents,
    transactions::{SyncedTransaction, TransactionSource},
    utils::favicon::duckduckgo_favicon_url,
};

pub(super) fn transaction_from_plaid(transaction: &Transaction, hidden: &HashSet<String>) -> Result<SyncedTransaction> {
    Ok(SyncedTransaction {
        external_id: transaction.transaction_id.clone(),
        account_id: transaction.account_id.clone(),
        amount: Cents::from_dollars_checked(transaction.amount)?,
        datetime: transaction_datetime(transaction)?,
        posted_datetime: transaction_posted_datetime(transaction)?,
        merchant_name: non_empty(transaction.merchant_name.as_deref()),
        original_name: transaction
            .original_description
            .as_deref()
            .and_then(|name| non_empty(Some(name)))
            .or_else(|| non_empty(Some(&transaction.name))),
        logo_url: transaction_logo_url(transaction),
        plaid_category: plaid_category(transaction),
        raw_provider_json: Some(to_string(transaction).context("marshal raw plaid transaction")?),
        source: TransactionSource::Plaid,
        pending: transaction.pending,
        hidden_by_account: hidden.contains(&transaction.account_id),
        stage_for_llm: false,
    })
}

pub(super) fn non_empty(value: Option<&str>) -> Option<String> {
    value.filter(|value| !value.is_empty()).map(ToOwned::to_owned)
}

fn transaction_datetime(transaction: &Transaction) -> Result<DateTime<Utc>> {
    if let Some(datetime) = transaction.authorized_datetime {
        return Ok(normalize_datetime(datetime));
    }
    if let Some(date) = transaction.authorized_date.as_deref().filter(|date| !date.is_empty()) {
        return date_at_noon(date);
    }
    if let Some(datetime) = transaction.datetime {
        return Ok(normalize_datetime(datetime));
    }
    date_at_noon(&transaction.date)
}

fn transaction_posted_datetime(transaction: &Transaction) -> Result<DateTime<Utc>> {
    transaction
        .datetime
        .map(normalize_datetime)
        .map(Ok)
        .unwrap_or_else(|| date_at_noon(&transaction.date))
}

fn normalize_datetime(datetime: DateTime<Utc>) -> DateTime<Utc> {
    let datetime = datetime.with_timezone(&Utc);
    if datetime.time().num_seconds_from_midnight() == 0 && datetime.nanosecond() == 0 {
        Utc.with_ymd_and_hms(datetime.year(), datetime.month(), datetime.day(), 12, 0, 0)
            .single()
            .expect("valid provider date")
    } else {
        datetime
    }
}

pub(super) fn date_at_noon(value: &str) -> Result<DateTime<Utc>> {
    Ok(NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .with_context(|| format!("parse plaid date {value:?}"))?
        .and_hms_opt(12, 0, 0)
        .expect("noon is valid")
        .and_utc())
}

fn transaction_logo_url(transaction: &Transaction) -> Option<String> {
    transaction
        .logo_url
        .clone()
        .or_else(|| {
            transaction
                .counterparties
                .as_ref()?
                .iter()
                .find_map(|counterparty| counterparty.logo_url.clone())
        })
        .or_else(|| {
            transaction
                .counterparties
                .as_ref()?
                .iter()
                .find_map(|counterparty| counterparty.website.as_deref().and_then(duckduckgo_favicon_url))
        })
}

fn plaid_category(transaction: &Transaction) -> Option<String> {
    transaction
        .personal_finance_category
        .as_ref()
        .map(|category| format!("{}:{}", category.primary, category.detailed))
        .or_else(|| (!transaction.category.is_empty()).then(|| transaction.category.join(":")))
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use chrono::{TimeZone, Utc};

    use super::{transaction_datetime, transaction_from_plaid, transaction_posted_datetime};
    use crate::clients::plaid::{PersonalFinanceCategory, Transaction};

    #[test]
    fn prioritizes_plaid_dates_and_normalizes_date_only_values() {
        let transaction = Transaction {
            date: "2026-09-06".to_owned(),
            authorized_datetime: Some(Utc.with_ymd_and_hms(2026, 9, 5, 0, 0, 0).unwrap()),
            datetime: Some(Utc.with_ymd_and_hms(2026, 9, 4, 15, 0, 0).unwrap()),
            ..Default::default()
        };
        assert_eq!(
            transaction_datetime(&transaction).unwrap(),
            Utc.with_ymd_and_hms(2026, 9, 5, 12, 0, 0).unwrap()
        );
        assert_eq!(
            transaction_posted_datetime(&transaction).unwrap(),
            Utc.with_ymd_and_hms(2026, 9, 4, 15, 0, 0).unwrap()
        );
    }

    #[test]
    fn builds_a_plaid_draft_with_pfc2_and_hidden_account_state() {
        let transaction = transaction_from_plaid(
            &Transaction {
                transaction_id: "transaction".to_owned(),
                account_id: "account".to_owned(),
                amount: 12.34,
                date: "2026-09-06".to_owned(),
                name: "Original".to_owned(),
                merchant_name: Some("Merchant".to_owned()),
                personal_finance_category: Some(PersonalFinanceCategory {
                    primary: "FOOD_AND_DRINK".to_owned(),
                    detailed: "GROCERIES".to_owned(),
                    ..Default::default()
                }),
                ..Default::default()
            },
            &HashSet::from(["account".to_owned()]),
        )
        .unwrap();
        assert_eq!(transaction.amount.0, 1234);
        assert_eq!(transaction.plaid_category.as_deref(), Some("FOOD_AND_DRINK:GROCERIES"));
        assert_eq!(
            transaction.datetime,
            Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap()
        );
        assert!(transaction.hidden_by_account);
    }
}
