use crate::apierror::ApiError;

pub const INVALID_TRACKING_MULTIPLIER: &str = "tracking multiplier must be a finite number greater than zero";

pub fn normalize_tracking(identifier: &str, ticker: Option<&str>, multiplier: f64) -> (Option<String>, f64) {
    let ticker = ticker.map(str::trim).filter(|ticker| !ticker.is_empty());
    match ticker {
        Some(ticker) if !ticker.eq_ignore_ascii_case(identifier.trim()) => (Some(ticker.to_owned()), multiplier),
        _ => (None, 1.0),
    }
}

pub fn validate_tracking_multiplier(multiplier: f64) -> anyhow::Result<()> {
    anyhow::ensure!(
        multiplier.is_finite() && multiplier > 0.0,
        ApiError::bad_input(INVALID_TRACKING_MULTIPLIER)
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{INVALID_TRACKING_MULTIPLIER, normalize_tracking, validate_tracking_multiplier};

    #[test]
    fn normalizes_blank_and_self_referencing_tickers() {
        assert_eq!(normalize_tracking("VTI", Some("  "), 2.0), (None, 1.0));
        assert_eq!(normalize_tracking("VTI", Some(" vti "), 2.0), (None, 1.0));
        assert_eq!(
            normalize_tracking("VTI", Some("VXUS"), 2.0),
            (Some("VXUS".to_owned()), 2.0)
        );
    }

    #[test]
    fn rejects_non_finite_and_non_positive_multipliers() {
        for multiplier in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 0.0, -1.0] {
            assert_eq!(
                validate_tracking_multiplier(multiplier).unwrap_err().to_string(),
                INVALID_TRACKING_MULTIPLIER
            );
        }
    }
}
