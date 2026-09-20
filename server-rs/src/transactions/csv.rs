use std::io::Read;

use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDate, Utc};

use crate::{
    ids::GlobalId,
    money::Cents,
    transactions::{ExportTransaction, ImportRow, ImportRowError},
};

pub const EXPORT_CSV_HEADER: [&str; 16] = [
    "external_id",
    "source",
    "datetime",
    "posted_datetime",
    "amount",
    "merchant_name",
    "original_name",
    "category",
    "account_id",
    "account_name",
    "owner",
    "notes",
    "is_recurring",
    "is_reviewed",
    "is_hidden",
    "pending",
];

pub fn normalize_datetime(value: &str) -> Result<DateTime<Utc>> {
    match value.len() == 10 && value.as_bytes().get(4) == Some(&b'-') && value.as_bytes().get(7) == Some(&b'-') {
        true => NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .map(|date| date.and_hms_opt(12, 0, 0).expect("noon is valid").and_utc())
            .map_err(Into::into),
        false => Ok(value.parse::<DateTime<Utc>>()?),
    }
}

pub fn parse_import_csv(reader: impl Read) -> Result<(Vec<ImportRow>, Vec<ImportRowError>)> {
    let mut reader = csv::ReaderBuilder::new().from_reader(reader);
    let headers = reader.headers().context("read header")?.clone();
    let columns = headers
        .iter()
        .enumerate()
        .map(|(index, header)| (header.trim().to_ascii_lowercase(), index))
        .collect::<std::collections::HashMap<_, _>>();
    for required in ["account_id", "datetime", "amount"] {
        anyhow::ensure!(columns.contains_key(required), "missing required column {required:?}");
    }
    anyhow::ensure!(
        columns.contains_key("merchant_name") || columns.contains_key("original_name"),
        "CSV must contain at least one of: merchant_name, original_name"
    );

    reader.records().enumerate().try_fold(
        (Vec::new(), Vec::new()),
        |(mut rows, mut errors), (index, record)| -> Result<_> {
            let row = index + 1;
            let record = record.with_context(|| format!("read row {row}"))?;
            let value = |name| {
                columns
                    .get(name)
                    .and_then(|index| record.get(*index))
                    .unwrap_or_default()
                    .trim()
            };
            let account_id = value("account_id");
            let datetime = value("datetime");
            let merchant_name = value("merchant_name");
            let original_name = value("original_name");
            let invalid = match () {
                _ if account_id.is_empty() => Some("account_id is required".to_owned()),
                _ if datetime.is_empty() => Some("datetime is required".to_owned()),
                _ if merchant_name.is_empty() && original_name.is_empty() => {
                    Some("merchant_name or original_name is required".to_owned())
                }
                _ => None,
            };
            if let Some(message) = invalid {
                errors.push(ImportRowError { row, message });
                return Ok((rows, errors));
            }
            let amount_raw = value("amount");
            let amount = match Cents::parse_decimal(amount_raw) {
                Ok(amount) => amount,
                Err(_) => {
                    errors.push(ImportRowError {
                        row,
                        message: format!("invalid amount {amount_raw:?}"),
                    });
                    return Ok((rows, errors));
                }
            };
            let datetime = match normalize_datetime(datetime) {
                Ok(datetime) => datetime,
                Err(_) => {
                    errors.push(ImportRowError {
                        row,
                        message: format!("invalid datetime {:?}", value("datetime")),
                    });
                    return Ok((rows, errors));
                }
            };
            let posted_raw = value("posted_datetime");
            let posted_datetime = match (!posted_raw.is_empty()).then(|| normalize_datetime(posted_raw)) {
                Some(Ok(datetime)) => datetime,
                Some(Err(_)) => {
                    errors.push(ImportRowError {
                        row,
                        message: format!("invalid posted_datetime {posted_raw:?}"),
                    });
                    return Ok((rows, errors));
                }
                None => datetime,
            };
            rows.push(ImportRow {
                row_num: row,
                external_id: value("external_id").to_owned(),
                source: match value("source") {
                    "" => "manual".to_owned(),
                    source => source.to_owned(),
                },
                account_id: account_id.to_owned(),
                datetime,
                posted_datetime,
                amount,
                merchant_name: merchant_name.to_owned(),
                original_name: original_name.to_owned(),
                category: value("category").to_owned(),
                notes: value("notes").to_owned(),
                is_recurring: value("is_recurring").eq_ignore_ascii_case("true"),
                is_hidden: value("is_hidden").eq_ignore_ascii_case("true"),
            });
            Ok((rows, errors))
        },
    )
}

pub fn export_row(row: &ExportTransaction) -> Vec<String> {
    let transaction = &row.transaction;
    vec![
        safe_csv_text(&row.external_id),
        safe_csv_text(&row.source),
        transaction.datetime.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        transaction
            .posted_datetime
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        format_cents(transaction.amount),
        safe_csv_text(transaction.merchant_name.as_deref().unwrap_or_default()),
        safe_csv_text(transaction.original_name.as_deref().unwrap_or_default()),
        safe_csv_text(&transaction.category.name),
        GlobalId::new(crate::ids::GlobalIdType::Account, transaction.account.id).encoded_string(),
        safe_csv_text(&transaction.account.name),
        safe_csv_text(&row.owner_name),
        safe_csv_text(transaction.notes.as_deref().unwrap_or_default()),
        transaction.is_recurring.to_string(),
        transaction.is_reviewed.to_string(),
        transaction.is_hidden.to_string(),
        transaction.pending.to_string(),
    ]
}

pub fn format_cents(cents: Cents) -> String {
    let sign = if cents.0 < 0 { "-" } else { "" };
    let magnitude = cents.0.unsigned_abs();
    format!("{sign}{}.{:02}", magnitude / 100, magnitude % 100)
}

pub fn safe_csv_text(value: &str) -> String {
    match value.as_bytes().first() {
        Some(b'=' | b'+' | b'-' | b'@' | b'\t' | b'\r') => format!("'{value}"),
        _ => value.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::{format_cents, normalize_datetime, parse_import_csv, safe_csv_text};
    use crate::money::Cents;

    #[test]
    fn parses_bare_dates_and_safe_export_values() {
        assert_eq!(
            normalize_datetime("2026-09-06").unwrap().to_rfc3339(),
            "2026-09-06T12:00:00+00:00"
        );
        assert_eq!(format_cents(Cents(i64::MIN)), "-92233720368547758.08");
        assert_eq!(safe_csv_text("=formula"), "'=formula");
    }

    #[test]
    fn reports_per_row_import_errors() {
        let (rows, errors) = parse_import_csv("account_id,datetime,amount,merchant_name\n,2026-09-06,1,Coffee\na,2026-09-06,no,Coffee\na,2026-09-06,1,Coffee\n".as_bytes()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(errors.iter().map(|error| error.row).collect::<Vec<_>>(), [1, 2]);
    }

    #[test]
    fn rejects_missing_columns_and_invalid_posted_datetimes() {
        assert_eq!(
            parse_import_csv("account_id,amount,merchant_name\na,1,Coffee\n".as_bytes())
                .unwrap_err()
                .to_string(),
            "missing required column \"datetime\""
        );
        let (rows, errors) = parse_import_csv(
            "account_id,datetime,posted_datetime,amount,merchant_name\na,2026-09-06,bad,1,Coffee\n".as_bytes(),
        )
        .unwrap();
        assert!(rows.is_empty());
        assert_eq!(errors[0].message, "invalid posted_datetime \"bad\"");
    }

    #[test]
    fn neutralizes_every_formula_prefix_and_formats_signed_cents() {
        for value in ["=sum()", "+sum()", "-sum()", "@sum()", "\tformula", "\rformula"] {
            assert_eq!(safe_csv_text(value), format!("'{value}"));
        }
        assert_eq!(format_cents(Cents(123)), "1.23");
        assert_eq!(format_cents(Cents(-123)), "-1.23");
    }
}
