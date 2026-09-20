use std::time::Duration;

use anyhow::Result;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use sqlx::SqlitePool;

use crate::{
    clients::{
        yahoo::is_synthetic_yahoo_ticker,
        yfinance::{self, YFinance},
    },
    portfolio::{
        store::{assets, reports},
        types::{AssetReport, AssetStub},
    },
    schema::ConnectivityStatus,
    utils::future::BoxFuture,
    wealth::store::update_asset_investment_connectivity,
};

const REPORT_REFRESH_INTERVAL: ChronoDuration = ChronoDuration::days(14);
const DEFAULT_PAUSE_BETWEEN_ASSETS: Duration = Duration::from_millis(250);

pub struct ReportSyncer {
    yahoo: YFinance,
    pool: SqlitePool,
    pause_between_assets: Duration,
}

impl ReportSyncer {
    pub fn new(pool: SqlitePool, yahoo: YFinance) -> Self {
        Self {
            yahoo,
            pool,
            pause_between_assets: DEFAULT_PAUSE_BETWEEN_ASSETS,
        }
    }

    pub fn with_pause(mut self, pause_between_assets: Duration) -> Self {
        self.pause_between_assets = pause_between_assets;
        self
    }

    pub async fn sync_all(&self, now: DateTime<Utc>) -> Result<()> {
        let assets = assets::public_assets_needing_report(&self.pool, now - REPORT_REFRESH_INTERVAL).await?;
        for (index, asset) in assets.iter().enumerate() {
            if index > 0 {
                tokio::time::sleep(self.pause_between_assets).await;
            }
            if let Err(error) = self.sync_asset(asset, now).await {
                tracing::warn!(asset_id = asset.id, ticker = asset.identifier, %error, "portfolio analysis report sync failed");
            }
        }
        Ok(())
    }

    async fn sync_asset(&self, asset: &AssetStub, now: DateTime<Utc>) -> Result<()> {
        if asset.investment_connectivity == ConnectivityStatus::Ignore {
            return Ok(());
        }
        let Some(ticker) = ticker(asset) else {
            return Ok(());
        };
        if is_synthetic_yahoo_ticker(&ticker) {
            return Ok(());
        }

        match self.yahoo.fetch_fund(&ticker).await {
            Ok(Some(fund)) if fund.is_valid() => {
                reports::upsert_report(&self.pool, &AssetReport::from((asset.id, now, fund))).await?;
                self.update_connectivity(asset.id, ConnectivityStatus::Healthy).await;
                return Ok(());
            }
            Ok(_) => {}
            Err(error) => {
                if yfinance::is_not_found(&error) {
                    self.update_connectivity(asset.id, ConnectivityStatus::NotFound).await;
                }
                return Err(error);
            }
        }

        match self.yahoo.fetch_equity(&ticker).await {
            Ok(Some(equity)) if equity.is_valid() => {
                reports::upsert_report(&self.pool, &AssetReport::from((asset.id, now, equity))).await?;
                self.update_connectivity(asset.id, ConnectivityStatus::Healthy).await;
            }
            Ok(_) => {
                tracing::warn!(asset_id = asset.id, %ticker, "portfolio analysis data unavailable");
                self.update_connectivity(asset.id, ConnectivityStatus::NotFound).await;
            }
            Err(error) => {
                if yfinance::is_not_found(&error) {
                    self.update_connectivity(asset.id, ConnectivityStatus::NotFound).await;
                }
                return Err(error);
            }
        }
        Ok(())
    }

    async fn update_connectivity(&self, asset_id: i64, status: ConnectivityStatus) {
        if let Err(error) = update_asset_investment_connectivity(&self.pool, asset_id, status).await {
            tracing::warn!(asset_id, ?status, %error, "portfolio analysis connectivity update failed");
        }
    }
}

impl crate::wealth::balancesync::PortfolioSyncer for ReportSyncer {
    fn sync<'a>(&'a self) -> BoxFuture<'a, Result<()>> {
        Box::pin(self.sync_all(Utc::now()))
    }
}

fn ticker(asset: &AssetStub) -> Option<String> {
    let ticker = asset
        .tracking_ticker
        .as_deref()
        .filter(|ticker| !ticker.trim().is_empty())
        .unwrap_or(&asset.identifier)
        .trim()
        .to_ascii_uppercase();
    (!ticker.is_empty()).then_some(ticker)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use anyhow::Result;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };

    use super::{AssetStub, ConnectivityStatus, ReportSyncer, ticker};
    use crate::{
        clients::yfinance::YFinance, database::dbtest, portfolio::store::reports, wealth::balancesync::PortfolioSyncer,
    };

    #[tokio::test]
    async fn skips_synthetic_assets_and_continues_after_errors() -> Result<()> {
        let server = MockServer::start().await;
        mount_auth(&server).await;
        mount_summary(&server, "VTI", 200, fund_summary()).await;
        mount_summary(&server, "AAPL", 200, equity_summary()).await;
        mount_summary(&server, "BAD", 500, String::new()).await;
        let pool = dbtest::open().await?;
        let synthetic = asset(&pool, "plaid:sec", None, ConnectivityStatus::Healthy).await?;
        let vti = asset(&pool, "VTI", None, ConnectivityStatus::Healthy).await?;
        let aapl = asset(&pool, "AAPL", None, ConnectivityStatus::Healthy).await?;
        let bad = asset(&pool, "BAD", None, ConnectivityStatus::Healthy).await?;
        let simplefin = asset(&pool, "ignored", Some("simplefin:sec"), ConnectivityStatus::Healthy).await?;
        let tracked = asset(&pool, "PLAID:synthetic", Some("VTI"), ConnectivityStatus::Healthy).await?;

        syncer(pool.clone(), &server)
            .sync_all("2026-06-01T12:00:00Z".parse()?)
            .await?;

        let reports = reports::reports_by_asset_ids(&pool, &[vti, aapl, tracked]).await?;
        assert_eq!(reports.len(), 3);
        assert_eq!(reports[&vti].group_name, "US Equity");
        assert_eq!(reports[&aapl].equity_sector.as_deref(), Some("Technology"));
        assert_eq!(reports[&tracked].group_name, "US Equity");
        assert!(
            reports::reports_by_asset_ids(&pool, &[synthetic, simplefin, bad])
                .await?
                .is_empty()
        );
        Ok(())
    }

    #[tokio::test]
    async fn updates_connectivity_for_not_found_healthy_and_missing_data() -> Result<()> {
        let server = MockServer::start().await;
        mount_auth(&server).await;
        mount_summary(&server, "BAD", 404, String::new()).await;
        mount_summary(&server, "VTI", 200, fund_summary()).await;
        mount_summary(
            &server,
            "EMPTY",
            200,
            r#"{"quoteSummary":{"result":[{}],"error":null}}"#.to_owned(),
        )
        .await;
        let pool = dbtest::open().await?;
        let ignored = asset(&pool, "IGN", None, ConnectivityStatus::Ignore).await?;
        let bad = asset(&pool, "BAD", None, ConnectivityStatus::Healthy).await?;
        let vti = asset(&pool, "VTI", None, ConnectivityStatus::Healthy).await?;
        let empty = asset(&pool, "EMPTY", None, ConnectivityStatus::Healthy).await?;
        let syncer = syncer(pool.clone(), &server);

        syncer
            .sync_asset(&stub(ignored, "IGN", ConnectivityStatus::Ignore), fixed_now())
            .await?;
        assert!(
            syncer
                .sync_asset(&stub(bad, "BAD", ConnectivityStatus::Healthy), fixed_now())
                .await
                .is_err()
        );
        syncer
            .sync_asset(&stub(vti, "VTI", ConnectivityStatus::Healthy), fixed_now())
            .await?;
        syncer
            .sync_asset(&stub(empty, "EMPTY", ConnectivityStatus::Healthy), fixed_now())
            .await?;

        assert_eq!(connectivity(&pool, bad).await?, "NOT_FOUND");
        assert_eq!(connectivity(&pool, vti).await?, "HEALTHY");
        assert_eq!(connectivity(&pool, empty).await?, "NOT_FOUND");
        assert!(reports::reports_by_asset_ids(&pool, &[empty]).await?.is_empty());
        Ok(())
    }

    #[tokio::test]
    async fn portfolio_syncer_handles_empty_database() -> Result<()> {
        let server = MockServer::start().await;
        let pool = dbtest::open().await?;

        syncer(pool, &server).sync().await?;

        Ok(())
    }

    #[test]
    fn prefers_non_empty_tracking_tickers() {
        assert_eq!(
            ticker(&stub(1, " plaid:asset ", ConnectivityStatus::Healthy)),
            Some("PLAID:ASSET".to_owned())
        );
        assert_eq!(
            ticker(&AssetStub {
                tracking_ticker: Some(" vti ".to_owned()),
                ..stub(1, "PLAID:asset", ConnectivityStatus::Healthy)
            }),
            Some("VTI".to_owned())
        );
    }

    fn syncer(pool: sqlx::SqlitePool, server: &MockServer) -> ReportSyncer {
        ReportSyncer::new(
            pool,
            YFinance::with_urls(
                format!("{}/cookie", server.uri()),
                format!("{}/crumb", server.uri()),
                format!("{}/quoteSummary", server.uri()),
            )
            .unwrap(),
        )
        .with_pause(Duration::ZERO)
    }

    fn stub(id: i64, identifier: &str, investment_connectivity: ConnectivityStatus) -> AssetStub {
        AssetStub {
            id,
            identifier: identifier.to_owned(),
            tracking_ticker: None,
            investment_connectivity,
        }
    }

    async fn asset(
        pool: &sqlx::SqlitePool,
        identifier: &str,
        tracking_ticker: Option<&str>,
        investment_connectivity: ConnectivityStatus,
    ) -> Result<i64> {
        sqlx::query_scalar(
            "INSERT INTO assets (asset_type, identifier, classifier, tracking_ticker, investment_connectivity) VALUES ('SECURITY', ?, 'PUBLIC', ?, ?) RETURNING id",
        )
        .bind(identifier)
        .bind(tracking_ticker)
        .bind(investment_connectivity.to_string())
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    async fn connectivity(pool: &sqlx::SqlitePool, asset_id: i64) -> Result<String> {
        sqlx::query_scalar("SELECT investment_connectivity FROM assets WHERE id = ?")
            .bind(asset_id)
            .fetch_one(pool)
            .await
            .map_err(Into::into)
    }

    async fn mount_auth(server: &MockServer) {
        Mock::given(method("GET"))
            .and(path("/cookie"))
            .respond_with(ResponseTemplate::new(200).insert_header("set-cookie", "A3=session; Max-Age=3600"))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path("/crumb"))
            .respond_with(ResponseTemplate::new(200).set_body_string("crumb"))
            .mount(server)
            .await;
    }

    async fn mount_summary(server: &MockServer, ticker: &str, status: u16, body: String) {
        Mock::given(method("GET"))
            .and(path(format!("/quoteSummary/{ticker}")))
            .respond_with(ResponseTemplate::new(status).set_body_string(body))
            .mount(server)
            .await;
    }

    fn fund_summary() -> String {
        r#"{"quoteSummary":{"result":[{"fundProfile":{"categoryName":"Large Blend"},"topHoldings":{"stockPosition":1}}],"error":null}}"#.to_owned()
    }

    fn equity_summary() -> String {
        r#"{"quoteSummary":{"result":[{"summaryProfile":{"sector":"Technology"}}],"error":null}}"#.to_owned()
    }

    fn fixed_now() -> chrono::DateTime<chrono::Utc> {
        "2026-06-01T12:00:00Z".parse().unwrap()
    }
}
