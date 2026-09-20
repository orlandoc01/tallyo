use crate::{database::queries, schema::AssetType};
use anyhow::{Context, Result};

use super::asset_additional::{CryptoAdditional, RealEstateAdditional, SecurityAdditional};
use crate::wealth::{Address, Asset, AssetRecord, CryptoAssetDetails, SecurityAssetDetails};

impl TryFrom<queries::Assets> for AssetRecord {
    type Error = anyhow::Error;

    fn try_from(row: queries::Assets) -> Result<Self> {
        let asset_type = row
            .asset_type
            .parse()
            .with_context(|| format!("parse asset type {:?}", row.asset_type))?;
        let details = asset_details(asset_type, row.additional.as_deref())?;
        Ok(Self {
            asset: Asset {
                id: row.id,
                asset_type,
                identifier: row.identifier,
                name: row.name,
                classifier: row
                    .classifier
                    .parse()
                    .with_context(|| format!("parse asset classifier {:?}", row.classifier))?,
                current_price: row.last_price,
                forced_usd_price: row.forced_usd_price,
                tracking_ticker: row.tracking_ticker,
                tracking_multiplier: row.tracking_multiplier,
                price_connectivity: row
                    .price_connectivity
                    .parse()
                    .with_context(|| format!("parse price connectivity {:?}", row.price_connectivity))?,
                investment_connectivity: row
                    .investment_connectivity
                    .parse()
                    .with_context(|| format!("parse investment connectivity {:?}", row.investment_connectivity))?,
            },
            address: details.address,
            security: details.security,
            crypto: details.crypto,
            user_edited: row.user_edited,
        })
    }
}

impl TryFrom<queries::Assets> for Asset {
    type Error = anyhow::Error;

    fn try_from(row: queries::Assets) -> Result<Self> {
        AssetRecord::try_from(row).map(|record| record.asset)
    }
}

impl TryFrom<queries::UpsertAssetRowRow> for Asset {
    type Error = anyhow::Error;

    fn try_from(row: queries::UpsertAssetRowRow) -> Result<Self> {
        queries::Assets {
            additional: row.additional,
            asset_type: row.asset_type,
            classifier: row.classifier,
            created_at: row.created_at,
            forced_usd_price: row.forced_usd_price,
            id: row.id,
            identifier: row.identifier,
            investment_connectivity: row.investment_connectivity,
            last_price: row.last_price,
            last_price_at: row.last_price_at,
            name: row.name,
            price_connectivity: row.price_connectivity,
            tracking_multiplier: row.tracking_multiplier,
            tracking_ticker: row.tracking_ticker,
            updated_at: row.updated_at,
            user_created: row.user_created,
            user_edited: row.user_edited,
        }
        .try_into()
    }
}

#[derive(Default)]
struct AssetTypeDetails {
    address: Option<Address>,
    security: Option<SecurityAssetDetails>,
    crypto: Option<CryptoAssetDetails>,
}

fn asset_details(asset_type: AssetType, additional: Option<&str>) -> Result<AssetTypeDetails> {
    let Some(additional) = additional.filter(|additional| !additional.is_empty()) else {
        return Ok(AssetTypeDetails::default());
    };
    let decoded = match asset_type {
        AssetType::Security => AssetTypeDetails {
            security: Some(serde_json::from_str::<SecurityAdditional>(additional).map(|details| {
                SecurityAssetDetails {
                    cusip: details.cusip,
                    isin: details.isin,
                }
            })?),
            ..Default::default()
        },
        AssetType::Crypto => AssetTypeDetails {
            crypto: Some(
                serde_json::from_str::<CryptoAdditional>(additional).map(|details| CryptoAssetDetails {
                    chain_id: details.chain_id,
                    token_symbol: details.token_symbol,
                    token_name: details.token_name,
                    project_name: details.project_name,
                })?,
            ),
            ..Default::default()
        },
        AssetType::RealEstate => AssetTypeDetails {
            address: Some(
                serde_json::from_str::<RealEstateAdditional>(additional).map(|address| Address {
                    street: address.street,
                    city: address.city,
                    state: address.state,
                    zip: address.zip,
                    home_type: address.home_type,
                })?,
            ),
            ..Default::default()
        },
        AssetType::Currency | AssetType::Other => AssetTypeDetails::default(),
    };
    Ok(decoded)
}

#[cfg(test)]
mod tests {
    use crate::{
        database::{Timestamp, queries},
        schema::{AssetClassifier, AssetType, ConnectivityStatus},
        wealth::AssetRecord,
    };

    #[test]
    fn converts_real_estate_rows_without_exposing_storage_json() {
        let record = AssetRecord::try_from(queries::Assets {
            additional: Some(r#"{"street":"1 Main","city":"Austin"}"#.to_owned()),
            asset_type: "REAL_ESTATE".to_owned(),
            classifier: "REAL_ESTATE".to_owned(),
            created_at: Timestamp("2026-09-06T12:00:00Z".parse().unwrap()),
            forced_usd_price: None,
            id: 1,
            identifier: "home".to_owned(),
            investment_connectivity: "HEALTHY".to_owned(),
            last_price: None,
            last_price_at: None,
            name: None,
            price_connectivity: "HEALTHY".to_owned(),
            tracking_multiplier: 1.0,
            tracking_ticker: None,
            updated_at: Timestamp("2026-09-06T12:00:00Z".parse().unwrap()),
            user_created: true,
            user_edited: true,
        })
        .unwrap();

        assert_eq!(record.asset.asset_type, AssetType::RealEstate);
        assert_eq!(record.asset.classifier, AssetClassifier::RealEstate);
        assert_eq!(record.asset.price_connectivity, ConnectivityStatus::Healthy);
        assert!(record.user_edited);
        let address = record.address.expect("real estate address must be present");
        assert_eq!(address.street.as_deref(), Some("1 Main"));
        assert_eq!(address.city.as_deref(), Some("Austin"));
        assert_eq!(address.zip, None);
    }

    #[test]
    fn preserves_security_and_crypto_metadata_from_storage() {
        let base = |asset_type: &str, additional: &str| queries::Assets {
            additional: Some(additional.to_owned()),
            asset_type: asset_type.to_owned(),
            classifier: "PUBLIC".to_owned(),
            created_at: Timestamp("2026-09-06T12:00:00Z".parse().unwrap()),
            forced_usd_price: None,
            id: 1,
            identifier: "asset".to_owned(),
            investment_connectivity: "HEALTHY".to_owned(),
            last_price: None,
            last_price_at: None,
            name: None,
            price_connectivity: "HEALTHY".to_owned(),
            tracking_multiplier: 1.0,
            tracking_ticker: None,
            updated_at: Timestamp("2026-09-06T12:00:00Z".parse().unwrap()),
            user_created: false,
            user_edited: false,
        };
        let security = AssetRecord::try_from(base("SECURITY", r#"{"cusip":"123","isin":"US123"}"#)).unwrap();
        let crypto = AssetRecord::try_from(base(
            "CRYPTO",
            r#"{"chain_id":"eth","token_symbol":"ETH","token_name":"Ethereum","project_name":"Native"}"#,
        ))
        .unwrap();

        let security = security.security.unwrap();
        let crypto = crypto.crypto.unwrap();
        assert_eq!(security.cusip.as_deref(), Some("123"));
        assert_eq!(security.isin.as_deref(), Some("US123"));
        assert_eq!(crypto.chain_id.as_deref(), Some("eth"));
        assert_eq!(crypto.project_name.as_deref(), Some("Native"));
    }
}
