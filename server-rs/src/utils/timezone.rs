use std::str::FromStr;

use chrono_tz::Tz;

pub const FALLBACK_TIMEZONE: &str = "America/New_York";

pub fn normalize_timezone(timezone: &str) -> String {
    let timezone = timezone.trim();
    Tz::from_str(timezone)
        .map(|_| timezone.to_owned())
        .unwrap_or_else(|_| FALLBACK_TIMEZONE.to_owned())
}

#[cfg(test)]
mod tests {
    use super::{FALLBACK_TIMEZONE, normalize_timezone};

    #[test]
    fn normalizes_known_iana_timezones() {
        assert_eq!(normalize_timezone(" America/Los_Angeles "), "America/Los_Angeles");
        assert_eq!(normalize_timezone(""), FALLBACK_TIMEZONE);
        assert_eq!(normalize_timezone("not-a-zone"), FALLBACK_TIMEZONE);
    }
}
