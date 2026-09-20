use chrono::{DateTime, Datelike, Duration, Months, TimeZone, Utc};
use chrono_tz::Tz;

use crate::{ids::Date, money::Cents, schema::Granularity, transactions::SpendingAggregatePeriod};

pub(super) struct Period {
    pub(super) label: String,
    pub(super) start: Date,
    pub(super) end: Date,
}

pub(super) fn report_periods(
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    granularity: Option<Granularity>,
    timezone: Tz,
) -> Vec<SpendingAggregatePeriod> {
    let Some((first, last, granularity)) = period_range(from, to, granularity, timezone) else {
        return Vec::new();
    };
    period_starts(first, last, granularity)
        .map(|current| {
            let Period { label, start, end } = period_for(current.with_timezone(&Utc), granularity, timezone);
            SpendingAggregatePeriod {
                period_label: label,
                period_start: start,
                period_end: end,
                total_amount: Cents::default(),
                transaction_count: 0,
            }
        })
        .collect()
}

pub(super) fn period_count(
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    granularity: Option<Granularity>,
    timezone: Tz,
    limit: usize,
) -> usize {
    period_range(from, to, granularity, timezone)
        .map(|(first, last, granularity)| period_starts(first, last, granularity).take(limit + 1).count())
        .unwrap_or_default()
}

pub(super) fn period_for(datetime: DateTime<Utc>, granularity: Granularity, timezone: Tz) -> Period {
    let start = period_start(datetime.with_timezone(&timezone), granularity);
    let end = next_period_start(start, granularity) - Duration::days(1);
    let label = match granularity {
        Granularity::Daily | Granularity::Weekly => start.format("%F").to_string(),
        Granularity::Monthly => start.format("%Y-%m").to_string(),
        Granularity::Quarterly => format!("{}-Q{}", start.year(), (start.month0() / 3) + 1),
        Granularity::Yearly => start.format("%Y").to_string(),
    };
    Period {
        label,
        start: Date::new(start.format("%F").to_string()).expect("valid date"),
        end: Date::new(end.format("%F").to_string()).expect("valid date"),
    }
}

fn day_start(datetime: chrono::DateTime<Tz>) -> chrono::DateTime<Tz> {
    datetime
        .timezone()
        .with_ymd_and_hms(datetime.year(), datetime.month(), datetime.day(), 0, 0, 0)
        .single()
        .expect("midnight exists in all supported timezones")
}

fn period_range(
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    granularity: Option<Granularity>,
    timezone: Tz,
) -> Option<(chrono::DateTime<Tz>, chrono::DateTime<Tz>, Granularity)> {
    let granularity = granularity?;
    let from = from.with_timezone(&timezone);
    let end = day_start(to.with_timezone(&timezone)) - Duration::nanoseconds(1);
    (end >= from).then(|| {
        (
            period_start(from, granularity),
            period_start(end, granularity),
            granularity,
        )
    })
}

fn period_starts(
    first: chrono::DateTime<Tz>,
    last: chrono::DateTime<Tz>,
    granularity: Granularity,
) -> impl Iterator<Item = chrono::DateTime<Tz>> {
    std::iter::successors(Some(first), move |current| {
        (current < &last).then(|| next_period_start(*current, granularity))
    })
}

fn period_start(datetime: chrono::DateTime<Tz>, granularity: Granularity) -> chrono::DateTime<Tz> {
    let date = match granularity {
        Granularity::Daily => datetime.date_naive(),
        Granularity::Weekly => datetime.date_naive() - Duration::days(datetime.weekday().num_days_from_monday().into()),
        Granularity::Monthly => datetime.date_naive().with_day(1).expect("first day exists"),
        Granularity::Quarterly => datetime
            .date_naive()
            .with_month((datetime.month0() / 3) * 3 + 1)
            .and_then(|date| date.with_day(1))
            .expect("first quarter day exists"),
        Granularity::Yearly => datetime.date_naive().with_ordinal(1).expect("first day exists"),
    };
    datetime
        .timezone()
        .from_local_datetime(&date.and_hms_opt(0, 0, 0).expect("midnight is valid"))
        .single()
        .expect("midnight exists")
}

fn next_period_start(datetime: chrono::DateTime<Tz>, granularity: Granularity) -> chrono::DateTime<Tz> {
    match granularity {
        Granularity::Daily => datetime + Duration::days(1),
        Granularity::Weekly => datetime + Duration::days(7),
        Granularity::Monthly => datetime.checked_add_months(Months::new(1)).expect("date remains valid"),
        Granularity::Quarterly => datetime.checked_add_months(Months::new(3)).expect("date remains valid"),
        Granularity::Yearly => datetime
            .checked_add_months(Months::new(12))
            .expect("date remains valid"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utc(value: &str) -> DateTime<Utc> {
        value.parse().expect("valid timestamp")
    }

    #[test]
    fn counts_only_until_the_requested_limit() {
        assert_eq!(
            period_count(
                utc("2020-01-01T00:00:00Z"),
                utc("2030-01-01T00:00:00Z"),
                Some(Granularity::Daily),
                chrono_tz::UTC,
                400,
            ),
            401
        );
    }

    #[test]
    fn periods_use_the_report_timezone() {
        let periods = report_periods(
            utc("2026-01-01T00:00:00Z"),
            utc("2026-01-03T00:00:00Z"),
            Some(Granularity::Daily),
            chrono_tz::America::Los_Angeles,
        );
        assert_eq!(
            periods
                .iter()
                .map(|period| period.period_label.as_str())
                .collect::<Vec<_>>(),
            vec!["2025-12-31", "2026-01-01"]
        );
    }
}
