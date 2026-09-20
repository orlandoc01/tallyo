use std::collections::HashMap;

use chrono::{DateTime, Datelike, Days, Duration, TimeZone, Timelike, Utc};
use chrono_tz::Tz;

use crate::{
    accounts::AccountType,
    ids::Date,
    money::Cents,
    schema::{Granularity, NetWorthRange},
};

use super::{NetWorthPoint, SnapshotValue, liabilities::is_liability_type, timezone::local_date};

#[derive(Clone, Debug, PartialEq)]
pub(super) struct AccountSnapshotValue {
    pub local_date: String,
    pub synced_at: DateTime<Utc>,
    pub value: Cents,
    pub liability: bool,
    pub closed: bool,
    pub manual: bool,
    pub account_type: AccountType,
    pub account_subtype: Option<String>,
}

pub fn sample_dates(
    range: NetWorthRange,
    granularity: Option<Granularity>,
    earliest: Option<DateTime<Utc>>,
    now: DateTime<Tz>,
) -> Vec<DateTime<Tz>> {
    let earliest = earliest.map(|timestamp| timestamp.with_timezone(&now.timezone()));
    let start = range_start(range, earliest, now);
    let mut dates: Vec<_> = (0..)
        .map(|step| sample_date(start, granularity, step))
        .take_while(|date| *date <= now)
        .collect();
    if dates.last().map(DateTime::date_naive) != Some(now.date_naive()) {
        dates.push(now);
    }
    dates
}

fn range_start(range: NetWorthRange, earliest: Option<DateTime<Tz>>, now: DateTime<Tz>) -> DateTime<Tz> {
    let start = match range {
        NetWorthRange::OneMonth => add_months_clamped(now, -1),
        NetWorthRange::ThreeMonth => add_months_clamped(now, -3),
        NetWorthRange::Ytd => now
            .timezone()
            .with_ymd_and_hms(now.year(), 1, 1, 0, 0, 0)
            .single()
            .expect("New Year's midnight must be a valid timestamp"),
        NetWorthRange::OneYear => add_months_clamped(now, -12),
        NetWorthRange::All => earliest.unwrap_or_else(|| add_months_clamped(now, -1)),
    };
    earliest.filter(|timestamp| *timestamp > start).unwrap_or(start)
}

fn sample_date(start: DateTime<Tz>, granularity: Option<Granularity>, step: u32) -> DateTime<Tz> {
    match granularity {
        None | Some(Granularity::Daily) => start
            .checked_add_days(Days::new(u64::from(step)))
            .expect("sample date overflow"),
        Some(Granularity::Weekly) => start
            .checked_add_days(Days::new(u64::from(step) * 7))
            .expect("sample date overflow"),
        Some(Granularity::Monthly) => add_months_clamped(start, step as i32),
        Some(Granularity::Quarterly) => add_months_clamped(start, step as i32 * 3),
        Some(Granularity::Yearly) => add_months_clamped(start, step as i32 * 12),
    }
}

fn add_months_clamped(timestamp: DateTime<Tz>, months: i32) -> DateTime<Tz> {
    let month = timestamp.month0() as i32 + months;
    let year = timestamp.year() + month.div_euclid(12);
    let month = month.rem_euclid(12) as u32 + 1;
    let last_day = days_in_month(year, month);
    let day = if timestamp.day() == days_in_month(timestamp.year(), timestamp.month()) {
        last_day
    } else {
        timestamp.day().min(last_day)
    };
    timestamp
        .timezone()
        .with_ymd_and_hms(
            year,
            month,
            day,
            timestamp.hour(),
            timestamp.minute(),
            timestamp.second(),
        )
        .single()
        .expect("sample timestamp must be a valid local time")
        + Duration::nanoseconds(i64::from(timestamp.nanosecond()))
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let next_month = if month == 12 { 1 } else { month + 1 };
    let next_year = if month == 12 { year + 1 } else { year };
    chrono::NaiveDate::from_ymd_opt(next_year, next_month, 1)
        .expect("valid month")
        .pred_opt()
        .expect("month has a prior day")
        .day()
}

pub(super) fn account_snapshots_by_account(
    values: &[SnapshotValue],
    timezone: &str,
) -> HashMap<i64, Vec<AccountSnapshotValue>> {
    values
        .iter()
        .fold(HashMap::new(), |mut grouped, value| {
            grouped
                .entry(value.account_id)
                .or_insert_with(Vec::new)
                .push(AccountSnapshotValue {
                    local_date: local_date(value.synced_at, timezone),
                    synced_at: value.synced_at,
                    value: value.balance_usd,
                    liability: is_liability_type(value.account_type),
                    closed: value.account_closed,
                    manual: value.account_manual,
                    account_type: value.account_type,
                    account_subtype: value.account_subtype.clone(),
                });
            grouped
        })
        .into_iter()
        .map(|(account_id, mut snapshots)| {
            snapshots.sort_by_key(|snapshot| (snapshot.local_date.clone(), snapshot.synced_at));
            (account_id, snapshots)
        })
        .collect()
}

pub(super) fn forward_filled_snapshot<'a>(
    snapshots: &'a [AccountSnapshotValue],
    date: &str,
) -> Option<&'a AccountSnapshotValue> {
    let index = snapshots.partition_point(|snapshot| snapshot.local_date.as_str() <= date);
    let snapshot = snapshots.get(index.checked_sub(1)?)?;
    if snapshot.closed && date > snapshots.last()?.local_date.as_str() { None } else { Some(snapshot) }
}

pub(super) fn snapshot_values_by_date(
    values: &[SnapshotValue],
    dates: &[DateTime<Tz>],
    timezone: &str,
) -> (HashMap<String, Cents>, HashMap<String, Cents>) {
    let by_account = account_snapshots_by_account(values, timezone);
    dates.iter().fold(
        (HashMap::new(), HashMap::new()),
        |(mut assets_by_date, mut liabilities_by_date), date| {
            let (assets, liabilities) =
                by_account
                    .values()
                    .fold(
                        (Cents::default(), Cents::default()),
                        |totals, snapshots| match forward_filled_snapshot(snapshots, &date.format("%F").to_string()) {
                            Some(snapshot) if snapshot.liability => (totals.0, totals.1 + snapshot.value),
                            Some(snapshot) => (totals.0 + snapshot.value, totals.1),
                            None => totals,
                        },
                    );
            let key = date.format("%F").to_string();
            assets_by_date.insert(key.clone(), assets);
            liabilities_by_date.insert(key, liabilities);
            (assets_by_date, liabilities_by_date)
        },
    )
}

pub(super) fn net_worth_series(
    dates: &[DateTime<Tz>],
    now: DateTime<Tz>,
    current_assets: Cents,
    current_liabilities: Cents,
    values: &[SnapshotValue],
    timezone: &str,
) -> Vec<NetWorthPoint> {
    let (assets_by_date, liabilities_by_date) = snapshot_values_by_date(values, dates, timezone);
    dates
        .iter()
        .map(|date| {
            let key = date.format("%F").to_string();
            let (total_assets_usd, total_liabilities_usd) = if key == now.format("%F").to_string() {
                (current_assets, current_liabilities)
            } else {
                (
                    *assets_by_date.get(&key).unwrap_or(&Cents::default()),
                    *liabilities_by_date.get(&key).unwrap_or(&Cents::default()),
                )
            };
            NetWorthPoint {
                date: Date::new(key).expect("sample date is canonical"),
                total_assets_usd,
                total_liabilities_usd,
                net_worth_usd: total_assets_usd - total_liabilities_usd,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};
    use chrono_tz::{America::New_York, UTC};

    use super::{account_snapshots_by_account, forward_filled_snapshot, net_worth_series, sample_dates};
    use crate::{
        accounts::AccountType,
        money::Cents,
        schema::{Granularity, NetWorthRange},
        wealth::SnapshotValue,
    };

    #[test]
    fn forward_fills_until_a_closed_account_final_snapshot() {
        let snapshots = account_snapshots_by_account(
            &[SnapshotValue {
                account_id: 1,
                account_type: AccountType::Depository,
                account_manual: false,
                account_subtype: None,
                account_closed: true,
                synced_at: "2026-01-01T12:00:00Z".parse().unwrap(),
                balance_usd: Cents(50_000),
            }],
            "UTC",
        );

        assert!(forward_filled_snapshot(&snapshots[&1], "2026-01-02").is_none());
        assert_eq!(
            forward_filled_snapshot(&snapshots[&1], "2026-01-01").unwrap().value,
            Cents(50_000)
        );
    }

    #[test]
    fn selects_the_latest_snapshot_on_a_local_day() {
        let snapshots = account_snapshots_by_account(
            &["2026-06-22T21:47:39Z", "2026-06-23T01:42:09Z"]
                .into_iter()
                .enumerate()
                .map(|(index, synced_at)| SnapshotValue {
                    account_id: 1,
                    account_type: AccountType::Depository,
                    account_manual: false,
                    account_subtype: None,
                    account_closed: false,
                    synced_at: synced_at.parse().unwrap(),
                    balance_usd: Cents((index as i64 + 1) * 10_000),
                })
                .collect::<Vec<_>>(),
            "America/New_York",
        );

        assert_eq!(
            forward_filled_snapshot(&snapshots[&1], "2026-06-22").unwrap().value,
            Cents(20_000)
        );
    }

    #[test]
    fn samples_month_ends_without_losing_the_current_day() {
        let now = UTC.with_ymd_and_hms(2026, 3, 31, 12, 0, 0).single().unwrap();
        let earliest = Utc.with_ymd_and_hms(2026, 1, 31, 12, 0, 0).single().unwrap();

        let dates = sample_dates(NetWorthRange::All, Some(Granularity::Monthly), Some(earliest), now);

        assert_eq!(
            dates
                .iter()
                .map(|date| date.format("%F").to_string())
                .collect::<Vec<_>>(),
            ["2026-01-31", "2026-02-28", "2026-03-31"]
        );
    }

    #[test]
    fn samples_using_the_callers_local_day() {
        let now = New_York.with_ymd_and_hms(2026, 6, 18, 22, 0, 0).single().unwrap();

        let dates = sample_dates(NetWorthRange::OneMonth, None, None, now);

        assert_eq!(dates.last().unwrap().format("%F").to_string(), "2026-06-18");
    }

    #[test]
    fn uses_snapshot_values_before_today_and_current_totals_today() {
        let dates = [
            UTC.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).single().unwrap(),
            UTC.with_ymd_and_hms(2026, 6, 2, 12, 0, 0).single().unwrap(),
        ];
        let values = [
            SnapshotValue {
                account_id: 1,
                account_type: AccountType::Depository,
                account_manual: false,
                account_subtype: None,
                account_closed: false,
                synced_at: "2026-06-01T12:00:00Z".parse().unwrap(),
                balance_usd: Cents(10_000),
            },
            SnapshotValue {
                account_id: 2,
                account_type: AccountType::Credit,
                account_manual: false,
                account_subtype: None,
                account_closed: false,
                synced_at: "2026-06-01T12:00:00Z".parse().unwrap(),
                balance_usd: Cents(2_500),
            },
        ];

        let series = net_worth_series(&dates, dates[1], Cents(50_000), Cents(10_000), &values, "UTC");

        assert_eq!(series[0].total_assets_usd, Cents(10_000));
        assert_eq!(series[0].total_liabilities_usd, Cents(2_500));
        assert_eq!(series[0].net_worth_usd, Cents(7_500));
        assert_eq!(series[1].net_worth_usd, Cents(40_000));
    }

    #[test]
    fn samples_each_range_and_granularity() {
        let now = UTC.with_ymd_and_hms(2026, 6, 18, 12, 0, 0).single().unwrap();

        for range in [NetWorthRange::ThreeMonth, NetWorthRange::Ytd, NetWorthRange::OneYear] {
            assert_eq!(
                sample_dates(range, Some(Granularity::Yearly), None, now).last(),
                Some(&now)
            );
        }
        for granularity in [Granularity::Weekly, Granularity::Quarterly, Granularity::Yearly] {
            assert_eq!(
                sample_dates(NetWorthRange::OneYear, Some(granularity), None, now).last(),
                Some(&now)
            );
        }
    }
}
