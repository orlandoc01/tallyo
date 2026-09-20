use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex, MutexGuard},
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use reqwest::{Client, RequestBuilder, StatusCode, header::SET_COOKIE};
use serde_json::{Map, Value};
use url::Url;

const TIMEOUT_SECONDS: u64 = 30;
const SUMMARY_CACHE_MAX_ENTRIES: usize = 256;
const SUMMARY_CACHE_TTL: Duration = Duration::from_secs(30);
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/113.0";

#[derive(Clone, Debug, Default, PartialEq)]
pub struct FundReport {
    pub category: String,
    pub group: String,
    pub cash_position: f64,
    pub stock_position: f64,
    pub bond_position: f64,
    pub preferred_position: f64,
    pub convertible_position: f64,
    pub other_position: f64,
    pub sector_real_estate: f64,
    pub sector_consumer_cyclical: f64,
    pub sector_basic_materials: f64,
    pub sector_consumer_defensive: f64,
    pub sector_technology: f64,
    pub sector_communication_services: f64,
    pub sector_financial_services: f64,
    pub sector_utilities: f64,
    pub sector_industrials: f64,
    pub sector_energy: f64,
    pub sector_healthcare: f64,
}

impl FundReport {
    pub fn is_valid(&self) -> bool {
        !self.category.trim().is_empty()
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct EquityReport {
    pub sector: String,
}

impl EquityReport {
    pub fn is_valid(&self) -> bool {
        !self.sector.trim().is_empty()
    }
}

#[derive(Debug)]
pub struct YahooStatusError {
    pub status: StatusCode,
    pub ticker: String,
}

impl std::fmt::Display for YahooStatusError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "yahoo quoteSummary status {} for {}",
            self.status.as_u16(),
            self.ticker
        )
    }
}

impl std::error::Error for YahooStatusError {}

pub fn is_not_found(error: &anyhow::Error) -> bool {
    error
        .downcast_ref::<YahooStatusError>()
        .is_some_and(|status_error| status_error.status == StatusCode::NOT_FOUND)
}

pub struct YFinance {
    http: Client,
    cookie_url: String,
    crumb_url: String,
    quote_summary_base: String,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    crumb: Option<CrumbState>,
    summary_cache: HashMap<String, CachedSummary>,
}

#[derive(Clone)]
struct CrumbState {
    value: String,
    cookie_header: String,
    expiry: Instant,
}

#[derive(Clone)]
struct CachedSummary {
    summary: Option<QuoteSummary>,
    expires: Instant,
}

#[derive(Clone)]
struct QuoteSummary {
    result: Map<String, Value>,
}

impl YFinance {
    pub fn new() -> Result<Self> {
        Self::with_urls(
            "https://fc.yahoo.com",
            "https://query1.finance.yahoo.com/v1/test/getcrumb",
            "https://query1.finance.yahoo.com/v10/finance/quoteSummary",
        )
    }

    pub fn with_urls(
        cookie_url: impl Into<String>,
        crumb_url: impl Into<String>,
        quote_summary_base: impl Into<String>,
    ) -> Result<Self> {
        Ok(Self {
            http: Client::builder()
                .timeout(Duration::from_secs(TIMEOUT_SECONDS))
                .build()
                .context("build Yahoo Finance HTTP client")?,
            cookie_url: cookie_url.into(),
            crumb_url: crumb_url.into(),
            quote_summary_base: quote_summary_base.into().trim_end_matches('/').to_owned(),
            state: Mutex::new(State::default()),
        })
    }

    pub async fn fetch_fund(&self, ticker: &str) -> Result<Option<FundReport>> {
        let Some(summary) = self.quote_summary(ticker).await? else {
            return Ok(None);
        };
        let category = summary
            .result
            .get("fundProfile")
            .and_then(Value::as_object)
            .and_then(|profile| profile.get("categoryName"))
            .map(string_value)
            .unwrap_or_default();
        if category.trim().is_empty() {
            return Ok(None);
        }
        let holdings = summary.result.get("topHoldings");
        Ok(Some(FundReport {
            group: morningstar_group(&category).to_owned(),
            category,
            cash_position: find_float(holdings, "cashPosition"),
            stock_position: find_float(holdings, "stockPosition"),
            bond_position: find_float(holdings, "bondPosition"),
            preferred_position: find_float(holdings, "preferredPosition"),
            convertible_position: find_float(holdings, "convertiblePosition"),
            other_position: find_float(holdings, "otherPosition"),
            sector_real_estate: find_float(holdings, "realestate"),
            sector_consumer_cyclical: find_float(holdings, "consumer_cyclical"),
            sector_basic_materials: find_float(holdings, "basic_materials"),
            sector_consumer_defensive: find_float(holdings, "consumer_defensive"),
            sector_technology: find_float(holdings, "technology"),
            sector_communication_services: find_float(holdings, "communication_services"),
            sector_financial_services: find_float(holdings, "financial_services"),
            sector_utilities: find_float(holdings, "utilities"),
            sector_industrials: find_float(holdings, "industrials"),
            sector_energy: find_float(holdings, "energy"),
            sector_healthcare: find_float(holdings, "healthcare"),
        }))
    }

    pub async fn fetch_equity(&self, ticker: &str) -> Result<Option<EquityReport>> {
        let Some(summary) = self.quote_summary(ticker).await? else {
            return Ok(None);
        };
        let sector = summary
            .result
            .get("summaryProfile")
            .and_then(Value::as_object)
            .and_then(|profile| profile.get("sector"))
            .map(string_value)
            .unwrap_or_default()
            .trim()
            .to_owned();
        if sector.trim().is_empty() {
            return Ok(None);
        }
        Ok(Some(EquityReport { sector }))
    }

    async fn quote_summary(&self, ticker: &str) -> Result<Option<QuoteSummary>> {
        let ticker = ticker.trim().to_ascii_uppercase();
        if ticker.is_empty() {
            return Ok(None);
        }
        if let Some(summary) = self.cached_summary(&ticker)? {
            return Ok(Some(summary));
        }
        let (mut summary, mut status) = self.fetch_quote_summary(&ticker, false).await?;
        if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
            self.invalidate_crumb()?;
            (summary, status) = self.fetch_quote_summary(&ticker, true).await?;
        }
        if !status.is_success() {
            return Err(YahooStatusError { status, ticker }.into());
        }
        self.cache_summary(&ticker, summary.clone())?;
        Ok(summary)
    }

    async fn fetch_quote_summary(&self, ticker: &str, force_crumb: bool) -> Result<(Option<QuoteSummary>, StatusCode)> {
        let crumb = self.get_crumb(force_crumb).await?;
        let mut endpoint = Url::parse(&self.quote_summary_base).context("build Yahoo quoteSummary URL")?;
        endpoint
            .path_segments_mut()
            .map_err(|_| anyhow::anyhow!("build Yahoo quoteSummary URL"))?
            .push(ticker);
        endpoint
            .query_pairs_mut()
            .append_pair("modules", "quoteType,summaryProfile,fundProfile,topHoldings")
            .append_pair("formatted", "false")
            .append_pair("crumb", &crumb.value);
        let response = quote_headers(self.http.get(endpoint))
            .header("Origin", "https://finance.yahoo.com")
            .header("Referer", "https://finance.yahoo.com")
            .header("Sec-Fetch-Dest", "empty")
            .header("Sec-Fetch-Mode", "cors")
            .header("Sec-Fetch-Site", "same-site")
            .header("Cookie", crumb.cookie_header)
            .send()
            .await
            .context("fetch Yahoo quoteSummary")?;
        let status = response.status();
        if !status.is_success() {
            return Ok((None, status));
        }
        let body = response.text().await.context("read Yahoo quoteSummary")?;
        Ok((decode_quote_summary(&body)?, status))
    }

    async fn get_crumb(&self, force: bool) -> Result<CrumbState> {
        if !force
            && let Some(crumb) = self
                .state()?
                .crumb
                .as_ref()
                .filter(|crumb| Instant::now() < crumb.expiry)
                .cloned()
        {
            return Ok(crumb);
        }
        let (cookies, expiry) = self.fetch_cookies().await?;
        let value = self.fetch_crumb(&cookies).await?;
        let crumb = CrumbState {
            value,
            cookie_header: cookies,
            expiry,
        };
        self.state()?.crumb = Some(crumb.clone());
        Ok(crumb)
    }

    async fn fetch_cookies(&self) -> Result<(String, Instant)> {
        let response = quote_headers(self.http.get(&self.cookie_url))
            .send()
            .await
            .context("fetch Yahoo cookies")?;
        let now = Instant::now();
        let mut expiry = now + Duration::from_secs(365 * 24 * 60 * 60);
        let cookies = response
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|header| header.to_str().ok())
            .filter_map(|header| parse_cookie(header, now))
            .inspect(|(_, cookie_expiry)| {
                if let Some(cookie_expiry) = cookie_expiry.filter(|candidate| *candidate < expiry) {
                    expiry = cookie_expiry;
                }
            })
            .map(|(cookie, _)| cookie)
            .collect::<Vec<_>>();
        anyhow::ensure!(
            !cookies.is_empty(),
            "no cookies from yahoo ({} status {})",
            self.cookie_url,
            response.status().as_u16()
        );
        Ok((cookies.join("; "), expiry))
    }

    async fn fetch_crumb(&self, cookies: &str) -> Result<String> {
        let response = quote_headers(self.http.get(&self.crumb_url))
            .header("Cookie", cookies)
            .header("Sec-Fetch-Dest", "empty")
            .header("Sec-Fetch-Mode", "cors")
            .header("Sec-Fetch-Site", "same-site")
            .send()
            .await
            .context("fetch Yahoo crumb")?;
        let status = response.status();
        anyhow::ensure!(status.is_success(), "yahoo crumb status {}", status.as_u16());
        let crumb = response.text().await.context("read Yahoo crumb")?.trim().to_owned();
        anyhow::ensure!(!crumb.is_empty(), "empty yahoo crumb");
        Ok(crumb)
    }

    fn cached_summary(&self, ticker: &str) -> Result<Option<QuoteSummary>> {
        let mut state = self.state()?;
        let Some(cached) = state.summary_cache.get(ticker) else {
            return Ok(None);
        };
        if Instant::now() > cached.expires {
            state.summary_cache.remove(ticker);
            return Ok(None);
        }
        Ok(cached.summary.clone())
    }

    fn cache_summary(&self, ticker: &str, summary: Option<QuoteSummary>) -> Result<()> {
        let mut state = self.state()?;
        if !state.summary_cache.contains_key(ticker) && state.summary_cache.len() == SUMMARY_CACHE_MAX_ENTRIES {
            state.summary_cache.clear();
        }
        state.summary_cache.insert(
            ticker.to_owned(),
            CachedSummary {
                summary,
                expires: Instant::now() + SUMMARY_CACHE_TTL,
            },
        );
        Ok(())
    }

    fn invalidate_crumb(&self) -> Result<()> {
        self.state()?.crumb = None;
        Ok(())
    }

    fn state(&self) -> Result<MutexGuard<'_, State>> {
        self.state
            .lock()
            .map_err(|_| anyhow::anyhow!("Yahoo Finance client state mutex poisoned"))
    }
}

fn quote_headers(request: RequestBuilder) -> RequestBuilder {
    request
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header(reqwest::header::ACCEPT, "*/*")
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.5")
}

fn parse_cookie(header: &str, now: Instant) -> Option<(String, Option<Instant>)> {
    let mut attributes = header.split(';');
    let (name, value) = attributes.next()?.trim().split_once('=')?;
    if name.is_empty() {
        return None;
    }
    let expiry = attributes
        .filter_map(|attribute| attribute.trim().split_once('='))
        .find_map(|(name, value)| {
            name.eq_ignore_ascii_case("Max-Age")
                .then(|| value.parse::<u64>().ok())
                .flatten()
        })
        .filter(|max_age| *max_age > 0)
        .and_then(|max_age| now.checked_add(Duration::from_secs(max_age)));
    Some((format!("{name}={value}"), expiry))
}

fn decode_quote_summary(body: &str) -> Result<Option<QuoteSummary>> {
    let payload = serde_json::from_str::<Value>(body).context("decode Yahoo quoteSummary")?;
    let root = payload
        .get("quoteSummary")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    if let Some(error) = root.get("error").filter(|error| !error.is_null()) {
        anyhow::bail!("yahoo quoteSummary error: {error}");
    }
    let result = root
        .get("result")
        .and_then(Value::as_array)
        .and_then(|results| results.first())
        .and_then(Value::as_object)
        .filter(|result| !result.is_empty())
        .cloned();
    Ok(result.map(|result| QuoteSummary { result }))
}

fn string_value(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Object(value) => value
            .get("raw")
            .or_else(|| value.get("fmt"))
            .map(string_value)
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn find_float(value: Option<&Value>, key: &str) -> f64 {
    value.and_then(|value| find_float_value(value, key)).unwrap_or_default()
}

fn find_float_value(value: &Value, key: &str) -> Option<f64> {
    match value {
        Value::Object(values) => values
            .get(key)
            .and_then(float_value)
            .or_else(|| values.values().find_map(|value| find_float_value(value, key))),
        Value::Array(values) => values.iter().find_map(|value| find_float_value(value, key)),
        _ => None,
    }
}

fn float_value(value: &Value) -> Option<f64> {
    match value {
        Value::Number(value) => value.as_f64(),
        Value::String(value) => value.parse().ok(),
        Value::Object(value) => value.get("raw").and_then(float_value),
        _ => None,
    }
}

fn morningstar_group(category: &str) -> &'static str {
    let normalized = category.trim().to_ascii_lowercase();
    if let Some(group) = MORNINGSTAR_GROUPS.get(&normalized) {
        return group;
    }
    tracing::warn!(category, "unknown Morningstar category");
    "Uncategorized"
}

static MORNINGSTAR_GROUPS: LazyLock<HashMap<String, &'static str>> = LazyLock::new(|| {
    include_str!("category_map.csv")
        .lines()
        .skip(1)
        .filter_map(|row| {
            let mut cells = row.splitn(3, ',');
            let (Some(category), Some(group)) = (cells.next(), cells.next()) else {
                return None;
            };
            let category = category.trim();
            let group = group.trim();
            (!category.is_empty() && !group.is_empty()).then(|| (category.to_ascii_lowercase(), group))
        })
        .collect()
});

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{header, method, path, query_param},
    };

    use super::{FundReport, QuoteSummary, SUMMARY_CACHE_MAX_ENTRIES, YFinance, morningstar_group};

    #[tokio::test]
    async fn fetches_funds_and_equities_from_a_cached_summary() {
        let server = MockServer::start().await;
        mount_auth(&server).await;
        let calls = Arc::new(AtomicUsize::new(0));
        let quote_calls = Arc::clone(&calls);
        Mock::given(method("GET"))
            .and(path("/quoteSummary/VTI"))
            .and(query_param("crumb", "crumb"))
            .and(header("cookie", "A3=session"))
            .respond_with(move |_: &wiremock::Request| {
                quote_calls.fetch_add(1, Ordering::Relaxed);
                ResponseTemplate::new(200).set_body_string(r#"{"quoteSummary":{"result":[{"fundProfile":{"categoryName":"Large Blend"},"summaryProfile":{"sector":"Technology"},"topHoldings":{"equityHoldings":{"cashPosition":0.02,"stockPosition":0.9,"bondPosition":0.08},"sectorWeightings":[{"technology":0.4},{"healthcare":{"raw":0.2}}]}}],"error":null}}"#)
            })
            .mount(&server)
            .await;
        let client = client(&server);

        let fund = client.fetch_fund("vti").await.unwrap().unwrap();
        assert_eq!(fund.group, "US Equity");
        assert_eq!(fund.stock_position, 0.9);
        assert_eq!(fund.sector_healthcare, 0.2);
        assert_eq!(client.fetch_equity("VTI").await.unwrap().unwrap().sector, "Technology");
        assert_eq!(calls.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn retries_after_unauthorized_and_returns_none_for_missing_profiles() {
        let server = MockServer::start().await;
        mount_auth(&server).await;
        let calls = Arc::new(AtomicUsize::new(0));
        let quote_calls = Arc::clone(&calls);
        Mock::given(method("GET"))
            .and(path("/quoteSummary/VTI"))
            .respond_with(move |_: &wiremock::Request| {
                if quote_calls.fetch_add(1, Ordering::Relaxed) == 0 {
                    ResponseTemplate::new(401)
                } else {
                    ResponseTemplate::new(200).set_body_string(r#"{"quoteSummary":{"result":[{"fundProfile":{"categoryName":"Unknown Category"},"topHoldings":{"stockPosition":1}}],"error":null}}"#)
                }
            })
            .mount(&server)
            .await;
        let client = client(&server);
        assert_eq!(client.fetch_fund("VTI").await.unwrap().unwrap().group, "Uncategorized");
        assert_eq!(calls.load(Ordering::Relaxed), 2);
    }

    #[tokio::test]
    async fn refetches_missing_fund_and_equity_profiles() {
        let server = MockServer::start().await;
        mount_auth(&server).await;
        let calls = Arc::new(AtomicUsize::new(0));
        let quote_calls = Arc::clone(&calls);
        Mock::given(method("GET"))
            .and(path("/quoteSummary/EMPTY"))
            .respond_with(move |_: &wiremock::Request| {
                quote_calls.fetch_add(1, Ordering::Relaxed);
                ResponseTemplate::new(200).set_body_string(r#"{"quoteSummary":{"result":[{}],"error":null}}"#)
            })
            .mount(&server)
            .await;
        let client = client(&server);
        assert!(client.fetch_fund("EMPTY").await.unwrap().is_none());
        assert!(client.fetch_equity("EMPTY").await.unwrap().is_none());
        assert_eq!(calls.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn maps_categories_and_bounds_the_summary_cache() {
        assert_eq!(morningstar_group(" MUNI CALIFORNIA INTERMEDIATE "), "Municipal Bond");
        assert_eq!(morningstar_group("unknown"), "Uncategorized");
        let client = YFinance::new().unwrap();
        for index in 0..=SUMMARY_CACHE_MAX_ENTRIES {
            client
                .cache_summary(
                    &format!("TICKER-{index}"),
                    Some(QuoteSummary {
                        result: serde_json::Map::new(),
                    }),
                )
                .unwrap();
        }
        assert_eq!(client.state().unwrap().summary_cache.len(), 1);
        assert!(!FundReport::default().is_valid());
        assert!(!super::EquityReport::default().is_valid());
    }

    #[tokio::test]
    #[ignore]
    async fn smoke_yahoo_vffvx() {
        if std::env::var("RUN_SMOKE_TESTS").as_deref() != Ok("1") {
            eprintln!("set RUN_SMOKE_TESTS=1 to run Yahoo Finance smoke test");
            return;
        }
        let client = YFinance::new().unwrap();
        let fund = client.fetch_fund("VFFVX").await.unwrap().unwrap();
        assert!(!fund.category.is_empty());
        assert!(!fund.group.is_empty());
        assert!(fund.stock_position > 0.0);
        assert!(!client.fetch_equity("AAPL").await.unwrap().unwrap().sector.is_empty());
    }

    fn client(server: &MockServer) -> YFinance {
        YFinance::with_urls(
            format!("{}/cookie", server.uri()),
            format!("{}/crumb", server.uri()),
            format!("{}/quoteSummary", server.uri()),
        )
        .unwrap()
    }

    async fn mount_auth(server: &MockServer) {
        Mock::given(method("GET"))
            .and(path("/cookie"))
            .respond_with(ResponseTemplate::new(200).insert_header("set-cookie", "A3=session; Max-Age=3600"))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path("/crumb"))
            .and(header("cookie", "A3=session"))
            .respond_with(ResponseTemplate::new(200).set_body_string("crumb"))
            .mount(server)
            .await;
    }
}
