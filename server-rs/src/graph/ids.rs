use anyhow::Result;
use async_graphql::ID;

use crate::ids::{GlobalId, GlobalIdType};

pub(super) fn decode(id: &ID) -> Result<GlobalId> {
    GlobalId::decode(id.as_str())
}

pub(super) fn local_id(id: &ID, expected: GlobalIdType) -> Result<i64> {
    decode(id)?.i64_of_type(expected)
}

pub(super) fn validate_id(id: &ID, expected: GlobalIdType) -> Result<()> {
    local_id(id, expected).map(drop)
}

pub(super) fn validate_optional_id(id: Option<&ID>, expected: GlobalIdType) -> Result<()> {
    id.map_or(Ok(()), |id| validate_id(id, expected))
}

// Go's LocalInt64IDsOfTypePtr: an absent list decodes to no ids.
pub(super) fn local_ids(ids: Option<&[ID]>, expected: GlobalIdType) -> Result<Vec<i64>> {
    ids.unwrap_or_default()
        .iter()
        .map(|id| local_id(id, expected))
        .collect()
}

pub(super) fn validate_ids(ids: Option<&[ID]>, expected: GlobalIdType) -> Result<()> {
    local_ids(ids, expected).map(drop)
}
