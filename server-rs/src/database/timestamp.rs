use std::{fmt, ops::Deref};

use chrono::{DateTime, Utc};
use sqlx::{
    Decode, Encode, Sqlite, Type,
    encode::IsNull,
    error::BoxDynError,
    sqlite::{SqliteArgumentValue, SqliteTypeInfo, SqliteValueRef},
};

/// A UTC timestamp encoded as Go-compatible RFC 3339 seconds.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Timestamp(pub DateTime<Utc>);

impl Timestamp {
    fn go_rfc3339(self) -> String {
        self.0.format("%Y-%m-%dT%H:%M:%SZ").to_string()
    }
}

impl Type<Sqlite> for Timestamp {
    fn type_info() -> SqliteTypeInfo {
        <str as Type<Sqlite>>::type_info()
    }
}

impl Encode<'_, Sqlite> for Timestamp {
    fn encode_by_ref(&self, arguments: &mut Vec<SqliteArgumentValue<'_>>) -> Result<IsNull, BoxDynError> {
        Encode::<Sqlite>::encode(self.go_rfc3339(), arguments)
    }
}

impl<'r> Decode<'r, Sqlite> for Timestamp {
    fn decode(value: SqliteValueRef<'r>) -> Result<Self, BoxDynError> {
        Ok(Self(
            DateTime::parse_from_rfc3339(<&str as Decode<Sqlite>>::decode(value)?)?.with_timezone(&Utc),
        ))
    }
}

impl Deref for Timestamp {
    type Target = DateTime<Utc>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl From<DateTime<Utc>> for Timestamp {
    fn from(value: DateTime<Utc>) -> Self {
        Self(value)
    }
}

impl From<Timestamp> for DateTime<Utc> {
    fn from(value: Timestamp) -> Self {
        value.0
    }
}

impl fmt::Display for Timestamp {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.go_rfc3339())
    }
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use sqlx::{Sqlite, encode::Encode, sqlite::SqliteArgumentValue};

    use super::Timestamp;
    use crate::database::open;

    #[test]
    fn encodes_go_rfc3339_seconds() {
        let timestamp = Timestamp("2026-07-06T19:55:05.987654321Z".parse().unwrap());
        let mut arguments = Vec::new();
        let _ = <Timestamp as Encode<Sqlite>>::encode_by_ref(&timestamp, &mut arguments).unwrap();

        let Some(SqliteArgumentValue::Text(value)) = arguments.pop() else {
            panic!("timestamp must encode as text");
        };
        assert_eq!(value, "2026-07-06T19:55:05Z");
        assert_eq!(timestamp.to_string(), "2026-07-06T19:55:05Z");
    }

    #[tokio::test]
    async fn decodes_and_round_trips_rfc3339() -> Result<()> {
        let pool = open(":memory:", None).await?;
        let timestamp = Timestamp("2026-07-06T19:55:05Z".parse()?);
        let round_trip = sqlx::query_scalar::<_, Timestamp>("SELECT ?")
            .bind(timestamp)
            .fetch_one(&pool)
            .await?;
        let offset = sqlx::query_scalar::<_, Timestamp>("SELECT '2026-07-06T15:55:05-04:00'")
            .fetch_one(&pool)
            .await?;

        assert_eq!(round_trip, timestamp);
        assert_eq!(offset, timestamp);
        Ok(())
    }
}
