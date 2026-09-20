use anyhow::Result;
use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::{
    schema::AssetType,
    wealth::{AssetUpsert, RealEstateDetails},
};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct SecurityAdditional {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plaid_security_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cusip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub isin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub simple_fin_cost_basis: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub simple_fin_purchase_price: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct CryptoAdditional {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chain_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_symbol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct RealEstateAdditional {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub street: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub home_type: Option<String>,
}

pub(super) fn additional_from_upsert(asset: &AssetUpsert) -> Result<Option<String>> {
    match asset.asset_type {
        AssetType::Security => encode(&SecurityAdditional {
            plaid_security_type: asset.plaid_security_type.clone(),
            cusip: asset.cusip.clone(),
            isin: asset.isin.clone(),
            simple_fin_cost_basis: asset.simple_fin_cost_basis.clone(),
            simple_fin_purchase_price: asset.simple_fin_purchase_price.clone(),
        }),
        AssetType::Crypto => encode(&CryptoAdditional {
            line_type: asset.line_type.clone(),
            chain_id: asset.chain_id.clone(),
            token_id: asset.token_id.clone(),
            token_symbol: asset.token_symbol.clone(),
            token_name: asset.token_name.clone(),
            project_name: asset.project_name.clone(),
        }),
        AssetType::RealEstate => asset
            .real_estate
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("real estate asset {:?} missing address details", asset.identifier))
            .and_then(|details| encode(&real_estate_additional(details))),
        AssetType::Currency | AssetType::Other => Ok(None),
    }
}

pub(super) fn merge_additional(
    asset_type: AssetType,
    current: Option<&str>,
    next: Option<&str>,
) -> Result<Option<String>> {
    if next.is_none() {
        return Ok(current.filter(|current| !current.is_empty()).map(ToOwned::to_owned));
    }
    match asset_type {
        AssetType::Security => merge_json(current, next, merge_security),
        AssetType::Crypto => merge_json(current, next, merge_crypto),
        AssetType::RealEstate => merge_json(current, next, merge_real_estate),
        AssetType::Currency | AssetType::Other => Ok(None),
    }
}

fn encode(value: &impl Serialize) -> Result<Option<String>> {
    let value = serde_json::to_string(value).map_err(|error| anyhow::anyhow!("encode asset additional: {error}"))?;
    Ok((value != "{}").then_some(value))
}

fn merge_json<T>(current: Option<&str>, next: Option<&str>, merge: impl FnOnce(T, T) -> T) -> Result<Option<String>>
where
    T: Default + DeserializeOwned + Serialize,
{
    let current = current
        .filter(|value| !value.is_empty())
        .map(serde_json::from_str)
        .transpose()
        .map_err(|error| anyhow::anyhow!("decode asset additional: {error}"))?
        .unwrap_or_default();
    let next = next
        .filter(|value| !value.is_empty())
        .map(serde_json::from_str)
        .transpose()
        .map_err(|error| anyhow::anyhow!("decode asset additional: {error}"))?
        .unwrap_or_default();
    encode(&merge(current, next))
}

fn merge_security(current: SecurityAdditional, next: SecurityAdditional) -> SecurityAdditional {
    SecurityAdditional {
        plaid_security_type: next.plaid_security_type.or(current.plaid_security_type),
        cusip: next.cusip.or(current.cusip),
        isin: next.isin.or(current.isin),
        simple_fin_cost_basis: next.simple_fin_cost_basis.or(current.simple_fin_cost_basis),
        simple_fin_purchase_price: next.simple_fin_purchase_price.or(current.simple_fin_purchase_price),
    }
}

fn merge_crypto(current: CryptoAdditional, next: CryptoAdditional) -> CryptoAdditional {
    CryptoAdditional {
        line_type: next.line_type.or(current.line_type),
        chain_id: next.chain_id.or(current.chain_id),
        token_id: next.token_id.or(current.token_id),
        token_symbol: next.token_symbol.or(current.token_symbol),
        token_name: next.token_name.or(current.token_name),
        project_name: next.project_name.or(current.project_name),
    }
}

fn merge_real_estate(current: RealEstateAdditional, next: RealEstateAdditional) -> RealEstateAdditional {
    RealEstateAdditional {
        street: next.street.or(current.street),
        city: next.city.or(current.city),
        state: next.state.or(current.state),
        zip: next.zip.or(current.zip),
        home_type: next.home_type.or(current.home_type),
    }
}

pub(super) fn real_estate_additional(details: &RealEstateDetails) -> RealEstateAdditional {
    RealEstateAdditional {
        street: details.street.clone(),
        city: details.city.clone(),
        state: details.state.clone(),
        zip: details.zip.clone(),
        home_type: details.home_type.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::{additional_from_upsert, merge_additional};
    use crate::{
        schema::{AssetClassifier, AssetType},
        wealth::{AssetUpsert, RealEstateDetails},
    };

    fn asset(asset_type: AssetType) -> AssetUpsert {
        AssetUpsert {
            asset_type,
            identifier: "asset".to_owned(),
            name: None,
            classifier: AssetClassifier::Public,
            user_edited: false,
            user_created: false,
            forced_usd_price: None,
            tracking_ticker: None,
            tracking_multiplier: 1.0,
            last_price: None,
            last_price_at: None,
            adapter_source: None,
            plaid_security_type: None,
            cusip: None,
            isin: None,
            simple_fin_cost_basis: None,
            simple_fin_purchase_price: None,
            line_type: None,
            chain_id: None,
            token_id: None,
            token_symbol: None,
            token_name: None,
            project_name: None,
            real_estate: None,
        }
    }

    #[test]
    fn encodes_only_relevant_asset_metadata() {
        let mut security = asset(AssetType::Security);
        security.cusip = Some("CUSIP".to_owned());
        assert_eq!(
            additional_from_upsert(&security).unwrap().as_deref(),
            Some(r#"{"cusip":"CUSIP"}"#)
        );

        let mut crypto = asset(AssetType::Crypto);
        crypto.token_symbol = Some("ETH".to_owned());
        assert_eq!(
            additional_from_upsert(&crypto).unwrap().as_deref(),
            Some(r#"{"token_symbol":"ETH"}"#)
        );
        assert_eq!(additional_from_upsert(&asset(AssetType::Other)).unwrap(), None);
    }

    #[test]
    fn merges_metadata_and_requires_real_estate_details() {
        assert_eq!(
            merge_additional(
                AssetType::Security,
                Some(r#"{"cusip":"old","isin":"isin"}"#),
                Some(r#"{"cusip":"new"}"#),
            )
            .unwrap()
            .as_deref(),
            Some(r#"{"cusip":"new","isin":"isin"}"#)
        );
        assert_eq!(
            merge_additional(AssetType::Crypto, Some("metadata"), None)
                .unwrap()
                .as_deref(),
            Some("metadata")
        );
        assert!(additional_from_upsert(&asset(AssetType::RealEstate)).is_err());

        let mut property = asset(AssetType::RealEstate);
        property.real_estate = Some(RealEstateDetails {
            street: Some("1 Main".to_owned()),
            city: None,
            state: None,
            zip: None,
            home_type: None,
        });
        assert_eq!(
            additional_from_upsert(&property).unwrap().as_deref(),
            Some(r#"{"street":"1 Main"}"#)
        );
    }
}
