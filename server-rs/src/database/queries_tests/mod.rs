use anyhow::Result;
use chrono::{DateTime, Utc};

use super::Timestamp;

mod accounts;
mod admin;
mod balance_reviews;
mod categories;
mod providers;
mod recurring;
mod rules_tags;
mod simplefin;
mod snapshots;
mod transaction_records;
mod transactions;
mod wealth;

fn time(value: &str) -> Result<Timestamp> {
    Ok(value.parse::<DateTime<Utc>>()?.into())
}
