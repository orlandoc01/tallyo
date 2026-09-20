use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use crate::{
    clients::yahoo::{self, Yahoo},
    schema::{AssetType, ConnectivityStatus},
    wealth::{Asset, store},
};

const CACHE_TTL: Duration = Duration::from_secs(30 * 60);
const CACHE_MAX_ENTRIES: usize = 256;

#[derive(Clone, Copy)]
struct CachedPrice {
    price: f64,
    expires_at: std::time::Instant,
}

#[derive(Clone)]
pub struct YahooPriceProvider {
    pool: SqlitePool,
    client: Yahoo,
    cache: Arc<Mutex<HashMap<String, CachedPrice>>>,
}

impl YahooPriceProvider {
    pub fn new(pool: SqlitePool) -> Result<Self> {
        Ok(Self::with_client(pool, Yahoo::new()?))
    }

    pub fn with_client(pool: SqlitePool, client: Yahoo) -> Self {
        Self {
            pool,
            client,
            cache: Arc::default(),
        }
    }

    pub async fn price_at(&self, asset: &Asset, date: DateTime<Utc>) -> Result<f64> {
        if asset.asset_type == AssetType::Currency && asset.identifier == "USD" {
            return Ok(1.0);
        }
        if asset.asset_type == AssetType::Currency
            || matches!(
                asset.price_connectivity,
                ConnectivityStatus::Ignore | ConnectivityStatus::NotFound
            )
        {
            return Ok(fallback(asset));
        }
        let ticker = effective_ticker(asset);
        if yahoo::is_synthetic_yahoo_ticker(ticker) {
            return Ok(fallback(asset));
        }
        let key = format!("{ticker}|{}", date.format("%F"));
        if let Some(price) = self.cached_price(&key) {
            return Ok(adjusted_price(price, asset));
        }
        match self.client.fetch_price(ticker, date).await {
            Ok((price, price_at)) => {
                self.cache_price(key, price);
                let price = adjusted_price(price, asset);
                self.update_price_connectivity(asset, ConnectivityStatus::Healthy).await;
                if is_current_price_date(date) && asset.id != 0 {
                    self.write_asset_price(asset.id, price, price_at).await;
                }
                Ok(price)
            }
            Err(error) => {
                if yahoo::is_not_found(&error) {
                    self.update_price_connectivity(asset, ConnectivityStatus::NotFound)
                        .await;
                }
                Ok(fallback(asset))
            }
        }
    }

    pub async fn validate_ticker(&self, ticker: &str) -> Result<()> {
        if yahoo::is_synthetic_yahoo_ticker(ticker) {
            return Ok(());
        }
        if let Err(error) = self.client.fetch_price(ticker, Utc::now()).await
            && yahoo::is_not_found(&error)
        {
            anyhow::bail!("ticker {ticker:?} not found");
        }
        Ok(())
    }

    fn cached_price(&self, key: &str) -> Option<f64> {
        let mut cache = self.cache.lock().expect("Yahoo cache mutex must not be poisoned");
        match cache
            .get(key)
            .filter(|cached| std::time::Instant::now() < cached.expires_at)
        {
            Some(cached) => Some(cached.price),
            None => {
                cache.remove(key);
                None
            }
        }
    }

    fn cache_price(&self, key: String, price: f64) {
        let mut cache = self.cache.lock().expect("Yahoo cache mutex must not be poisoned");
        if !cache.contains_key(&key) && cache.len() == CACHE_MAX_ENTRIES {
            cache.clear();
        }
        cache.insert(
            key,
            CachedPrice {
                price,
                expires_at: std::time::Instant::now() + CACHE_TTL,
            },
        );
    }

    async fn write_asset_price(&self, asset_id: i64, price: f64, price_at: DateTime<Utc>) {
        let _ = tokio::time::timeout(
            Duration::from_secs(5),
            store::update_asset_price(&self.pool, asset_id, price, price_at),
        )
        .await;
    }

    async fn update_price_connectivity(&self, asset: &Asset, status: ConnectivityStatus) {
        if asset.id == 0 || asset.price_connectivity == status {
            return;
        }
        let _ = tokio::time::timeout(
            Duration::from_secs(5),
            store::update_asset_price_connectivity(&self.pool, asset.id, status),
        )
        .await;
    }
}

fn effective_ticker(asset: &Asset) -> &str {
    asset.tracking_ticker.as_deref().unwrap_or(&asset.identifier)
}

fn adjusted_price(price: f64, asset: &Asset) -> f64 {
    price * if asset.tracking_multiplier == 0.0 { 1.0 } else { asset.tracking_multiplier }
}

fn fallback(asset: &Asset) -> f64 {
    asset.current_price.unwrap_or_default()
}

fn is_current_price_date(date: DateTime<Utc>) -> bool {
    date.date_naive() >= Utc::now().date_naive()
}

#[cfg(test)]
mod tests {
    use chrono::{DateTime, Duration, Utc};
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path_regex, query_param},
    };

    use super::YahooPriceProvider;
    use crate::{
        clients::yahoo::Yahoo,
        schema::{AssetClassifier, AssetType, ConnectivityStatus},
        wealth::Asset,
    };

    #[tokio::test]
    async fn prices_usd_and_skips_unpriceable_assets_without_network() {
        let server = MockServer::start().await;
        let provider = YahooPriceProvider::with_client(
            crate::database::dbtest::open().await.unwrap(),
            Yahoo::with_base_url(server.uri()).unwrap(),
        );

        assert_eq!(
            provider
                .price_at(&asset(AssetType::Currency, "USD"), Utc::now())
                .await
                .unwrap(),
            1.0
        );
        assert_eq!(
            provider
                .price_at(
                    &Asset {
                        current_price: Some(42.0),
                        price_connectivity: ConnectivityStatus::Ignore,
                        ..asset(AssetType::Security, "AAPL")
                    },
                    Utc::now(),
                )
                .await
                .unwrap(),
            42.0
        );
        assert_eq!(
            provider
                .price_at(&asset(AssetType::Security, "PLAID:cash"), Utc::now())
                .await
                .unwrap(),
            0.0
        );
    }

    #[tokio::test]
    async fn caches_adjusted_prices_and_uses_the_prior_historical_close() {
        let server = MockServer::start().await;
        let date = Utc::now() - Duration::days(2);
        chart_mock(date).expect(1).mount(&server).await;
        let provider = YahooPriceProvider::with_client(
            crate::database::dbtest::open().await.unwrap(),
            Yahoo::with_base_url(server.uri()).unwrap(),
        );
        let asset = Asset {
            tracking_multiplier: 2.0,
            ..asset(AssetType::Security, "AAPL")
        };

        assert_eq!(provider.price_at(&asset, date).await.unwrap(), 22.0);
        assert_eq!(provider.price_at(&asset, date).await.unwrap(), 22.0);
        server.verify().await;
    }

    #[tokio::test]
    async fn validates_only_definitively_missing_tickers() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        let provider = YahooPriceProvider::with_client(
            crate::database::dbtest::open().await.unwrap(),
            Yahoo::with_base_url(server.uri()).unwrap(),
        );

        assert_eq!(
            provider.validate_ticker("MISSING").await.unwrap_err().to_string(),
            "ticker \"MISSING\" not found"
        );
        assert!(provider.validate_ticker("PLAID:cash").await.is_ok());
    }

    #[tokio::test]
    async fn clones_share_one_price_cache() {
        let server = MockServer::start().await;
        let date = Utc::now() - Duration::days(2);
        chart_mock(date).expect(1).mount(&server).await;
        let provider = YahooPriceProvider::with_client(
            crate::database::dbtest::open().await.unwrap(),
            Yahoo::with_base_url(server.uri()).unwrap(),
        );
        let clone = provider.clone();
        let asset = asset(AssetType::Security, "AAPL");

        assert_eq!(provider.price_at(&asset, date).await.unwrap(), 11.0);
        assert_eq!(clone.price_at(&asset, date).await.unwrap(), 11.0);
        server.verify().await;
    }

    fn chart_mock(date: DateTime<Utc>) -> Mock {
        Mock::given(method("GET"))
            .and(path_regex("/v8/finance/chart/.*"))
            .and(query_param("interval", "1d"))
            .respond_with(ResponseTemplate::new(200).set_body_string(format!(
                r#"{{"chart":{{"result":[{{"indicators":{{"quote":[{{"close":[11.0,12.0]}}]}},"timestamp":[{},{}]}}]}}}}"#,
                (date - Duration::days(1)).timestamp(),
                (date + Duration::days(1)).timestamp(),
            )))
    }

    fn asset(asset_type: AssetType, identifier: &str) -> Asset {
        Asset {
            id: 0,
            asset_type,
            identifier: identifier.to_owned(),
            name: None,
            classifier: AssetClassifier::Public,
            current_price: None,
            forced_usd_price: None,
            tracking_ticker: None,
            tracking_multiplier: 1.0,
            price_connectivity: ConnectivityStatus::Healthy,
            investment_connectivity: ConnectivityStatus::Healthy,
        }
    }
}
