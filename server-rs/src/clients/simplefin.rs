use anyhow::{Context, Result};
use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

const TIMEOUT_SECONDS: u64 = 30;
const ALLOWED_HOSTS: &[&str] = &["bridge.simplefin.org", "beta-bridge.simplefin.org"];
const MAX_ERROR_BODY_BYTES: usize = 256;
const SIMPLEFIN_URL_NOT_HTTPS: &str = "simplefin url must use https";
const SIMPLEFIN_HOST_NOT_ALLOWED: &str = "simplefin url host is not allowed";

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct SimpleFinConnection {
    pub conn_id: String,
    pub name: String,
    pub org_id: String,
    pub org_name: String,
    pub org_url: String,
    pub sfin_url: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct SimpleFinAccount {
    pub id: String,
    pub conn_id: String,
    pub name: String,
    pub currency: String,
    pub balance: String,
    #[serde(rename = "available-balance")]
    pub available_balance: String,
    #[serde(rename = "balance-date")]
    pub balance_date: i64,
    pub transactions: Vec<SimpleFinTransaction>,
    pub holdings: Vec<SimpleFinHolding>,
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct SimpleFinTransaction {
    pub id: String,
    pub posted: i64,
    pub transacted_at: i64,
    pub amount: String,
    pub description: String,
    pub payee: String,
    pub memo: String,
    pub pending: bool,
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct SimpleFinHolding {
    pub id: String,
    pub symbol: String,
    pub description: String,
    pub shares: String,
    pub market_value: String,
    pub cost_basis: String,
    pub purchase_price: String,
    pub currency: String,
    pub created: i64,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct SimpleFinAccountSet {
    pub connections: Vec<SimpleFinConnection>,
    pub accounts: Vec<SimpleFinAccount>,
    #[serde(rename = "errlist")]
    pub errors: Vec<SimpleFinError>,
    #[serde(skip)]
    pub skipped_non_usd: Vec<SimpleFinAccount>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct SimpleFinError {
    pub conn_id: String,
    pub message: String,
}

#[derive(Clone, Debug, Default)]
pub struct GetAccountsOpts {
    pub start_date: Option<DateTime<Utc>>,
    pub pending: bool,
}

#[derive(Clone)]
pub struct SimpleFinClient {
    http: Client,
    restrict_hosts: bool,
}

impl SimpleFinClient {
    pub fn new() -> Result<Self> {
        Self::build(true)
    }

    /// Talks to any http(s) host; for tests that stand in for the bridge with a local mock server.
    #[cfg(test)]
    pub fn unrestricted() -> Result<Self> {
        Self::build(false)
    }

    fn build(restrict_hosts: bool) -> Result<Self> {
        Ok(Self {
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(TIMEOUT_SECONDS))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .context("build SimpleFIN HTTP client")?,
            restrict_hosts,
        })
    }

    pub async fn claim(&self, setup_token: &str) -> Result<String> {
        let claim_url = STANDARD.decode(setup_token.trim()).context("decode setup token")?;
        let claim_url = String::from_utf8(claim_url).context("decode setup token")?;
        let claim_url = Url::parse(claim_url.trim()).context("decode setup token")?;
        self.ensure_allowed(&claim_url)?;
        let response = self.http.post(claim_url).send().await.context("claim request")?;
        let status = response.status();
        if status == reqwest::StatusCode::FORBIDDEN {
            anyhow::bail!("setup token already claimed (HTTP 403)");
        }
        let body = response.text().await.with_context(|| {
            if status == reqwest::StatusCode::OK { "read claim response" } else { "read claim error response" }
        })?;
        if status != reqwest::StatusCode::OK {
            anyhow::bail!("claim failed with HTTP {}: {}", status.as_u16(), truncate_body(&body));
        }

        let access_url = body.trim().to_owned();
        anyhow::ensure!(!access_url.is_empty(), "empty access URL returned by claim endpoint");
        self.ensure_allowed(&parse_access_url(&access_url)?)?;
        Ok(access_url)
    }

    pub async fn get_accounts(&self, access_url: &str, opts: GetAccountsOpts) -> Result<SimpleFinAccountSet> {
        let access_url = parse_access_url(access_url)?;
        self.ensure_allowed(&access_url)?;
        let username = access_url.username().to_owned();
        let password = access_url.password().map(str::to_owned);
        let endpoint = accounts_url(access_url, opts)?;
        let request = if username.is_empty() {
            self.http.get(endpoint)
        } else {
            self.http.get(endpoint).basic_auth(username, password)
        };
        let response = request.send().await.context("accounts request")?;
        let status = response.status();
        let body = response.text().await.with_context(|| {
            if status == reqwest::StatusCode::OK { "read accounts response" } else { "read accounts error response" }
        })?;
        if status != reqwest::StatusCode::OK {
            anyhow::bail!(
                "accounts request failed with HTTP {}: {}",
                status.as_u16(),
                truncate_body(&body)
            );
        }

        let decoded = serde_json::from_str::<SimpleFinAccountSet>(&body).context("decode accounts response")?;
        let (accounts, skipped_non_usd): (Vec<_>, Vec<_>) = decoded
            .accounts
            .into_iter()
            .partition(|account| is_usd(&account.currency));
        for account in &skipped_non_usd {
            tracing::debug!(account_id = %account.id, currency = %account.currency, "skipping non-USD simplefin account");
        }
        Ok(SimpleFinAccountSet {
            accounts,
            skipped_non_usd,
            ..decoded
        })
    }

    fn ensure_allowed(&self, url: &Url) -> Result<()> {
        if !self.restrict_hosts {
            return Ok(());
        }
        anyhow::ensure!(url.scheme() == "https", SIMPLEFIN_URL_NOT_HTTPS);
        anyhow::ensure!(
            url.host_str()
                .is_some_and(|host| ALLOWED_HOSTS.iter().any(|allowed| host.eq_ignore_ascii_case(allowed))),
            SIMPLEFIN_HOST_NOT_ALLOWED
        );
        Ok(())
    }
}

fn parse_access_url(access_url: &str) -> Result<Url> {
    Url::parse(access_url).map_err(|_| anyhow::anyhow!("invalid simplefin access URL"))
}

fn truncate_body(body: &str) -> &str {
    let end = (0..=MAX_ERROR_BODY_BYTES.min(body.len()))
        .rev()
        .find(|index| body.is_char_boundary(*index))
        .unwrap_or_default();
    &body[..end]
}

fn accounts_url(mut access_url: Url, opts: GetAccountsOpts) -> Result<Url> {
    access_url
        .set_username("")
        .map_err(|_| anyhow::anyhow!("invalid simplefin access URL"))?;
    access_url
        .set_password(None)
        .map_err(|_| anyhow::anyhow!("invalid simplefin access URL"))?;
    if !access_url.path().ends_with("/accounts") {
        let path = format!("{}/accounts", access_url.path().trim_end_matches('/'));
        access_url.set_path(&path);
    }
    let query_pairs = access_url
        .query_pairs()
        .filter(|(name, _)| name != "version" && name != "pending" && name != "start-date")
        .map(|(name, value)| (name.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    {
        let mut query = access_url.query_pairs_mut();
        query.clear().extend_pairs(query_pairs);
        query.append_pair("version", "2");
        if opts.pending {
            query.append_pair("pending", "1");
        }
        if let Some(start_date) = opts.start_date {
            query.append_pair("start-date", &start_date.timestamp().to_string());
        }
    }
    Ok(access_url)
}

fn is_usd(currency: &str) -> bool {
    let currency = currency.trim();
    currency.is_empty() || currency.eq_ignore_ascii_case("USD")
}

#[cfg(test)]
mod tests {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use chrono::{TimeZone, Utc};
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{basic_auth, method, path, query_param},
    };

    use super::{GetAccountsOpts, SIMPLEFIN_HOST_NOT_ALLOWED, SIMPLEFIN_URL_NOT_HTTPS, SimpleFinClient};

    #[tokio::test]
    async fn refuses_non_https_and_unlisted_hosts_before_sending_anything() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;
        let client = SimpleFinClient::new().unwrap();
        for (claim_url, message) in [
            (format!("{}/claim", server.uri()), SIMPLEFIN_URL_NOT_HTTPS),
            ("http://127.0.0.1:1/x".to_owned(), SIMPLEFIN_URL_NOT_HTTPS),
            ("https://169.254.169.254/x".to_owned(), SIMPLEFIN_HOST_NOT_ALLOWED),
            (
                "https://bridge.simplefin.org.evil.test/x".to_owned(),
                SIMPLEFIN_HOST_NOT_ALLOWED,
            ),
        ] {
            let token = STANDARD.encode(&claim_url);
            assert_eq!(
                client.claim(&token).await.unwrap_err().to_string(),
                message,
                "{claim_url}"
            );
            assert_eq!(
                client
                    .get_accounts(&claim_url, GetAccountsOpts::default())
                    .await
                    .unwrap_err()
                    .to_string(),
                message,
                "{claim_url}"
            );
        }
        assert!(server.received_requests().await.unwrap().is_empty());
    }

    #[test]
    fn truncation_never_splits_a_multi_byte_character() {
        let body = format!("{}\u{e9}tail", "a".repeat(255));
        let truncated = super::truncate_body(&body);
        assert_eq!(truncated, "a".repeat(255));
        assert_eq!(super::truncate_body("short"), "short");
        let exact = format!("{}\u{e9}", "a".repeat(254));
        assert_eq!(super::truncate_body(&exact), exact);
    }

    #[tokio::test]
    async fn truncates_oversized_error_bodies() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(500).set_body_string("e".repeat(5000)))
            .mount(&server)
            .await;
        let error = SimpleFinClient::unrestricted()
            .unwrap()
            .get_accounts(&server.uri(), GetAccountsOpts::default())
            .await
            .unwrap_err()
            .to_string();
        assert!(
            error.starts_with("accounts request failed with HTTP 500: eeee"),
            "{error}"
        );
        assert_eq!(error.len(), "accounts request failed with HTTP 500: ".len() + 256);
    }

    #[tokio::test]
    async fn claims_a_setup_token_and_fetches_accounts() {
        let server = MockServer::start().await;
        let access_url = format!(
            "{}://user:pass@{}/simplefin",
            server.uri().split_once("://").unwrap().0,
            server.address()
        );
        Mock::given(method("POST"))
            .and(path("/claim"))
            .respond_with(ResponseTemplate::new(200).set_body_string(access_url))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/simplefin/accounts"))
            .and(basic_auth("user", "pass"))
            .and(query_param("version", "2"))
            .and(query_param("pending", "1"))
            .and(query_param("start-date", "1780272000"))
            .respond_with(ResponseTemplate::new(200).set_body_string(ACCOUNTS))
            .mount(&server)
            .await;

        let client = SimpleFinClient::unrestricted().unwrap();
        let token = STANDARD.encode(format!("{}/claim", server.uri()));
        let access_url = client.claim(&token).await.unwrap();
        let accounts = client
            .get_accounts(
                &access_url,
                GetAccountsOpts {
                    start_date: Some(Utc.with_ymd_and_hms(2026, 6, 1, 0, 0, 0).unwrap()),
                    pending: true,
                },
            )
            .await
            .unwrap();

        assert_eq!(accounts.connections.len(), 1);
        assert_eq!(accounts.accounts[0].holdings[0].shares, "3539.578");
        assert_eq!(accounts.accounts[0].holdings[0].market_value, "100736.38");
        assert_eq!(accounts.accounts[0].holdings[0].cost_basis, "155506.10");
    }

    #[tokio::test]
    async fn rejects_invalid_tokens_and_urls() {
        let client = SimpleFinClient::new().unwrap();
        assert!(client.claim("not-base64").await.is_err());
        assert_eq!(
            client
                .get_accounts("http://user:secret@bad host/simplefin", GetAccountsOpts::default())
                .await
                .unwrap_err()
                .to_string(),
            "invalid simplefin access URL"
        );
    }

    #[tokio::test]
    async fn keeps_usd_accounts_and_skips_non_usd_accounts() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                r#"{"accounts":[
                    {"id":"usd-checking","currency":"USD"},
                    {"id":"crypto-account","currency":"USD","holdings":[{"id":"eth","symbol":"ETH","currency":"ETH"}]},
                    {"id":"eur-account","currency":"EUR"}
                ]}"#,
            ))
            .mount(&server)
            .await;

        let accounts = SimpleFinClient::unrestricted()
            .unwrap()
            .get_accounts(&server.uri(), GetAccountsOpts::default())
            .await
            .unwrap();

        let ids = |accounts: &[super::SimpleFinAccount]| accounts.iter().map(|a| a.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&accounts.accounts), ["usd-checking", "crypto-account"]);
        assert_eq!(ids(&accounts.skipped_non_usd), ["eur-account"]);
    }

    const ACCOUNTS: &str = r#"{
      "connections": [{"conn_id": "conn-1", "name": "Bank"}],
      "accounts": [{
        "id": "acc",
        "conn_id": "conn-1",
        "name": "Checking",
        "holdings": [{
          "id": "holding-1",
          "symbol": "VGIT",
          "description": "Vanguard Intermediate-Term Treasury Index Fund",
          "shares": "3539.578",
          "market_value": "100736.38",
          "cost_basis": "155506.10",
          "purchase_price": "21.9506",
          "currency": "USD",
          "created": 1780000000
        }]
      }]
    }"#;
}
