use anyhow::{Context, Result};

use crate::database::queries;

use super::{OAuthClient, Store, split_scopes};
use crate::auth::{CLIENT_ALLOWED_SCOPES, FRONTEND_CLIENT_ID, SigningKey};

impl Store {
    pub async fn upsert_frontend_client(&self, redirect_uris: &[String]) -> Result<()> {
        self.save_client(OAuthClient {
            id: FRONTEND_CLIENT_ID.to_owned(),
            redirect_uris: redirect_uris.to_vec(),
            grant_types: vec!["authorization_code".to_owned(), "refresh_token".to_owned()],
            response_types: vec!["code".to_owned()],
            scopes: CLIENT_ALLOWED_SCOPES.iter().map(ToString::to_string).collect(),
            application_type: "web".to_owned(),
            client_name: "Tallyo Web".to_owned(),
            public: true,
            preseeded: true,
        })
        .await
    }

    pub async fn save_client(&self, client: OAuthClient) -> Result<()> {
        let redirect_uris = serde_json::to_string(&client.redirect_uris)?;
        let grant_types = serde_json::to_string(&client.grant_types)?;
        let response_types = serde_json::to_string(&client.response_types)?;
        queries::save_o_auth_client(
            &self.pool,
            queries::SaveOAuthClientParams {
                id: &client.id,
                redirect_uris: &redirect_uris,
                grant_types: &grant_types,
                response_types: &response_types,
                scopes: &client.scopes.join(" "),
                application_type: &client.application_type,
                client_name: Some(&client.client_name),
                is_public: client.public,
                is_preseeded: client.preseeded,
            },
        )
        .await
        .context("save oauth client")
    }

    pub async fn client(&self, id: &str) -> Result<Option<OAuthClient>> {
        queries::o_auth_client_opt(&self.pool, queries::OAuthClientParams { id })
            .await?
            .map(OAuthClient::try_from)
            .transpose()
    }

    pub async fn load_or_create_signing_key(&self) -> Result<SigningKey> {
        if let Some(row) = queries::load_signing_key_pem_opt(&self.pool).await? {
            return SigningKey::parse(&row.private_key_pem, &row.public_key_pem);
        }
        let key = SigningKey::generate()?;
        queries::save_signing_key_pem(
            &self.pool,
            queries::SaveSigningKeyPemParams {
                private_pem: key.private_pem(),
                public_pem: key.public_pem(),
            },
        )
        .await?;
        Ok(key)
    }
}

impl TryFrom<queries::OAuthClientRow> for OAuthClient {
    type Error = anyhow::Error;

    fn try_from(row: queries::OAuthClientRow) -> Result<Self> {
        Ok(Self {
            id: row.id,
            redirect_uris: serde_json::from_str(&row.redirect_uris).context("parse oauth client redirect_uris")?,
            grant_types: serde_json::from_str(&row.grant_types).context("parse oauth client grant_types")?,
            response_types: serde_json::from_str(&row.response_types).context("parse oauth client response_types")?,
            scopes: split_scopes(&row.scopes),
            application_type: row.application_type,
            client_name: row.client_name,
            public: row.is_public,
            preseeded: row.is_preseeded,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::dbtest;

    #[tokio::test]
    async fn converts_clients_and_rejects_corrupt_json() {
        let pool = dbtest::open().await.unwrap();
        let store = Store::new(pool.clone());
        let redirect_uris = vec!["https://client.test/callback".to_owned()];
        store.upsert_frontend_client(&redirect_uris).await.unwrap();
        let client = store.client(FRONTEND_CLIENT_ID).await.unwrap().unwrap();
        assert_eq!(client.redirect_uris, redirect_uris);
        assert_eq!(client.grant_types, ["authorization_code", "refresh_token"]);
        assert_eq!(client.response_types, ["code"]);
        assert_eq!(client.scopes, *CLIENT_ALLOWED_SCOPES);
        assert!(client.public && client.preseeded);
        store.save_client(client.clone()).await.unwrap();
        assert_eq!(store.client(FRONTEND_CLIENT_ID).await.unwrap().unwrap(), client);

        for field in ["redirect_uris", "grant_types", "response_types"] {
            let mut row = queries::o_auth_client(&pool, queries::OAuthClientParams { id: FRONTEND_CLIENT_ID })
                .await
                .unwrap();
            match field {
                "redirect_uris" => row.redirect_uris = "null".to_owned(),
                "grant_types" => row.grant_types = "[1]".to_owned(),
                _ => row.response_types = "invalid".to_owned(),
            }
            assert_eq!(
                OAuthClient::try_from(row).unwrap_err().to_string(),
                format!("parse oauth client {field}")
            );
        }
    }

    #[tokio::test]
    async fn reloads_persisted_signing_keys() {
        let store = Store::new(dbtest::open().await.unwrap());
        let first = store.load_or_create_signing_key().await.unwrap();
        let second = store.load_or_create_signing_key().await.unwrap();
        assert_eq!(first.public_pem(), second.public_pem());
    }
}
