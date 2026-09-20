use chrono::{DateTime, Utc};

use crate::{
    money::Cents,
    wealth::{AccountBalanceSnapshot, AssetDailyHolding, SnapshotPersist, SyncerId},
};

use super::{RealEstate, RealEstateDetails};

#[derive(Clone, Debug, PartialEq)]
pub struct CreateRealEstate {
    pub owner_id: i64,
    pub label: String,
    pub details: RealEstateDetails,
    pub initial_valuation: Option<RealEstateValuation>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct UpdateRealEstate {
    pub connection_id: i64,
    pub name: Option<String>,
    pub details: RealEstateDetails,
    pub valuation: Option<RealEstateValuation>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RealEstateValuation {
    pub value_usd: Cents,
    pub date: String,
    pub synced_at: DateTime<Utc>,
    pub source: SyncerId,
}

pub fn new_real_estate_snapshot(
    real_estate: &RealEstate,
    value_usd: Cents,
    source: SyncerId,
    date: String,
    synced_at: DateTime<Utc>,
) -> AccountBalanceSnapshot {
    let dollars = value_usd.dollars();
    AccountBalanceSnapshot {
        account_id: real_estate.account_id,
        wallet_address: String::new(),
        source: source.to_string(),
        date,
        synced_at: synced_at.to_rfc3339(),
        balance_usd: value_usd,
        raw_payload: None,
        holdings: vec![AssetDailyHolding {
            asset_id: real_estate.asset_id,
            asset: None,
            adapter_source: None,
            adapter_sources: Vec::new(),
            price_update: None,
            quantity: Some(1.0),
            price: Some(dollars),
            value_usd: dollars,
            counts_toward_value: true,
            manual: true,
            line_type: String::new(),
            chain_id: String::new(),
            project_name: None,
            token_id: String::new(),
            identifier: String::new(),
            token_symbol: None,
            token_name: None,
            provider_price: None,
        }],
        flagged: false,
        flag_reason: String::new(),
    }
}

impl RealEstateValuation {
    pub fn persist(&self, real_estate: &RealEstate) -> SnapshotPersist {
        SnapshotPersist {
            snapshot: new_real_estate_snapshot(
                real_estate,
                self.value_usd,
                self.source,
                self.date.clone(),
                self.synced_at,
            ),
            synced_at: self.synced_at,
            expire_review: false,
            recovery: None,
            review: None,
            provider_state: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::{RealEstate, RealEstateDetails, RealEstateValuation, new_real_estate_snapshot};
    use crate::{money::Cents, wealth::SyncerId};

    #[test]
    fn valuations_create_one_manual_holding() {
        let real_estate = RealEstate {
            asset_id: 1,
            account_id: 2,
            connection_id: 3,
            owner_id: 4,
            name: "Home".to_owned(),
            details: RealEstateDetails {
                street: None,
                city: None,
                state: None,
                zip: None,
                home_type: None,
            },
        };
        let valuation = RealEstateValuation {
            value_usd: Cents(123_456),
            date: "2026-09-06".to_owned(),
            synced_at: Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap(),
            source: SyncerId::Realestate,
        };

        let snapshot = new_real_estate_snapshot(
            &real_estate,
            valuation.value_usd,
            valuation.source,
            valuation.date,
            valuation.synced_at,
        );
        assert_eq!(snapshot.balance_usd, Cents(123_456));
        assert_eq!(snapshot.holdings[0].quantity, Some(1.0));
        assert!(snapshot.holdings[0].manual);
    }
}
