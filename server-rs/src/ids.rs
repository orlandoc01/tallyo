use std::{borrow::Cow, fmt};

use anyhow::Result;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::NaiveDate;
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize, Serializer};

use crate::apierror::ApiError;

const VERSION: &str = "v1";

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, strum_macros::Display, strum_macros::EnumString)]
pub enum GlobalIdType {
    PlaidItem,
    SimpleFinConnection,
    Asset,
    Account,
    Connection,
    Owner,
    RecurringCharge,
    User,
    Budget,
    Category,
    CategoryGroup,
    Rule,
    Tag,
    Transaction,
    BalanceSnapshotReview,
    AccountSnapshot,
    SimpleFinAccessToken,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GlobalId {
    pub typ: GlobalIdType,
    id: i64,
}

impl GlobalId {
    pub const fn new(typ: GlobalIdType, id: i64) -> Self {
        Self { typ, id }
    }

    pub const fn i64(self) -> i64 {
        self.id
    }

    pub fn encoded_string(self) -> String {
        encode_global_id(self.typ, self.id)
    }

    pub fn decode(value: &str) -> Result<Self> {
        let decoded = URL_SAFE_NO_PAD.decode(value).map_err(|_| invalid_global_id())?;
        let decoded = std::str::from_utf8(&decoded).map_err(|_| invalid_global_id())?;
        let mut parts = decoded.splitn(3, ':');
        let (Some(version), Some(type_name), Some(id)) = (parts.next(), parts.next(), parts.next()) else {
            return Err(invalid_global_id().into());
        };
        if version.is_empty() || type_name.is_empty() || id.is_empty() || version != VERSION {
            return Err(invalid_global_id().into());
        }
        let typ = type_name.parse().map_err(|_| invalid_global_id())?;
        let id = id.parse().map_err(|_| invalid_global_id())?;
        let global_id = Self::new(typ, id);
        if global_id.encoded_string() != value {
            return Err(invalid_global_id().into());
        }
        Ok(global_id)
    }

    pub fn validate_type(self, expected: GlobalIdType) -> Result<()> {
        if self.typ != expected {
            return Err(ApiError::bad_input(format!(
                "wrong global id type \"{}\", expected \"{}\"",
                self.typ, expected
            ))
            .into());
        }
        Ok(())
    }

    pub fn i64_of_type(self, expected: GlobalIdType) -> Result<i64> {
        self.validate_type(expected)?;
        Ok(self.i64())
    }
}

fn encode_global_id(typ: GlobalIdType, id: i64) -> String {
    URL_SAFE_NO_PAD.encode(format!("{VERSION}:{typ}:{id}"))
}

fn invalid_global_id() -> ApiError {
    ApiError::bad_input("invalid global id")
}

impl fmt::Display for GlobalId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.encoded_string())
    }
}

impl JsonSchema for GlobalId {
    fn schema_name() -> Cow<'static, str> {
        "GlobalID".into()
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({"type": "string", "description": "Opaque global ID, as returned by other tool calls."})
    }

    fn inline_schema() -> bool {
        true
    }
}

impl Serialize for GlobalId {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.encoded_string())
    }
}

pub fn local_ids_of_type(ids: &[GlobalId], expected: GlobalIdType) -> Result<Vec<i64>> {
    ids.iter().copied().map(|id| id.i64_of_type(expected)).collect()
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(try_from = "String")]
pub struct Date(String);

impl Date {
    pub fn new(value: impl Into<String>) -> Result<Self> {
        let value = value.into();
        let date = NaiveDate::parse_from_str(&value, "%Y-%m-%d")
            .map_err(|error| ApiError::bad_input(format!("date must use YYYY-MM-DD: {error}")))?;
        if date.format("%Y-%m-%d").to_string() != value {
            return Err(ApiError::bad_input(format!("date must use YYYY-MM-DD: {value}")).into());
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for Date {
    type Error = anyhow::Error;

    fn try_from(value: String) -> Result<Self> {
        Self::new(value)
    }
}

impl JsonSchema for Date {
    fn schema_name() -> Cow<'static, str> {
        "Date".into()
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({"type": "string"})
    }

    fn inline_schema() -> bool {
        true
    }
}

impl Serialize for Date {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.0)
    }
}

#[cfg(test)]
mod tests {
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};

    use super::{Date, GlobalId, GlobalIdType, local_ids_of_type};

    #[test]
    fn global_ids_round_trip_and_serialize() {
        let id = GlobalId::new(GlobalIdType::Owner, 123);
        let encoded = id.encoded_string();

        assert_eq!(GlobalId::decode(&encoded).unwrap(), id);
        assert_eq!(serde_json::to_string(&id).unwrap(), format!("\"{encoded}\""));
        assert_eq!(GlobalId::new(GlobalIdType::Category, 1 << 32).i64(), 1 << 32);
    }

    #[test]
    fn rejects_all_invalid_global_id_forms() {
        for value in [
            "not?base64".to_owned(),
            raw("v1Account123"),
            raw(":Account:123"),
            raw("v2:Account:123"),
            raw("v1:Unknown:123"),
            raw("v1::123"),
            raw("v1:Account:"),
            raw("v1:Account:not-int"),
            raw("v1:Account:00123"),
        ] {
            assert_eq!(GlobalId::decode(&value).unwrap_err().to_string(), "invalid global id");
        }
    }

    #[test]
    fn preserves_asset_wire_compatibility_and_type_errors() {
        let encoded = raw("v1:Asset:123");
        let id = GlobalId::decode(&encoded).unwrap();

        assert_eq!(id.i64(), 123);
        assert_eq!(id.encoded_string(), encoded);
        assert_eq!(id.to_string(), encoded);
        assert!(id.validate_type(GlobalIdType::Asset).is_ok());
        assert_eq!(
            id.validate_type(GlobalIdType::Account).unwrap_err().to_string(),
            "wrong global id type \"Asset\", expected \"Account\""
        );
    }

    #[test]
    fn validates_type_specific_accessors_and_slices() {
        let owner = GlobalId::new(GlobalIdType::Owner, 42);
        let tag = GlobalId::new(GlobalIdType::Tag, 8);

        assert_eq!(owner.i64_of_type(GlobalIdType::Owner).unwrap(), 42);
        assert_eq!(local_ids_of_type(&[owner], GlobalIdType::Owner).unwrap(), [42]);
        assert_eq!(local_ids_of_type(&[tag], GlobalIdType::Tag).unwrap(), [8]);
        assert!(local_ids_of_type(&[owner], GlobalIdType::Tag).is_err());
    }

    #[test]
    fn dates_require_canonical_date_only_form() {
        assert_eq!(Date::new("2026-05-20").unwrap().as_str(), "2026-05-20");
        assert_eq!(
            serde_json::to_string(&Date::new("2026-05-20").unwrap()).unwrap(),
            "\"2026-05-20\""
        );
        for date in ["2026-5-2", "2026-05-20T00:00:00Z"] {
            assert!(Date::new(date).is_err());
        }
    }

    #[test]
    fn scalars_deserialize_and_describe_their_json_schema() {
        assert_eq!(
            serde_json::from_str::<Date>("\"2026-05-20\"").unwrap().as_str(),
            "2026-05-20"
        );
        let error = serde_json::from_str::<Date>("\"2026-5-2\"").unwrap_err().to_string();
        assert!(error.starts_with("date must use YYYY-MM-DD"), "{error}");
        assert_eq!(schemars::schema_for!(Date).to_value()["type"], "string");
        let global_id = schemars::schema_for!(GlobalId).to_value();
        assert_eq!(global_id["type"], "string");
        assert_eq!(
            global_id["description"],
            "Opaque global ID, as returned by other tool calls."
        );
    }

    fn raw(value: &str) -> String {
        URL_SAFE_NO_PAD.encode(value)
    }
}
