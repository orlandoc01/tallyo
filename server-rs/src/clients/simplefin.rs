use anyhow::{Context, Result};
use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

const TIMEOUT_SECONDS: u64 = 30;

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
}

impl SimpleFinClient {
    pub fn new() -> Result<Self> {
        Ok(Self {
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(TIMEOUT_SECONDS))
                .build()
                .context("build SimpleFIN HTTP client")?,
        })
    }

    pub async fn claim(&self, setup_token: &str) -> Result<String> {
        let claim_url = STANDARD.decode(setup_token.trim()).context("decode setup token")?;
        let claim_url = String::from_utf8(claim_url).context("decode setup token")?;
        let response = self.http.post(claim_url.trim()).send().await.context("claim request")?;
        let status = response.status();
        if status == reqwest::StatusCode::FORBIDDEN {
            anyhow::bail!("setup token already claimed (HTTP 403)");
        }
        let body = response.text().await.with_context(|| {
            if status == reqwest::StatusCode::OK { "read claim response" } else { "read claim error response" }
        })?;
        if status != reqwest::StatusCode::OK {
            anyhow::bail!("claim failed with HTTP {}: {body}", status.as_u16());
        }

        let access_url = body.trim().to_owned();
        anyhow::ensure!(!access_url.is_empty(), "empty access URL returned by claim endpoint");
        parse_access_url(&access_url)?;
        Ok(access_url)
    }

    pub async fn get_accounts(&self, access_url: &str, opts: GetAccountsOpts) -> Result<SimpleFinAccountSet> {
        let access_url = parse_access_url(access_url)?;
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
            anyhow::bail!("accounts request failed with HTTP {}: {body}", status.as_u16());
        }

        let accounts = serde_json::from_str::<SimpleFinAccountSet>(&body).context("decode accounts response")?;
        validate_currencies(&accounts)?;
        Ok(accounts)
    }
}

fn parse_access_url(access_url: &str) -> Result<Url> {
    Url::parse(access_url).map_err(|_| anyhow::anyhow!("invalid simplefin access URL"))
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

fn validate_currencies(accounts: &SimpleFinAccountSet) -> Result<()> {
    for account in &accounts.accounts {
        if !account.currency.is_empty() && !account.currency.eq_ignore_ascii_case("USD") {
            anyhow::bail!("unsupported simplefin account currency {:?}", account.currency);
        }
        for holding in &account.holdings {
            if !holding.currency.is_empty() && !holding.currency.eq_ignore_ascii_case("USD") {
                anyhow::bail!("unsupported simplefin holding currency {:?}", holding.currency);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use chrono::{TimeZone, Utc};
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{basic_auth, method, path, query_param},
    };

    use super::{GetAccountsOpts, SimpleFinClient};

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

        let client = SimpleFinClient::new().unwrap();
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
    async fn rejects_invalid_tokens_and_non_usd_accounts() {
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

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_string(r#"{"accounts":[{"currency":"EUR"}]}"#))
            .mount(&server)
            .await;
        assert!(
            client
                .get_accounts(&server.uri(), GetAccountsOpts::default())
                .await
                .is_err()
        );
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
