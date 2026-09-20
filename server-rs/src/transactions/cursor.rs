use anyhow::Result;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{apierror::ApiError, money::Cents};

const INVALID_CURSOR: &str = "invalid cursor";

#[derive(Clone, Debug, PartialEq)]
pub struct Cursor {
    pub datetime: DateTime<Utc>,
    pub id: i64,
    pub amount: Cents,
}

#[derive(Deserialize, Serialize)]
struct WireCursor {
    datetime: String,
    id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    amount: Option<f64>,
}

pub fn encode_cursor(cursor: &Cursor) -> String {
    let wire = WireCursor {
        datetime: cursor.datetime.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        id: cursor.id,
        amount: (cursor.amount != Cents::default()).then_some(cursor.amount.dollars()),
    };
    URL_SAFE_NO_PAD.encode(serde_json::to_vec(&wire).expect("cursor serialization cannot fail"))
}

pub fn decode_cursor(value: &str) -> Result<Cursor> {
    let decoded = URL_SAFE_NO_PAD.decode(value).map_err(|_| invalid_cursor())?;
    let wire: WireCursor = serde_json::from_slice(&decoded).map_err(|_| invalid_cursor())?;
    let datetime = wire.datetime.parse::<DateTime<Utc>>().map_err(|_| invalid_cursor())?;
    anyhow::ensure!(wire.id > 0, ApiError::bad_input(INVALID_CURSOR));
    let amount = wire
        .amount
        .map(Cents::from_dollars_checked)
        .transpose()
        .map_err(|_| invalid_cursor())?
        .unwrap_or_default();
    Ok(Cursor {
        datetime,
        id: wire.id,
        amount,
    })
}

fn invalid_cursor() -> anyhow::Error {
    ApiError::bad_input(INVALID_CURSOR).into()
}

#[cfg(test)]
mod tests {
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};

    use super::{Cursor, decode_cursor, encode_cursor};
    use crate::money::Cents;

    #[test]
    fn cursors_round_trip_without_zero_amount() {
        let cursor = Cursor {
            datetime: "2026-09-06T12:00:00Z".parse().unwrap(),
            id: 2,
            amount: Cents::default(),
        };
        let encoded = encode_cursor(&cursor);
        assert_eq!(decode_cursor(&encoded).unwrap(), cursor);
        assert!(
            !String::from_utf8(URL_SAFE_NO_PAD.decode(encoded).unwrap())
                .unwrap()
                .contains("amount")
        );
    }

    #[test]
    fn cursors_reject_invalid_values() {
        for cursor in ["", "not-base64", "e30", "eyJkYXRldGltZSI6IiIsImlkIjowfQ"] {
            assert_eq!(decode_cursor(cursor).unwrap_err().to_string(), "invalid cursor");
        }
    }
}
