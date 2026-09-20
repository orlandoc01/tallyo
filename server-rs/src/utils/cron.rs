use std::{future::Future, str::FromStr, sync::LazyLock};

use anyhow::Result;
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use croner::Cron;
use tokio_util::sync::CancellationToken;

static HOURLY_CRON: LazyLock<Cron> = LazyLock::new(|| "1 * * * *".parse().expect("hourly cron is valid"));

pub fn next_after(expr: &str, after: DateTime<Utc>) -> Result<DateTime<Utc>> {
    cron(expr)?.find_next_occurrence(&after, false).map_err(Into::into)
}

pub fn next_after_in_zone(expr: &str, timezone: &str, after: DateTime<Utc>) -> Result<DateTime<Utc>> {
    let timezone = Tz::from_str(timezone)?;
    cron(expr)?
        .find_next_occurrence(&after.with_timezone(&timezone), false)
        .map(|next| next.with_timezone(&Utc))
        .map_err(Into::into)
}

pub async fn run_hourly_cron<F, Fut>(cancel: CancellationToken, mut function: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = ()>,
{
    function().await;
    loop {
        let next = HOURLY_CRON
            .find_next_occurrence(&Utc::now(), false)
            .expect("hourly cron is valid");
        tokio::select! {
            _ = cancel.cancelled() => return,
            _ = tokio::time::sleep((next - Utc::now()).to_std().unwrap_or_default()) => function().await,
        }
    }
}

pub fn validate_min_interval(expr: &str, minimum: chrono::Duration) -> Result<()> {
    let cron = cron(expr)?;
    let first = cron.find_next_occurrence(&Utc::now(), false)?;
    let _ = (0..10_000).try_fold(first, |previous, _| {
        let next = cron.find_next_occurrence(&previous, false)?;
        anyhow::ensure!(
            next - previous >= minimum,
            "scheduled syncs must be {} or more apart",
            format_duration(minimum)
        );
        Ok::<_, anyhow::Error>(next)
    })?;
    Ok(())
}

fn cron(expr: &str) -> Result<Cron> {
    expr.parse().map_err(Into::into)
}

fn format_duration(duration: chrono::Duration) -> String {
    let seconds = duration.num_seconds();
    format!("{}h{}m{}s", seconds / 3_600, seconds % 3_600 / 60, seconds % 60)
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use chrono::{TimeZone, Utc};
    use tokio_util::sync::CancellationToken;

    use super::{next_after, next_after_in_zone, run_hourly_cron, validate_min_interval};

    #[test]
    fn finds_cron_occurrences_strictly_after_the_input() {
        let after = Utc.with_ymd_and_hms(2026, 5, 26, 12, 0, 0).unwrap();
        assert_eq!(
            next_after("0 */2 * * *", after).unwrap(),
            Utc.with_ymd_and_hms(2026, 5, 26, 14, 0, 0).unwrap()
        );
        assert_eq!(
            next_after("* * * * * *", after).unwrap(),
            after + chrono::Duration::seconds(1)
        );
        assert_eq!(
            next_after("0 0 * * 0", after).unwrap(),
            Utc.with_ymd_and_hms(2026, 5, 31, 0, 0, 0).unwrap()
        );
    }

    #[test]
    fn schedules_hourly_runs_at_minute_one_in_offset_zones() {
        let after = chrono::FixedOffset::west_opt(5 * 60 * 60)
            .unwrap()
            .with_ymd_and_hms(2026, 5, 26, 12, 0, 0)
            .unwrap();
        assert_eq!(
            super::HOURLY_CRON.find_next_occurrence(&after, false).unwrap(),
            chrono::FixedOffset::west_opt(5 * 60 * 60)
                .unwrap()
                .with_ymd_and_hms(2026, 5, 26, 12, 1, 0)
                .unwrap()
        );
    }

    #[test]
    fn finds_occurrences_in_a_timezone() {
        let after = Utc.with_ymd_and_hms(2026, 5, 26, 6, 59, 0).unwrap();
        assert_eq!(
            next_after_in_zone("0 0 * * *", "America/Los_Angeles", after).unwrap(),
            Utc.with_ymd_and_hms(2026, 5, 26, 7, 0, 0).unwrap()
        );
        assert!(next_after_in_zone("0 0 * * *", "bad-zone", after).is_err());
        assert!(next_after_in_zone("not-a-cron", "UTC", after).is_err());
    }

    #[tokio::test]
    async fn cancellation_still_runs_the_immediate_hourly_job_once() {
        let cancel = CancellationToken::new();
        cancel.cancel();
        let runs = Arc::new(AtomicUsize::new(0));
        run_hourly_cron(cancel, || {
            let runs = Arc::clone(&runs);
            async move {
                runs.fetch_add(1, Ordering::Relaxed);
            }
        })
        .await;
        assert_eq!(runs.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn validates_minimum_intervals() {
        assert!(validate_min_interval("0 */2 * * *", chrono::Duration::hours(1)).is_ok());
        let error = validate_min_interval("*/30 * * * *", chrono::Duration::hours(1))
            .unwrap_err()
            .to_string();
        assert!(error.contains("or more apart"));
        assert!(error.contains("1h0m0s"));
        assert!(
            validate_min_interval("* * * * * *", chrono::Duration::minutes(1))
                .unwrap_err()
                .to_string()
                .contains("or more apart")
        );
        assert!(validate_min_interval("not-a-cron", chrono::Duration::hours(1)).is_err());
    }
}
