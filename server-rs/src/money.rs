use std::{
    borrow::Cow,
    iter::Sum,
    ops::{Add, AddAssign, Neg, Sub},
};

use anyhow::Result;
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize, Serializer};

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Ord, PartialEq, PartialOrd, sqlx::Type)]
#[serde(try_from = "f64")]
#[sqlx(transparent)]
pub struct Cents(pub i64);

impl Cents {
    pub fn from_dollars(dollars: f64) -> Self {
        Self((dollars * 100.0).round() as i64)
    }

    pub fn from_dollars_checked(dollars: f64) -> Result<Self> {
        anyhow::ensure!(dollars.is_finite(), "parse money: not a finite number");

        let cents = (dollars * 100.0).round();
        anyhow::ensure!(
            cents >= i64::MIN as f64 && cents < i64::MAX as f64,
            "parse money: cents overflow"
        );
        Ok(Self(cents as i64))
    }

    pub fn dollars(self) -> f64 {
        self.0 as f64 / 100.0
    }

    pub fn parse_decimal(value: &str) -> Result<Self> {
        anyhow::ensure!(!value.is_empty(), "parse money: empty value");

        let (negative, value) = match value.as_bytes()[0] {
            b'-' => (true, &value[1..]),
            b'+' => (false, &value[1..]),
            _ => (false, value),
        };
        anyhow::ensure!(!value.is_empty(), "parse money: missing digits");

        let (dollars, fraction) = value.split_once('.').unwrap_or((value, ""));
        anyhow::ensure!(fraction.len() <= 2, "parse money: more than two fractional digits");
        let dollars = if dollars.is_empty() { "0" } else { dollars };
        let fraction = match fraction.len() {
            0 => "00".to_owned(),
            1 => format!("{fraction}0"),
            _ => fraction.to_owned(),
        };
        anyhow::ensure!(
            decimal_digits(dollars) && decimal_digits(&fraction),
            "parse money: invalid decimal"
        );

        let magnitude = format!("{dollars}{fraction}")
            .parse::<u64>()
            .map_err(|error| anyhow::anyhow!("parse money {value:?}: {error}"))?;
        let max_magnitude = i64::MAX as u64 + u64::from(negative);
        anyhow::ensure!(magnitude <= max_magnitude, "parse money: cents overflow");
        if negative && magnitude == max_magnitude {
            return Ok(Self(i64::MIN));
        }
        Ok(Self(if negative { -(magnitude as i64) } else { magnitude as i64 }))
    }
}

fn decimal_digits(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|digit| digit.is_ascii_digit())
}

impl TryFrom<f64> for Cents {
    type Error = anyhow::Error;

    fn try_from(dollars: f64) -> Result<Self> {
        Self::from_dollars_checked(dollars)
    }
}

impl JsonSchema for Cents {
    fn schema_name() -> Cow<'static, str> {
        "Money".into()
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({"type": "number", "description": "USD amount in dollars, e.g. 12.34."})
    }

    fn inline_schema() -> bool {
        true
    }
}

impl Serialize for Cents {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        // Wire parity requires whole-dollar values to omit a decimal fraction.
        if self.0 % 100 == 0 {
            serializer.serialize_i64(self.0 / 100)
        } else {
            serializer.serialize_f64(self.dollars())
        }
    }
}

impl Add for Cents {
    type Output = Self;

    fn add(self, rhs: Self) -> Self::Output {
        Self(self.0 + rhs.0)
    }
}

impl AddAssign for Cents {
    fn add_assign(&mut self, rhs: Self) {
        self.0 += rhs.0;
    }
}

impl Sub for Cents {
    type Output = Self;

    fn sub(self, rhs: Self) -> Self::Output {
        Self(self.0 - rhs.0)
    }
}

impl Neg for Cents {
    type Output = Self;

    fn neg(self) -> Self::Output {
        Self(-self.0)
    }
}

impl Sum for Cents {
    fn sum<I: Iterator<Item = Self>>(iter: I) -> Self {
        iter.fold(Self::default(), Add::add)
    }
}

#[cfg(test)]
mod tests {
    use super::Cents;

    #[test]
    fn json_serializes_with_the_go_wire_format() {
        for (cents, wire) in [(1234, "12.34"), (-1, "-0.01"), (0, "0"), (100_000, "1000")] {
            let cents = Cents(cents);
            assert_eq!(serde_json::to_string(&cents).unwrap(), wire);
        }
    }

    #[test]
    fn json_deserializes_dollars_and_describes_the_schema() {
        assert_eq!(serde_json::from_str::<Cents>("12.34").unwrap(), Cents(1234));
        assert_eq!(serde_json::from_str::<Cents>("12").unwrap(), Cents(1200));
        assert!(serde_json::from_str::<Cents>("\"12.34\"").is_err());
        assert_eq!(
            schemars::schema_for!(Cents).to_value(),
            serde_json::json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "title": "Money",
                "type": "number",
                "description": "USD amount in dollars, e.g. 12.34."
            })
        );
    }

    #[test]
    fn rejects_invalid_dollar_amounts() {
        assert!(Cents::from_dollars_checked(f64::NAN).is_err());
        assert!(Cents::from_dollars_checked(f64::INFINITY).is_err());
        assert!(Cents::from_dollars_checked(i64::MAX as f64 / 100.0).is_err());
    }

    #[test]
    fn converts_dollars_with_go_rounding() {
        for (dollars, expected) in [(12.345, 1235), (-12.345, -1235), (4.5600000000000005, 456), (0.0, 0)] {
            assert_eq!(Cents::from_dollars(dollars), Cents(expected));
        }
        assert_eq!(Cents(-12_345).dollars(), -123.45);
    }

    #[test]
    fn parses_decimal_amounts_at_the_i64_bounds() {
        for (value, expected) in [
            ("12", 1200),
            ("12.3", 1230),
            ("12.34", 1234),
            ("-0.01", -1),
            ("+.5", 50),
            ("92233720368547758.07", i64::MAX),
            ("-92233720368547758.08", i64::MIN),
        ] {
            assert_eq!(Cents::parse_decimal(value).unwrap(), Cents(expected));
        }
    }

    #[test]
    fn rejects_invalid_decimal_amounts() {
        for value in [
            "",
            "+",
            "1.234",
            "1.2.3",
            " 1.00",
            "1e2",
            "92233720368547758.08",
            "-92233720368547758.09",
        ] {
            assert!(Cents::parse_decimal(value).is_err(), "{value}");
        }
    }

    #[test]
    fn supports_later_phase_arithmetic() {
        let mut cents = Cents(1);
        cents += Cents(2);
        assert_eq!(cents - Cents(1), Cents(2));
        assert_eq!(-cents, Cents(-3));
        assert_eq!([Cents(1), Cents(2)].into_iter().sum::<Cents>(), Cents(3));
    }
}
