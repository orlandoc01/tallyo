use std::str::FromStr;

use anyhow::{Context, Result, anyhow};
use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;

use super::LocalDayWindow;
use crate::ids::Date;

pub fn timezone_or_utc(timezone: &str) -> Tz {
    Tz::from_str(timezone).unwrap_or(chrono_tz::UTC)
}

pub fn local_date(timestamp: DateTime<Utc>, timezone: &str) -> String {
    timestamp
        .with_timezone(&timezone_or_utc(timezone))
        .format("%F")
        .to_string()
}

pub fn utc_date(timestamp: DateTime<Utc>) -> String {
    timestamp.format("%F").to_string()
}

pub fn local_day_window(date: &Date, timezone: &str) -> Result<LocalDayWindow> {
    let day = NaiveDate::parse_from_str(date.as_str(), "%F").with_context(|| format!("parse local day {date:?}"))?;
    let next_day = day
        .succ_opt()
        .ok_or_else(|| anyhow!("day after {} is not representable", date.as_str()))?;
    let timezone = timezone_or_utc(timezone);
    Ok(LocalDayWindow {
        start: first_instant_of_day(day, timezone)?.with_timezone(&Utc),
        end: first_instant_of_day(next_day, timezone)?.with_timezone(&Utc),
    })
}

// Midnight may not exist (a clock jump forward at 00:00) or may occur twice (a
// jump back); the day begins at its earliest valid wall-clock instant.
fn first_instant_of_day(day: NaiveDate, timezone: Tz) -> Result<DateTime<Tz>> {
    let midnight = day.and_hms_opt(0, 0, 0).expect("midnight is a valid time");
    (0..=3)
        .find_map(|hours| {
            timezone
                .from_local_datetime(&(midnight + Duration::hours(hours)))
                .earliest()
        })
        .ok_or_else(|| anyhow!("no valid instant found on {day} in {timezone}"))
}

pub fn start_of_day(timestamp: DateTime<Tz>) -> DateTime<Tz> {
    timestamp
        .timezone()
        .with_ymd_and_hms(timestamp.year(), timestamp.month(), timestamp.day(), 0, 0, 0)
        .single()
        .expect("midnight must be a valid local timestamp")
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;
    use chrono_tz::America::New_York;

    use super::{local_date, local_day_window, start_of_day, timezone_or_utc, utc_date};

    fn window(date: &str, timezone: &str) -> (String, String) {
        let window = local_day_window(&crate::ids::Date::new(date).unwrap(), timezone).unwrap();
        (window.start.to_rfc3339(), window.end.to_rfc3339())
    }

    #[test]
    fn bounds_a_local_day_in_utc() {
        assert_eq!(
            window("2026-03-01", "America/Los_Angeles"),
            (
                "2026-03-01T08:00:00+00:00".to_owned(),
                "2026-03-02T08:00:00+00:00".to_owned()
            )
        );
        assert_eq!(window("2026-03-01", "").0, "2026-03-01T00:00:00+00:00");
        // Spring-forward and fall-back days are 23 and 25 hours long.
        assert_eq!(
            window("2026-03-08", "America/Los_Angeles"),
            (
                "2026-03-08T08:00:00+00:00".to_owned(),
                "2026-03-09T07:00:00+00:00".to_owned()
            )
        );
        assert_eq!(
            window("2026-11-01", "America/Los_Angeles"),
            (
                "2026-11-01T07:00:00+00:00".to_owned(),
                "2026-11-02T08:00:00+00:00".to_owned()
            )
        );
    }

    #[test]
    fn handles_midnight_clock_transitions() {
        // Egypt springs forward at 00:00 on 2026-04-24, so that day starts at 01:00 local.
        assert_eq!(
            window("2026-04-23", "Africa/Cairo"),
            (
                "2026-04-22T22:00:00+00:00".to_owned(),
                "2026-04-23T22:00:00+00:00".to_owned()
            )
        );
        assert_eq!(
            window("2026-04-24", "Africa/Cairo"),
            (
                "2026-04-23T22:00:00+00:00".to_owned(),
                "2026-04-24T21:00:00+00:00".to_owned()
            )
        );
        // Cuba falls back at 01:00 to 00:00 on 2026-11-01, so midnight happens twice; the first one starts the day.
        assert_eq!(
            window("2026-11-01", "America/Havana"),
            (
                "2026-11-01T04:00:00+00:00".to_owned(),
                "2026-11-02T05:00:00+00:00".to_owned()
            )
        );
    }

    #[test]
    fn converts_utc_timestamps_to_local_dates_with_a_utc_fallback() {
        let timestamp = "2026-06-19T05:00:00Z".parse().unwrap();

        assert_eq!(local_date(timestamp, "America/Los_Angeles"), "2026-06-18");
        assert_eq!(local_date(timestamp, ""), "2026-06-19");
        assert_eq!(local_date(timestamp, "Not/AZone"), "2026-06-19");
        assert_eq!(utc_date(timestamp), "2026-06-19");
    }

    #[test]
    fn finds_the_local_start_of_day() {
        let timestamp = New_York.with_ymd_and_hms(2026, 6, 19, 15, 30, 0).unwrap();

        assert_eq!(
            start_of_day(timestamp),
            New_York.with_ymd_and_hms(2026, 6, 19, 0, 0, 0).unwrap()
        );
        assert_eq!(timezone_or_utc("America/New_York"), New_York);
    }
}
