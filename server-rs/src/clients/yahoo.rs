use anyhow::{Context, Result};
use chrono::{DateTime, Duration, TimeZone, Utc};
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use url::Url;

const TIMEOUT_SECONDS: u64 = 10;
const BASE_URL: &str = "https://query1.finance.yahoo.com";

#[derive(Clone)]
pub struct Yahoo {
    http: Client,
    base_url: String,
}

#[derive(Debug)]
pub struct YahooStatusError {
    pub status: StatusCode,
    pub ticker: String,
}

impl std::fmt::Display for YahooStatusError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "yahoo returned {} for {}", self.status.as_u16(), self.ticker)
    }
}

impl std::error::Error for YahooStatusError {}

pub fn is_not_found(error: &anyhow::Error) -> bool {
    error
        .downcast_ref::<YahooStatusError>()
        .is_some_and(|status_error| status_error.status == StatusCode::NOT_FOUND)
}

pub fn is_synthetic_yahoo_ticker(ticker: &str) -> bool {
    let ticker = ticker.trim().to_ascii_uppercase();
    ticker.starts_with("PLAID:") || ticker.starts_with("SIMPLEFIN:")
}

impl Yahoo {
    pub fn new() -> Result<Self> {
        Self::with_base_url(BASE_URL)
    }

    pub fn with_base_url(base_url: impl Into<String>) -> Result<Self> {
        Ok(Self {
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(TIMEOUT_SECONDS))
                .build()
                .context("build Yahoo HTTP client")?,
            base_url: base_url.into(),
        })
    }

    pub async fn fetch_price(&self, ticker: &str, date: DateTime<Utc>) -> Result<(f64, DateTime<Utc>)> {
        let date_day = utc_day(date);
        let current = is_current_price_date(date);
        let endpoint = self.price_url(ticker, date_day, current)?;
        let response = self
            .http
            .get(endpoint)
            .header(reqwest::header::USER_AGENT, "tallyo/1.0")
            .send()
            .await
            .context("http get")?;
        let status = response.status();
        if status != StatusCode::OK {
            return Err(YahooStatusError {
                status,
                ticker: ticker.to_owned(),
            }
            .into());
        }
        let payload = response.json::<ChartResponse>().await.context("decode response")?;
        if let Some(error) = payload.chart.error {
            anyhow::bail!("yahoo error {}: {}", error.code, error.description);
        }
        let result = payload
            .chart
            .result
            .into_iter()
            .next()
            .with_context(|| format!("no chart result for {ticker}"))?;
        if current {
            anyhow::ensure!(
                result.meta.regular_market_price != 0.0,
                "zero regularMarketPrice for {ticker}"
            );
            return Ok((
                result.meta.regular_market_price,
                timestamp(result.meta.regular_market_time).unwrap_or(date_day),
            ));
        }

        historical_close(result, date_day, ticker)
    }

    fn price_url(&self, ticker: &str, date_day: DateTime<Utc>, current: bool) -> Result<Url> {
        let mut endpoint = Url::parse(&self.base_url).context("build request")?;
        endpoint
            .path_segments_mut()
            .map_err(|_| anyhow::anyhow!("build request: base URL cannot hold path segments"))?
            .extend(["v8", "finance", "chart", ticker]);
        let mut query = endpoint.query_pairs_mut();
        query.append_pair("interval", "1d");
        if current {
            query.append_pair("range", "1d");
        } else {
            query.append_pair("period1", &(date_day - Duration::days(7)).timestamp().to_string());
            query.append_pair("period2", &(date_day + Duration::days(1)).timestamp().to_string());
        }
        drop(query);
        Ok(endpoint)
    }
}

fn utc_day(date: DateTime<Utc>) -> DateTime<Utc> {
    Utc.from_utc_datetime(&date.date_naive().and_hms_opt(0, 0, 0).expect("midnight is valid"))
}

fn is_current_price_date(date: DateTime<Utc>) -> bool {
    utc_day(date) >= utc_day(Utc::now())
}

fn historical_close(result: ChartResult, date_day: DateTime<Utc>, ticker: &str) -> Result<(f64, DateTime<Utc>)> {
    let closes = result
        .indicators
        .quote
        .first()
        .map(|quote| &quote.close)
        .filter(|closes| !closes.is_empty())
        .with_context(|| {
            format!(
                "no historical quote data for {ticker} on {}",
                date_day.format("%Y-%m-%d")
            )
        })?;
    let day_end = date_day + Duration::days(1);
    for index in (0..closes.len()).rev() {
        let Some(price) = closes[index] else {
            continue;
        };
        let price_at = result
            .timestamps
            .get(index)
            .and_then(|value| timestamp(*value))
            .unwrap_or(date_day);
        if price_at < day_end {
            return Ok((price, price_at));
        }
    }
    anyhow::bail!(
        "no historical close for {ticker} on or before {}",
        date_day.format("%Y-%m-%d")
    )
}

fn timestamp(timestamp: i64) -> Option<DateTime<Utc>> {
    DateTime::<Utc>::from_timestamp(timestamp, 0)
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct ChartResponse {
    chart: Chart,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct Chart {
    result: Vec<ChartResult>,
    error: Option<ChartError>,
}

#[derive(Deserialize)]
struct ChartError {
    code: String,
    description: String,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct ChartResult {
    meta: ChartMeta,
    indicators: Indicators,
    #[serde(rename = "timestamp")]
    timestamps: Vec<i64>,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct ChartMeta {
    #[serde(rename = "regularMarketPrice")]
    regular_market_price: f64,
    #[serde(rename = "regularMarketTime")]
    regular_market_time: i64,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct Indicators {
    quote: Vec<Quote>,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct Quote {
    close: Vec<Option<f64>>,
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{header, method, path_regex, query_param},
    };

    use super::{Yahoo, is_not_found, is_synthetic_yahoo_ticker};

    #[tokio::test]
    async fn fetches_current_and_historical_prices() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path_regex("/v8/finance/chart/.*"))
            .and(header("user-agent", "tallyo/1.0"))
            .and(query_param("interval", "1d"))
            .and(query_param("range", "1d"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                r#"{"chart":{"result":[{"meta":{"regularMarketPrice":123.45,"regularMarketTime":1770000000}}]}}"#,
            ))
            .mount(&server)
            .await;

        let client = Yahoo::with_base_url(server.uri()).unwrap();
        let (price, _) = client.fetch_price("AAPL?not-query", Utc::now()).await.unwrap();
        assert_eq!(price, 123.45);

        let price_at = Utc::now() - Duration::days(2);
        Mock::given(method("GET"))
            .and(query_param(
                "period1",
                (price_at - Duration::days(7))
                    .date_naive()
                    .and_hms_opt(0, 0, 0)
                    .unwrap()
                    .and_utc()
                    .timestamp()
                    .to_string(),
            ))
            .respond_with(ResponseTemplate::new(200).set_body_string(format!(
                r#"{{"chart":{{"result":[{{"indicators":{{"quote":[{{"close":[99.0]}}]}},"timestamp":[{}]}}]}}}}"#,
                price_at.timestamp()
            )))
            .mount(&server)
            .await;
        let (price, _) = client.fetch_price("MSFT", price_at).await.unwrap();
        assert_eq!(price, 99.0);
    }

    #[tokio::test]
    async fn exposes_not_found_and_synthetic_ticker_helpers() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        let error = Yahoo::with_base_url(server.uri())
            .unwrap()
            .fetch_price("MISSING", Utc::now())
            .await
            .unwrap_err();
        assert!(is_not_found(&error));
        assert!(is_synthetic_yahoo_ticker(" plaid:account "));
        assert!(is_synthetic_yahoo_ticker("simplefin:account"));
        assert!(!is_synthetic_yahoo_ticker("AAPL"));
    }
}
