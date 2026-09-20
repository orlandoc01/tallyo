use anyhow::{Result, ensure};
use chrono::Utc;

use crate::{
    apierror::ApiError,
    schema::{AssetClassifier, AssetType, CreateAssetInput, UpdateAssetInput},
};

use super::{Asset, AssetUpsert, WealthService, normalize_tracking, store, validate_tracking_multiplier};

impl WealthService {
    pub async fn create_asset(&self, input: CreateAssetInput) -> Result<Asset> {
        let identifier = input.identifier.trim();
        ensure!(!identifier.is_empty(), ApiError::bad_input("identifier is required"));
        ensure!(
            input.asset_type != AssetType::RealEstate,
            ApiError::bad_input("real estate assets are created through linked real estate accounts")
        );
        validate_create_asset_classifier(input.asset_type, input.classifier)?;
        ensure!(
            input.security.is_none() || input.asset_type == AssetType::Security,
            ApiError::bad_input("security details are only supported for security assets")
        );
        let tracking_ticker = trim_optional(input.tracking_ticker.as_deref());
        let tracking_multiplier = input.tracking_multiplier.unwrap_or(1.0);
        validate_create_asset_tracking(
            input.asset_type,
            input.classifier,
            input.tracking_ticker.is_some() || input.tracking_multiplier.is_some(),
            identifier,
            tracking_ticker.as_deref(),
            tracking_multiplier,
        )?;
        let (tracking_ticker, tracking_multiplier) =
            normalize_tracking(identifier, tracking_ticker.as_deref(), tracking_multiplier);
        ensure!(
            store::asset_by_key(&self.pool, input.asset_type, identifier)
                .await?
                .is_none(),
            ApiError::bad_input(format!(
                "an asset with identifier {identifier:?} already exists for type {:?}",
                input.asset_type
            ))
        );
        let (last_price, last_price_at) = if input.asset_type == AssetType::Security && input.forced_usd_price.is_none()
        {
            self.create_asset_market_price(
                input.asset_type,
                identifier,
                tracking_ticker.as_deref(),
                tracking_multiplier,
            )
            .await
        } else {
            (None, None)
        };
        store::upsert_asset(
            &self.pool,
            AssetUpsert {
                asset_type: input.asset_type,
                identifier: identifier.to_owned(),
                name: trim_optional(input.name.as_deref()),
                classifier: input.classifier,
                user_edited: true,
                user_created: true,
                forced_usd_price: input.forced_usd_price,
                tracking_ticker,
                tracking_multiplier,
                last_price,
                last_price_at,
                adapter_source: None,
                plaid_security_type: None,
                cusip: input
                    .security
                    .as_ref()
                    .and_then(|security| trim_optional(security.cusip.as_deref())),
                isin: input
                    .security
                    .as_ref()
                    .and_then(|security| trim_optional(security.isin.as_deref())),
                simple_fin_cost_basis: None,
                simple_fin_purchase_price: None,
                line_type: None,
                chain_id: None,
                token_id: None,
                token_symbol: None,
                token_name: None,
                project_name: None,
                real_estate: None,
            },
        )
        .await
    }

    pub async fn update_asset(&self, mut input: UpdateAssetInput) -> Result<Asset> {
        let asset_id = asset_id(&input)?;
        let existing = store::asset_by_id(&self.pool, asset_id)
            .await?
            .ok_or_else(|| ApiError::bad_input(format!("asset {asset_id} not found")))?;
        let identifier_changing = input
            .identifier
            .as_deref()
            .is_some_and(|identifier| identifier != existing.identifier);
        let tracking_changing = self.resolve_tracking_input(&mut input, &existing).await?;
        let mut asset = store::update_asset(&self.pool, asset_id, &input).await?;
        let forced_price_set = input.force_price.unwrap_or(input.forced_usd_price.is_some());
        let forced_price_cleared = input.force_price == Some(false);
        if let Some(price) = forced_price_value(&input) {
            let _ = store::revalue_latest_asset_holdings(&self.pool, asset.id, price).await;
        }
        if forced_price_cleared
            && !identifier_changing
            && !tracking_changing
            && let Some(price) = self.market_price_value(&asset).await
        {
            let _ = store::revalue_latest_asset_holdings(&self.pool, asset.id, price).await;
        }
        if (identifier_changing || tracking_changing) && !forced_price_set && asset.forced_usd_price.is_none() {
            asset = self.refresh_changed_asset_market_price(&input, asset).await?;
        }
        Ok(asset)
    }

    async fn create_asset_market_price(
        &self,
        asset_type: AssetType,
        identifier: &str,
        tracking_ticker: Option<&str>,
        tracking_multiplier: f64,
    ) -> (Option<f64>, Option<chrono::DateTime<Utc>>) {
        let now = Utc::now();
        let asset = Asset {
            id: 0,
            asset_type,
            identifier: identifier.to_owned(),
            name: None,
            classifier: AssetClassifier::Public,
            current_price: None,
            forced_usd_price: None,
            tracking_ticker: tracking_ticker.map(ToOwned::to_owned),
            tracking_multiplier,
            price_connectivity: crate::schema::ConnectivityStatus::Healthy,
            investment_connectivity: crate::schema::ConnectivityStatus::Healthy,
        };
        match self.price_provider.as_ref() {
            Some(provider) => match provider.price_at(&asset, now).await {
                Ok(price) if price > 0.0 => (Some(price), Some(now)),
                Ok(_) | Err(_) => (None, None),
            },
            None => (None, None),
        }
    }

    async fn resolve_tracking_input(&self, input: &mut UpdateAssetInput, existing: &Asset) -> Result<bool> {
        let identifier_changing = input
            .identifier
            .as_deref()
            .is_some_and(|identifier| identifier != existing.identifier);
        let classifier_changing = input
            .classifier
            .is_some_and(|classifier| classifier != existing.classifier);
        if !identifier_changing
            && !classifier_changing
            && input.tracking_ticker.is_none()
            && input.tracking_multiplier.is_none()
        {
            return Ok(false);
        }
        let fields = combine_tracking_fields(input, existing)?;
        if tracking_pair_equal(existing, fields.ticker.as_deref(), fields.multiplier) {
            input.tracking_ticker = None;
            input.tracking_multiplier = None;
            return Ok(false);
        }
        if fields.ticker.is_some() {
            let asset = Asset {
                identifier: fields.identifier.clone(),
                tracking_ticker: fields.ticker.clone(),
                tracking_multiplier: fields.multiplier,
                ..existing.clone()
            };
            self.validate_ticker_priceable(&asset).await?;
        }
        input.tracking_ticker = fields.ticker;
        input.tracking_multiplier = Some(fields.multiplier);
        Ok(true)
    }

    async fn validate_ticker_priceable(&self, asset: &Asset) -> Result<()> {
        let ticker = effective_ticker(asset);
        if let Some(provider) = self.price_provider.as_ref() {
            provider.validate_ticker(ticker).await.map_err(|error| {
                ApiError::public(anyhow::anyhow!(
                    "tracking ticker {ticker:?} could not be priced: {error}"
                ))
            })?;
        }
        Ok(())
    }

    async fn market_price_value(&self, asset: &Asset) -> Option<f64> {
        if asset.asset_type == AssetType::Security
            && let Some(provider) = self.price_provider.as_ref()
            && let Ok(price) = provider.price_at(asset, Utc::now()).await
            && price > 0.0
        {
            return Some(price);
        }
        asset.current_price
    }
}

struct TrackingFields {
    identifier: String,
    ticker: Option<String>,
    multiplier: f64,
}

fn asset_id(input: &UpdateAssetInput) -> Result<i64> {
    crate::ids::GlobalId::decode(input.id.as_str())?.i64_of_type(crate::ids::GlobalIdType::Asset)
}

fn validate_create_asset_classifier(asset_type: AssetType, classifier: AssetClassifier) -> Result<()> {
    let allowed = match asset_type {
        AssetType::Currency => [AssetClassifier::Cash].as_slice(),
        AssetType::Security => [AssetClassifier::Public, AssetClassifier::CompanyEquity].as_slice(),
        AssetType::Crypto => [AssetClassifier::Cryptocurrency, AssetClassifier::Stablecoin].as_slice(),
        AssetType::Other => [
            AssetClassifier::Cash,
            AssetClassifier::Public,
            AssetClassifier::CompanyEquity,
            AssetClassifier::Cryptocurrency,
            AssetClassifier::Stablecoin,
            AssetClassifier::RealEstate,
        ]
        .as_slice(),
        AssetType::RealEstate => [].as_slice(),
    };
    ensure!(
        allowed.contains(&classifier),
        ApiError::bad_input(format!(
            "classifier {classifier:?} is not valid for asset type {asset_type:?}"
        ))
    );
    Ok(())
}

fn validate_create_asset_tracking(
    asset_type: AssetType,
    classifier: AssetClassifier,
    supplied: bool,
    identifier: &str,
    ticker: Option<&str>,
    multiplier: f64,
) -> Result<()> {
    if !supplied {
        return Ok(());
    }
    ensure!(
        asset_type == AssetType::Security && supports_tracking(classifier),
        ApiError::bad_input("tracking ticker is only supported for public or company-equity security assets")
    );
    validate_tracking_multiplier(multiplier)?;
    let (ticker, _) = normalize_tracking(identifier, ticker, multiplier);
    ensure!(
        ticker.is_some() || multiplier == 1.0,
        ApiError::bad_input("tracking multiplier requires a tracking ticker different from the identifier")
    );
    Ok(())
}

fn combine_tracking_fields(input: &UpdateAssetInput, existing: &Asset) -> Result<TrackingFields> {
    let identifier = input.identifier.clone().unwrap_or_else(|| existing.identifier.clone());
    let classifier = input.classifier.unwrap_or(existing.classifier);
    let multiplier = input.tracking_multiplier.unwrap_or(existing.tracking_multiplier);
    validate_tracking_multiplier(multiplier)?;
    let ticker = input
        .tracking_ticker
        .as_deref()
        .map(|ticker| trim_optional(Some(ticker)))
        .unwrap_or_else(|| existing.tracking_ticker.clone());
    if existing.asset_type != AssetType::Security || !supports_tracking(classifier) {
        ensure!(
            ticker.is_none(),
            ApiError::bad_input(
                "tracking ticker is only supported for public or company-equity security assets; clear the tracking ticker in the same request"
            )
        );
        return Ok(TrackingFields {
            identifier,
            ticker: None,
            multiplier: 1.0,
        });
    }
    let (ticker, multiplier) = normalize_tracking(&identifier, ticker.as_deref(), multiplier);
    ensure!(
        ticker.is_some() || input.tracking_multiplier.is_none() || multiplier == 1.0,
        ApiError::bad_input("tracking multiplier requires a tracking ticker different from the identifier")
    );
    Ok(TrackingFields {
        identifier,
        ticker,
        multiplier,
    })
}

fn tracking_pair_equal(existing: &Asset, ticker: Option<&str>, multiplier: f64) -> bool {
    trim_optional(existing.tracking_ticker.as_deref()).as_deref() == ticker
        && existing.tracking_multiplier == multiplier
}

fn supports_tracking(classifier: AssetClassifier) -> bool {
    matches!(classifier, AssetClassifier::Public | AssetClassifier::CompanyEquity)
}

fn forced_price_value(input: &UpdateAssetInput) -> Option<f64> {
    (input.force_price != Some(false))
        .then_some(input.forced_usd_price)
        .flatten()
}

pub(super) fn effective_ticker(asset: &Asset) -> &str {
    asset.tracking_ticker.as_deref().unwrap_or(&asset.identifier)
}

fn trim_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::{
        combine_tracking_fields, effective_ticker, forced_price_value, tracking_pair_equal, trim_optional,
        validate_create_asset_classifier, validate_create_asset_tracking,
    };
    use crate::{
        ids::{GlobalId, GlobalIdType},
        schema::{
            AssetClassifier, AssetType, ConnectivityStatus, CreateAssetInput, CreateSecurityAssetInput,
            UpdateAssetInput,
        },
        wealth::{Asset, WealthService},
    };

    fn asset() -> Asset {
        Asset {
            id: 1,
            asset_type: AssetType::Security,
            identifier: "VTI".to_owned(),
            name: None,
            classifier: AssetClassifier::Public,
            current_price: Some(42.0),
            forced_usd_price: None,
            tracking_ticker: Some("VXUS".to_owned()),
            tracking_multiplier: 2.0,
            price_connectivity: ConnectivityStatus::Healthy,
            investment_connectivity: ConnectivityStatus::Healthy,
        }
    }

    fn update_input() -> UpdateAssetInput {
        UpdateAssetInput {
            id: async_graphql::ID::from("asset"),
            identifier: None,
            name: None,
            classifier: None,
            force_price: None,
            forced_usd_price: None,
            tracking_ticker: None,
            tracking_multiplier: None,
            price_connectivity: None,
            security: None,
            investment_connectivity: None,
        }
    }

    #[test]
    fn only_accepts_classifiers_that_match_the_asset_type() {
        assert!(validate_create_asset_classifier(AssetType::Security, AssetClassifier::Public).is_ok());
        assert_eq!(
            validate_create_asset_classifier(AssetType::Currency, AssetClassifier::Public)
                .unwrap_err()
                .to_string(),
            "classifier Public is not valid for asset type Currency"
        );
    }

    #[test]
    fn clears_tracking_when_the_classifier_no_longer_supports_it() {
        let input = UpdateAssetInput {
            classifier: Some(AssetClassifier::Cash),
            tracking_ticker: Some(String::new()),
            ..update_input()
        };
        let existing = asset();

        let fields = combine_tracking_fields(&input, &existing).unwrap();

        assert_eq!(fields.ticker, None);
        assert_eq!(fields.multiplier, 1.0);
    }

    #[test]
    fn validates_tracking_only_for_supported_security_assets() {
        assert!(
            validate_create_asset_tracking(
                AssetType::Security,
                AssetClassifier::Public,
                true,
                "VTI",
                Some("VXUS"),
                2.0,
            )
            .is_ok()
        );
        assert!(
            validate_create_asset_tracking(AssetType::Security, AssetClassifier::Public, true, "VTI", None, 2.0,)
                .is_err()
        );
        assert!(
            validate_create_asset_tracking(
                AssetType::Crypto,
                AssetClassifier::Cryptocurrency,
                true,
                "ETH",
                Some("BTC"),
                1.0,
            )
            .is_err()
        );
        assert!(
            validate_create_asset_tracking(
                AssetType::Security,
                AssetClassifier::Public,
                true,
                "VTI",
                Some("VXUS"),
                0.0,
            )
            .is_err()
        );
    }

    #[test]
    fn combines_and_compares_normalized_tracking_fields() {
        let input = UpdateAssetInput {
            identifier: Some(" SCHD ".to_owned()),
            tracking_ticker: Some(" VYM ".to_owned()),
            tracking_multiplier: Some(1.5),
            ..update_input()
        };
        let existing = asset();

        let fields = combine_tracking_fields(&input, &existing).unwrap();

        assert_eq!(fields.identifier, " SCHD ");
        assert_eq!(fields.ticker.as_deref(), Some("VYM"));
        assert_eq!(fields.multiplier, 1.5);
        assert!(tracking_pair_equal(&existing, Some("VXUS"), 2.0));
        assert!(!tracking_pair_equal(&existing, Some("VYM"), 2.0));
        assert_eq!(effective_ticker(&existing), "VXUS");
        assert_eq!(trim_optional(Some("  VTI  ")), Some("VTI".to_owned()));
        assert_eq!(trim_optional(Some(" ")), None);
    }

    #[test]
    fn derives_forced_price_only_when_not_clearing_it() {
        let input = UpdateAssetInput {
            force_price: Some(true),
            forced_usd_price: Some(12.5),
            ..update_input()
        };

        assert_eq!(forced_price_value(&input), Some(12.5));
        assert_eq!(
            forced_price_value(&UpdateAssetInput {
                force_price: Some(false),
                forced_usd_price: Some(12.5),
                ..update_input()
            }),
            None
        );
    }

    #[tokio::test]
    async fn falls_back_without_a_price_provider() {
        let service = WealthService::new(sqlx::SqlitePool::connect_lazy("sqlite::memory:").unwrap(), None, || {
            "UTC".to_owned()
        });
        let asset = asset();
        let mut input = update_input();

        assert_eq!(
            service
                .create_asset_market_price(AssetType::Security, "VTI", None, 1.0)
                .await,
            (None, None)
        );
        assert_eq!(service.market_price_value(&asset).await, Some(42.0));
        assert!(!service.resolve_tracking_input(&mut input, &asset).await.unwrap());
        assert!(service.validate_ticker_priceable(&asset).await.is_ok());
    }

    #[tokio::test]
    async fn creates_updates_and_clears_forced_asset_prices() {
        let service = WealthService::new(crate::database::dbtest::open().await.unwrap(), None, || {
            "UTC".to_owned()
        });
        let input = CreateAssetInput {
            asset_type: AssetType::Security,
            identifier: "VTI".to_owned(),
            name: Some("Vanguard Total Stock Market ETF".to_owned()),
            classifier: AssetClassifier::Public,
            forced_usd_price: Some(10.0),
            tracking_ticker: Some("VXUS".to_owned()),
            tracking_multiplier: Some(2.0),
            security: Some(CreateSecurityAssetInput {
                cusip: Some(" 922908728 ".to_owned()),
                isin: Some(" US9229087284 ".to_owned()),
            }),
        };
        let created = service.create_asset(input.clone()).await.unwrap();

        assert_eq!(created.forced_usd_price, Some(10.0));
        assert_eq!(created.tracking_ticker.as_deref(), Some("VXUS"));
        assert!(service.create_asset(input).await.is_err());

        let updated = service
            .update_asset(UpdateAssetInput {
                id: GlobalId::new(GlobalIdType::Asset, created.id).encoded_string().into(),
                identifier: Some("SCHD".to_owned()),
                force_price: Some(true),
                forced_usd_price: Some(12.0),
                ..update_input()
            })
            .await
            .unwrap();
        assert_eq!(updated.identifier, "SCHD");
        assert_eq!(updated.forced_usd_price, Some(12.0));

        let cleared = service
            .update_asset(UpdateAssetInput {
                id: GlobalId::new(GlobalIdType::Asset, created.id).encoded_string().into(),
                force_price: Some(false),
                ..update_input()
            })
            .await
            .unwrap();
        assert_eq!(cleared.forced_usd_price, None);
    }
}
