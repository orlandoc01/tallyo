use std::time::Duration;

use anyhow::{Context, Result};
use reqwest::Client;
use serde::Deserialize;
use url::Url;

use super::GoogleSettings;

pub const GOOGLE_CALLBACK_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone)]
pub struct GoogleClient {
    http: Client,
    settings: GoogleSettings,
    issuer_url: String,
    auth_url: Url,
    token_url: Url,
    userinfo_url: Url,
}

impl GoogleClient {
    pub fn new(http: Client, settings: GoogleSettings, issuer_url: String) -> Result<Self> {
        Ok(Self {
            http,
            auth_url: Url::parse(&settings.endpoints.auth).context("parse google auth URL")?,
            token_url: Url::parse(&settings.endpoints.token).context("parse google token URL")?,
            userinfo_url: Url::parse(&settings.endpoints.userinfo).context("parse google userinfo URL")?,
            settings,
            issuer_url,
        })
    }

    pub fn authorization_url(&self, state: &str) -> String {
        let mut url = self.auth_url.clone();
        url.query_pairs_mut()
            .append_pair("client_id", &self.settings.client_id)
            .append_pair("redirect_uri", &format!("{}/auth/google/callback", self.issuer_url))
            .append_pair("response_type", "code")
            .append_pair("scope", "openid email")
            .append_pair("state", state)
            .append_pair("access_type", "online");
        url.into()
    }

    pub async fn exchange(&self, code: &str) -> Result<String> {
        #[derive(Deserialize)]
        struct Token {
            access_token: String,
        }
        let token = self
            .http
            .post(self.token_url.clone())
            .form(&[
                ("code", code),
                ("client_id", self.settings.client_id.as_str()),
                ("client_secret", self.settings.client_secret.as_str()),
                ("redirect_uri", &format!("{}/auth/google/callback", self.issuer_url)),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await?
            .error_for_status()
            .context("google token exchange")?
            .json::<Token>()
            .await?;
        Ok(token.access_token)
    }

    pub async fn email(&self, token: &str) -> Result<String> {
        #[derive(Deserialize)]
        struct User {
            email: String,
        }
        let user = self
            .http
            .get(self.userinfo_url.clone())
            .bearer_auth(token)
            .send()
            .await?
            .error_for_status()
            .context("google userinfo")?
            .json::<User>()
            .await?;
        anyhow::ensure!(!user.email.is_empty(), "missing email");
        Ok(user.email)
    }
}

#[cfg(test)]
mod tests {
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };

    use super::GoogleClient;
    use crate::auth::GoogleSettings;

    #[tokio::test]
    async fn exchanges_and_looks_up_google_email() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"access_token":"token"})))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/userinfo"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"email":"person@example.com"})))
            .mount(&server)
            .await;
        let client = GoogleClient::new(
            reqwest::Client::new(),
            GoogleSettings {
                enabled: true,
                client_id: "client".to_owned(),
                client_secret: "secret".to_owned(),
                endpoints: crate::auth::GoogleEndpoints {
                    auth: format!("{}/auth", server.uri()),
                    token: format!("{}/token", server.uri()),
                    userinfo: format!("{}/userinfo", server.uri()),
                },
            },
            "https://tallyo.test".to_owned(),
        )
        .unwrap();
        assert_eq!(
            client.email(&client.exchange("code").await.unwrap()).await.unwrap(),
            "person@example.com"
        );
    }
}
