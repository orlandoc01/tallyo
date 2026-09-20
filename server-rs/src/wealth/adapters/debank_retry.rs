use std::time::Duration;

pub(super) const FLAG_RETRY_BASE_DELAY: Duration = Duration::from_secs(5 * 60);
pub(super) const FLAG_RETRY_WINDOW: Duration = Duration::from_secs(2 * 60 * 60);
const FLAG_RETRY_MAX_SHIFT: u32 = 5;

pub(super) fn next_flag_retry_delay(retry_count: u32) -> Duration {
    FLAG_RETRY_BASE_DELAY
        .saturating_mul(2_u32.pow(retry_count.min(FLAG_RETRY_MAX_SHIFT)))
        .min(FLAG_RETRY_WINDOW)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{FLAG_RETRY_WINDOW, next_flag_retry_delay};

    #[test]
    fn caps_exponential_flag_retries_at_two_hours() {
        for (retry_count, expected_minutes) in [(0, 5), (1, 10), (2, 20), (3, 40), (4, 80), (5, 120), (9, 120)] {
            assert_eq!(
                next_flag_retry_delay(retry_count),
                Duration::from_secs(expected_minutes * 60)
            );
        }
        assert_eq!(FLAG_RETRY_WINDOW, Duration::from_secs(2 * 60 * 60));
    }
}
