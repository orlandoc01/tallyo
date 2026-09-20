use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDate, Utc};
use reqwest::Client;
use serde::{Deserialize, Deserializer, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

const TIMEOUT_SECONDS: u64 = 30;
const PRODUCTION_BASE_URL: &str = "https://production.plaid.com";
const SANDBOX_BASE_URL: &str = "https://sandbox.plaid.com";
const DEVELOPMENT_BASE_URL: &str = "https://development.plaid.com";

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum PlaidEnvironment {
    Production,
    Sandbox,
    #[default]
    Development,
}

impl From<&str> for PlaidEnvironment {
    fn from(value: &str) -> Self {
        match value.to_ascii_lowercase().as_str() {
            "production" => Self::Production,
            "sandbox" => Self::Sandbox,
            _ => Self::Development,
        }
    }
}

impl PlaidEnvironment {
    const fn base_url(self) -> &'static str {
        match self {
            Self::Production => PRODUCTION_BASE_URL,
            Self::Sandbox => SANDBOX_BASE_URL,
            Self::Development => DEVELOPMENT_BASE_URL,
        }
    }
}

#[derive(Clone, Debug)]
pub struct PlaidCredential {
    pub client_id: String,
    pub secret: String,
    pub environment: PlaidEnvironment,
}

/// Details returned by a failed Plaid API request.
#[derive(Clone, Debug, PartialEq)]
pub struct PlaidApiError {
    pub status: reqwest::StatusCode,
    pub body: String,
    pub error_code: Option<String>,
    pub error_type: Option<String>,
    pub error_message: Option<String>,
    pub request_id: Option<String>,
}

impl PlaidApiError {
    fn from_response(status: reqwest::StatusCode, body: String) -> Self {
        let envelope = serde_json::from_str::<PlaidErrorEnvelope>(&body).unwrap_or_default();
        Self {
            status,
            body,
            error_code: envelope.error_code,
            error_type: envelope.error_type,
            error_message: envelope.error_message,
            request_id: envelope.request_id,
        }
    }
}

impl std::fmt::Display for PlaidApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "plaid returned {}: {}", self.status.as_u16(), self.body)
    }
}

impl std::error::Error for PlaidApiError {}

pub struct PlaidClient {
    client_id: String,
    secret: String,
    base_url: String,
    http: Client,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct AccountBase {
    pub account_id: String,
    pub balances: AccountBalance,
    pub name: String,
    #[serde(rename = "type")]
    pub account_type: String,
    pub subtype: Option<String>,
    pub mask: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct AccountBalance {
    pub current: Option<f64>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct Holding {
    pub account_id: String,
    pub security_id: String,
    pub institution_price: f64,
    pub institution_value: f64,
    pub cost_basis: Option<f64>,
    pub quantity: f64,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct Security {
    pub security_id: String,
    pub ticker_symbol: Option<String>,
    #[serde(rename = "type")]
    pub security_type: Option<String>,
    pub is_cash_equivalent: Option<bool>,
    pub name: Option<String>,
    pub close_price: Option<f64>,
    pub close_price_as_of: Option<String>,
    pub cusip: Option<String>,
    pub isin: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct InvestmentTransaction {
    pub investment_transaction_id: String,
    pub account_id: String,
    pub security_id: Option<String>,
    pub date: String,
    pub name: String,
    pub amount: f64,
    #[serde(rename = "type")]
    pub transaction_type: String,
    pub subtype: String,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct Transaction {
    pub transaction_id: String,
    pub account_id: String,
    pub amount: f64,
    pub date: String,
    pub name: String,
    pub merchant_name: Option<String>,
    pub original_description: Option<String>,
    pub logo_url: Option<String>,
    pub authorized_date: Option<String>,
    #[serde(deserialize_with = "deserialize_optional_datetime")]
    pub authorized_datetime: Option<DateTime<Utc>>,
    #[serde(deserialize_with = "deserialize_optional_datetime")]
    pub datetime: Option<DateTime<Utc>>,
    pub category: Vec<String>,
    pub personal_finance_category: Option<PersonalFinanceCategory>,
    pub counterparties: Option<Vec<TransactionCounterparty>>,
    pub pending: bool,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct PersonalFinanceCategory {
    pub primary: String,
    pub detailed: String,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct TransactionCounterparty {
    pub logo_url: Option<String>,
    pub website: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct RemovedTransaction {
    pub transaction_id: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct TransactionStream {
    pub account_id: String,
    pub stream_id: String,
    pub description: String,
    pub merchant_name: Option<String>,
    pub first_date: String,
    pub last_date: String,
    pub frequency: String,
    pub transaction_ids: Vec<String>,
    pub average_amount: TransactionStreamAmount,
    pub last_amount: TransactionStreamAmount,
    pub is_active: bool,
    pub status: String,
    pub is_user_modified: bool,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct TransactionStreamAmount {
    pub amount: Option<f64>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct Item {
    pub available_products: Vec<String>,
    pub billed_products: Vec<String>,
    pub products: Option<Vec<String>>,
    pub consented_products: Option<Vec<String>>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct Institution {
    pub name: String,
    pub products: Vec<String>,
    pub url: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct InvestmentsHoldingsGetResponse {
    pub accounts: Vec<AccountBase>,
    pub holdings: Vec<Holding>,
    pub securities: Vec<Security>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct InvestmentsTransactionsGetResponse {
    pub securities: Vec<Security>,
    pub investment_transactions: Vec<InvestmentTransaction>,
    pub total_investment_transactions: i32,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct TransactionsSyncResponse {
    pub added: Vec<Transaction>,
    pub modified: Vec<Transaction>,
    pub removed: Vec<RemovedTransaction>,
    pub next_cursor: String,
    pub has_more: bool,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct TransactionsRecurringGetResponse {
    pub inflow_streams: Vec<TransactionStream>,
    pub outflow_streams: Vec<TransactionStream>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

impl PlaidClient {
    pub fn new(credential: PlaidCredential) -> Result<Self> {
        Self::with_base_url(credential.environment.base_url(), credential)
    }

    pub fn with_base_url(base_url: impl Into<String>, credential: PlaidCredential) -> Result<Self> {
        Ok(Self {
            client_id: credential.client_id,
            secret: credential.secret,
            base_url: base_url.into().trim_end_matches('/').to_owned(),
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(TIMEOUT_SECONDS))
                .build()
                .context("build Plaid HTTP client")?,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub async fn accounts(&self, access_token: &str) -> Result<Vec<AccountBase>> {
        Ok(self
            .post::<AccountsResponse>("/accounts/get", json!({"access_token": access_token}))
            .await?
            .accounts)
    }

    pub async fn accounts_balance_get(&self, access_token: &str) -> Result<Vec<AccountBase>> {
        Ok(self
            .post::<AccountsResponse>("/accounts/balance/get", json!({"access_token": access_token}))
            .await?
            .accounts)
    }

    pub async fn investments_holdings_get(&self, access_token: &str) -> Result<InvestmentsHoldingsGetResponse> {
        self.post("/investments/holdings/get", json!({"access_token": access_token}))
            .await
    }

    pub async fn investments_transactions_get(
        &self,
        access_token: &str,
        start_date: NaiveDate,
        end_date: NaiveDate,
        account_ids: &[String],
        count: i32,
        offset: i32,
    ) -> Result<InvestmentsTransactionsGetResponse> {
        let mut options = json!({"count": count, "offset": offset, "async_update": false});
        if !account_ids.is_empty() {
            options["account_ids"] = json!(account_ids);
        }
        self.post(
            "/investments/transactions/get",
            json!({
                "access_token": access_token,
                "start_date": start_date,
                "end_date": end_date,
                "options": options,
            }),
        )
        .await
    }

    pub async fn sync(&self, access_token: &str, cursor: &str) -> Result<TransactionsSyncResponse> {
        let mut body = json!({
            "access_token": access_token,
            "count": 500,
            "options": {
                "include_original_description": true,
                "include_personal_finance_category": false,
                "include_logo_and_counterparty_beta": false,
                "days_requested": 90,
            },
        });
        if !cursor.is_empty() {
            body["cursor"] = json!(cursor);
        }
        self.post("/transactions/sync", body).await
    }

    pub async fn create_link_token(&self, owner: &str) -> Result<(String, DateTime<Utc>)> {
        self.create_link_token_request(json!({
            "client_name": "Tallyo",
            "language": "en",
            "country_codes": ["US"],
            "user": {"client_user_id": owner},
            "products": ["transactions"],
            "additional_consented_products": ["investments", "liabilities"],
        }))
        .await
    }

    pub async fn create_update_link_token(
        &self,
        access_token: &str,
        owner: &str,
        investments_enabled: bool,
        liabilities_enabled: bool,
    ) -> Result<(String, DateTime<Utc>)> {
        let additional_products = [
            (!investments_enabled).then_some("investments"),
            (!liabilities_enabled).then_some("liabilities"),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
        let mut body = json!({
            "client_name": "Tallyo",
            "language": "en",
            "country_codes": ["US"],
            "user": {"client_user_id": owner},
            "access_token": access_token,
        });
        if !additional_products.is_empty() {
            body["additional_consented_products"] = json!(additional_products);
        }
        self.create_link_token_request(body).await
    }

    pub async fn exchange_public_token(&self, public_token: &str) -> Result<(String, String)> {
        let response: PublicTokenExchangeResponse = self
            .post("/item/public_token/exchange", json!({"public_token": public_token}))
            .await?;
        Ok((response.access_token, response.item_id))
    }

    pub async fn item_get(&self, access_token: &str) -> Result<Item> {
        Ok(self
            .post::<ItemResponse>("/item/get", json!({"access_token": access_token}))
            .await?
            .item)
    }

    pub async fn institution(&self, institution_id: &str) -> Result<Institution> {
        Ok(self
            .post::<InstitutionResponse>(
                "/institutions/get_by_id",
                json!({
                    "institution_id": institution_id,
                    "country_codes": ["US"],
                    "options": {
                        "include_optional_metadata": true,
                        "include_status": false,
                        "include_auth_metadata": false,
                        "include_payment_initiation_metadata": false,
                    },
                }),
            )
            .await?
            .institution)
    }

    pub async fn transactions_recurring_get(
        &self,
        access_token: &str,
        account_ids: &[String],
    ) -> Result<TransactionsRecurringGetResponse> {
        self.post(
            "/transactions/recurring/get",
            json!({"access_token": access_token, "account_ids": account_ids}),
        )
        .await
    }

    async fn create_link_token_request(&self, body: Value) -> Result<(String, DateTime<Utc>)> {
        let response: LinkTokenResponse = self.post("/link/token/create", body).await?;
        let expiration = DateTime::parse_from_rfc3339(&response.expiration)
            .context("parse Plaid link token expiration")?
            .with_timezone(&Utc);
        Ok((response.link_token, expiration))
    }

    async fn post<T: DeserializeOwned>(&self, path: &str, mut body: Value) -> Result<T> {
        let credentials = body.as_object_mut().context("Plaid request body must be an object")?;
        credentials.insert("client_id".to_owned(), json!(self.client_id));
        credentials.insert("secret".to_owned(), json!(self.secret));
        let response = self
            .http
            .post(format!("{}{}", self.base_url, path))
            .json(&body)
            .send()
            .await
            .context("Plaid request")?;
        let status = response.status();
        let response_body = response.text().await.context("read Plaid response")?;
        if !status.is_success() {
            return Err(PlaidApiError::from_response(status, response_body).into());
        }
        serde_json::from_str(&response_body).context("decode Plaid response")
    }
}

fn deserialize_optional_datetime<'de, D>(deserializer: D) -> std::result::Result<Option<DateTime<Utc>>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer)?.map_or(Ok(None), |value| {
        DateTime::parse_from_rfc3339(&value)
            .map(|value| Some(value.with_timezone(&Utc)))
            .map_err(serde::de::Error::custom)
    })
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct AccountsResponse {
    accounts: Vec<AccountBase>,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct LinkTokenResponse {
    link_token: String,
    expiration: String,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct PublicTokenExchangeResponse {
    access_token: String,
    item_id: String,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct ItemResponse {
    item: Item,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct InstitutionResponse {
    institution: Institution,
}

#[derive(Default, Deserialize)]
struct PlaidErrorEnvelope {
    error_code: Option<String>,
    error_type: Option<String>,
    error_message: Option<String>,
    request_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use chrono::{NaiveDate, TimeZone, Utc};
    use serde_json::json;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{body_json, method, path},
    };

    use super::{AccountBase, PlaidApiError, PlaidClient, PlaidCredential, PlaidEnvironment};

    fn credential() -> PlaidCredential {
        PlaidCredential {
            client_id: "client".to_owned(),
            secret: "secret".to_owned(),
            environment: PlaidEnvironment::Development,
        }
    }

    #[test]
    fn configures_the_expected_environment() {
        for (environment, base_url) in [
            (PlaidEnvironment::Production, "https://production.plaid.com"),
            (PlaidEnvironment::Sandbox, "https://sandbox.plaid.com"),
            (PlaidEnvironment::Development, "https://development.plaid.com"),
        ] {
            let client = PlaidClient::new(PlaidCredential {
                environment,
                ..credential()
            })
            .unwrap();
            assert_eq!(client.base_url(), base_url);
        }
        assert_eq!(PlaidEnvironment::from("unknown"), PlaidEnvironment::Development);
    }

    #[test]
    fn preserves_provider_fields_not_yet_consumed_by_the_client() {
        let account = serde_json::from_value::<AccountBase>(json!({
            "account_id": "account",
            "official_name": "Checking",
            "balances": {"current": 1.0, "limit": 2.0}
        }))
        .unwrap();
        assert_eq!(account.extra["official_name"], "Checking");
        assert_eq!(account.balances.extra["limit"], 2.0);
        assert_eq!(serde_json::to_value(account).unwrap()["official_name"], "Checking");
    }

    #[tokio::test]
    async fn sends_every_supported_plaid_request() {
        let server = MockServer::start().await;
        mount(
            &server,
            "/accounts/get",
            json!({"access_token": "access", "client_id": "client", "secret": "secret"}),
            r#"{"accounts":[{"account_id":"account"}]}"#,
        )
        .await;
        mount(
            &server,
            "/accounts/balance/get",
            json!({"access_token": "access", "client_id": "client", "secret": "secret"}),
            r#"{"accounts":[]}"#,
        )
        .await;
        mount(
            &server,
            "/investments/holdings/get",
            json!({"access_token": "access", "client_id": "client", "secret": "secret"}),
            r#"{"holdings":[]}"#,
        )
        .await;
        mount(&server, "/investments/transactions/get", json!({"access_token":"access","start_date":"2026-01-01","end_date":"2026-01-31","options":{"account_ids":["account"],"count":500,"offset":0,"async_update":false},"client_id":"client","secret":"secret"}), r#"{"investment_transactions":[]}"#).await;
        mount(&server, "/transactions/sync", json!({"access_token":"access","cursor":"cursor","count":500,"options":{"include_original_description":true,"include_personal_finance_category":false,"include_logo_and_counterparty_beta":false,"days_requested":90},"client_id":"client","secret":"secret"}), r#"{"added":[],"next_cursor":"next"}"#).await;
        mount(&server, "/link/token/create", json!({"client_name":"Tallyo","language":"en","country_codes":["US"],"user":{"client_user_id":"owner"},"products":["transactions"],"additional_consented_products":["investments","liabilities"],"client_id":"client","secret":"secret"}), r#"{"link_token":"link","expiration":"2026-01-01T00:00:00Z"}"#).await;
        mount(&server, "/link/token/create", json!({"client_name":"Tallyo","language":"en","country_codes":["US"],"user":{"client_user_id":"owner"},"access_token":"access","additional_consented_products":["liabilities"],"client_id":"client","secret":"secret"}), r#"{"link_token":"update","expiration":"2026-01-01T00:00:00Z"}"#).await;
        mount(
            &server,
            "/item/public_token/exchange",
            json!({"public_token":"public","client_id":"client","secret":"secret"}),
            r#"{"access_token":"access","item_id":"item"}"#,
        )
        .await;
        mount(
            &server,
            "/item/get",
            json!({"access_token":"access","client_id":"client","secret":"secret"}),
            r#"{"item":{"products":["transactions"]}}"#,
        )
        .await;
        mount(&server, "/institutions/get_by_id", json!({"institution_id":"institution","country_codes":["US"],"options":{"include_optional_metadata":true,"include_status":false,"include_auth_metadata":false,"include_payment_initiation_metadata":false},"client_id":"client","secret":"secret"}), r#"{"institution":{"name":"Bank"}}"#).await;
        mount(
            &server,
            "/transactions/recurring/get",
            json!({"access_token":"access","account_ids":["account"],"client_id":"client","secret":"secret"}),
            r#"{"inflow_streams":[]}"#,
        )
        .await;

        let client = PlaidClient::with_base_url(server.uri(), credential()).unwrap();
        assert_eq!(client.accounts("access").await.unwrap()[0].account_id, "account");
        assert!(client.accounts_balance_get("access").await.unwrap().is_empty());
        assert!(
            client
                .investments_holdings_get("access")
                .await
                .unwrap()
                .holdings
                .is_empty()
        );
        assert!(
            client
                .investments_transactions_get(
                    "access",
                    NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
                    NaiveDate::from_ymd_opt(2026, 1, 31).unwrap(),
                    &["account".to_owned()],
                    500,
                    0,
                )
                .await
                .unwrap()
                .investment_transactions
                .is_empty()
        );
        assert_eq!(client.sync("access", "cursor").await.unwrap().next_cursor, "next");
        assert_eq!(
            client.create_link_token("owner").await.unwrap().1,
            Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap()
        );
        assert_eq!(
            client
                .create_update_link_token("access", "owner", true, false)
                .await
                .unwrap()
                .0,
            "update"
        );
        assert_eq!(client.exchange_public_token("public").await.unwrap().1, "item");
        assert_eq!(
            client.item_get("access").await.unwrap().products.unwrap(),
            vec!["transactions"]
        );
        assert_eq!(client.institution("institution").await.unwrap().name, "Bank");
        assert!(
            client
                .transactions_recurring_get("access", &["account".to_owned()])
                .await
                .unwrap()
                .inflow_streams
                .is_empty()
        );
    }

    #[tokio::test]
    async fn reports_plaid_status_and_response_body() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/accounts/get"))
            .respond_with(ResponseTemplate::new(400).set_body_string(
                r#"{"error_code":"ITEM_LOGIN_REQUIRED","error_type":"ITEM_ERROR","error_message":"login required","request_id":"request"}"#,
            ))
            .mount(&server)
            .await;
        let error = PlaidClient::with_base_url(server.uri(), credential())
            .unwrap()
            .accounts("access")
            .await
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "plaid returned 400: {\"error_code\":\"ITEM_LOGIN_REQUIRED\",\"error_type\":\"ITEM_ERROR\",\"error_message\":\"login required\",\"request_id\":\"request\"}"
        );
        let plaid_error = error.downcast_ref::<PlaidApiError>().unwrap();
        assert_eq!(plaid_error.error_code.as_deref(), Some("ITEM_LOGIN_REQUIRED"));
        assert_eq!(plaid_error.error_type.as_deref(), Some("ITEM_ERROR"));
        assert_eq!(plaid_error.error_message.as_deref(), Some("login required"));
        assert_eq!(plaid_error.request_id.as_deref(), Some("request"));
    }

    async fn mount(server: &MockServer, endpoint: &str, body: serde_json::Value, response: &str) {
        Mock::given(method("POST"))
            .and(path(endpoint))
            .and(body_json(body))
            .respond_with(ResponseTemplate::new(200).set_body_string(response))
            .mount(server)
            .await;
    }
}
