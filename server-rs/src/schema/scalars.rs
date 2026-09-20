use async_graphql::{InputValueError, InputValueResult, ScalarType, Value};

use crate::{ids::Date, money::Cents};

#[async_graphql::Scalar(name = "Date")]
impl ScalarType for Date {
    fn parse(value: Value) -> InputValueResult<Self> {
        match value {
            Value::String(value) => Self::new(value).map_err(|error| InputValueError::custom(error.to_string())),
            value => Err(InputValueError::expected_type(value)),
        }
    }

    fn to_value(&self) -> Value {
        Value::from(self.as_str())
    }
}

#[async_graphql::Scalar(name = "Money")]
impl ScalarType for Cents {
    fn parse(value: Value) -> InputValueResult<Self> {
        match value {
            Value::Number(number) => number
                .as_i64()
                .map(|dollars| dollars as f64)
                .or_else(|| number.as_f64())
                .ok_or_else(|| InputValueError::expected_type(Value::Number(number)))
                .and_then(|dollars| {
                    Self::from_dollars_checked(dollars).map_err(|error| InputValueError::custom(error.to_string()))
                }),
            value => Err(InputValueError::expected_type(value)),
        }
    }

    fn to_value(&self) -> Value {
        if self.0 % 100 == 0 { Value::from(self.0 / 100) } else { Value::from(self.dollars()) }
    }
}

#[cfg(test)]
mod tests {
    use async_graphql::{ScalarType, Value};

    use crate::{ids::Date, money::Cents};

    #[test]
    fn money_accepts_json_numbers_and_rejects_strings() {
        assert_eq!(Cents::parse(Value::from(12.34)).unwrap(), Cents(1234));
        assert_eq!(Cents::parse(Value::from(12_i64)).unwrap(), Cents(1200));
        assert!(Cents::parse(Value::from("12.34")).is_err());
    }

    #[test]
    fn date_requires_canonical_iso_format() {
        assert_eq!(Date::parse(Value::from("2026-09-06")).unwrap().as_str(), "2026-09-06");
        assert!(Date::parse(Value::from("2026-9-6")).is_err());
    }
}
