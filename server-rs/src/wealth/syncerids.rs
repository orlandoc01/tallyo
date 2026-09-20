use strum_macros::{Display, EnumString};

use crate::schema::AssetSourceAdapter;

#[derive(Clone, Copy, Debug, Display, EnumString, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
#[strum(serialize_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum SyncerId {
    Plaid,
    Simplefin,
    Debank,
    Manual,
    Realestate,
}

impl SyncerId {
    pub fn asset_source_adapter(self) -> Option<AssetSourceAdapter> {
        match self {
            Self::Plaid => Some(AssetSourceAdapter::Plaid),
            Self::Simplefin => Some(AssetSourceAdapter::Simplefin),
            Self::Debank => Some(AssetSourceAdapter::Debank),
            Self::Manual | Self::Realestate => None,
        }
    }
}

impl From<AssetSourceAdapter> for SyncerId {
    fn from(value: AssetSourceAdapter) -> Self {
        match value {
            AssetSourceAdapter::Plaid => Self::Plaid,
            AssetSourceAdapter::Simplefin => Self::Simplefin,
            AssetSourceAdapter::Debank => Self::Debank,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SyncerId;
    use crate::schema::AssetSourceAdapter;

    #[test]
    fn maps_persisted_and_graphql_adapter_ids() {
        for (syncer, adapter) in [
            (SyncerId::Plaid, AssetSourceAdapter::Plaid),
            (SyncerId::Simplefin, AssetSourceAdapter::Simplefin),
            (SyncerId::Debank, AssetSourceAdapter::Debank),
        ] {
            assert_eq!(syncer.asset_source_adapter(), Some(adapter));
            assert_eq!(SyncerId::from(adapter), syncer);
            assert_eq!(syncer.to_string().parse::<SyncerId>().unwrap(), syncer);
        }
        assert_eq!(SyncerId::Manual.asset_source_adapter(), None);
        assert_eq!(SyncerId::Realestate.asset_source_adapter(), None);
        assert_eq!(serde_json::to_string(&SyncerId::Realestate).unwrap(), "\"realestate\"");
    }
}
