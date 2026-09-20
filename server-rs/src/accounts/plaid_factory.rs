use anyhow::{Result, anyhow};
use sqlx::SqlitePool;

use crate::{
    clients::plaid::{PlaidClient, PlaidCredential, PlaidEnvironment},
    database::queries,
};

#[derive(Clone)]
pub struct PlaidClientFactory {
    pool: SqlitePool,
    base_url: Option<String>,
}

impl PlaidClientFactory {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool, base_url: None }
    }

    pub fn with_base_url(pool: SqlitePool, base_url: impl Into<String>) -> Self {
        Self {
            pool,
            base_url: Some(base_url.into()),
        }
    }

    pub async fn client_for_credential(&self, credential_id: i64) -> Result<PlaidClient> {
        let credential = queries::plaid_credential_secret_by_id_opt(
            &self.pool,
            queries::PlaidCredentialSecretByIdParams { id: credential_id },
        )
        .await?
        .ok_or_else(|| anyhow!("plaid credential {credential_id} not found"))?;
        let credential = PlaidCredential {
            client_id: credential.client_id,
            secret: credential.secret,
            environment: PlaidEnvironment::from(credential.environment.as_str()),
        };
        match &self.base_url {
            Some(base_url) => PlaidClient::with_base_url(base_url, credential),
            None => PlaidClient::new(credential),
        }
    }
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use crate::{accounts::PlaidClientFactory, database::dbtest, testutil::store::create_plaid_credential};

    #[tokio::test]
    async fn builds_fresh_clients_from_stored_credentials() -> Result<()> {
        let pool = dbtest::open().await?;
        let credential_id = create_plaid_credential(&pool).await?;
        let factory = PlaidClientFactory::new(pool);
        factory.client_for_credential(credential_id).await?;
        assert_eq!(
            factory.client_for_credential(-1).await.err().unwrap().to_string(),
            "plaid credential -1 not found"
        );
        Ok(())
    }
}
