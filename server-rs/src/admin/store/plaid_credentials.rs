use std::collections::HashMap;

use anyhow::{Context, Result, ensure};
use sqlx::{Executor, Sqlite, SqlitePool};

use crate::{
    admin::PlaidCredential,
    apierror::ApiError,
    database::queries,
    schema::{CreatePlaidCredentialInput, UpdatePlaidCredentialInput},
};

const CLIENT_ID_REQUIRED: &str = "client_id is required";
const SECRET_REQUIRED: &str = "secret is required";

pub async fn create_plaid_credential(pool: &SqlitePool, input: CreatePlaidCredentialInput) -> Result<PlaidCredential> {
    let client_id = input.client_id.trim();
    let secret = input.secret.trim();
    ensure!(!client_id.is_empty(), ApiError::bad_input(CLIENT_ID_REQUIRED));
    ensure!(!secret.is_empty(), ApiError::bad_input(SECRET_REQUIRED));
    let label = input.label.as_deref().map(str::trim).filter(|label| !label.is_empty());
    let environment = input.environment.to_string().to_lowercase();
    let id = queries::create_plaid_credential(
        pool,
        queries::CreatePlaidCredentialParams {
            client_id,
            secret,
            environment: &environment,
            label,
        },
    )
    .await?
    .id;
    plaid_credential(pool, id)
        .await?
        .context("find created plaid credential")
}

pub async fn update_plaid_credential(pool: &SqlitePool, input: UpdatePlaidCredentialInput) -> Result<PlaidCredential> {
    let secret = input.secret.trim();
    ensure!(!secret.is_empty(), ApiError::bad_input(SECRET_REQUIRED));
    let environment = input.environment.to_string().to_lowercase();
    let updated = queries::update_plaid_credential(
        pool,
        queries::UpdatePlaidCredentialParams {
            secret,
            environment: &environment,
            id: i64::from(input.id),
        },
    )
    .await?;
    ensure!(updated > 0, "plaid credential not found");
    plaid_credential(pool, i64::from(input.id))
        .await?
        .context("find updated plaid credential")
}

pub async fn delete_plaid_credential(executor: impl Executor<'_, Database = Sqlite>, id: i64) -> Result<bool> {
    queries::delete_plaid_credential(executor, queries::DeletePlaidCredentialParams { id })
        .await
        .map(|rows| rows > 0)
        .map_err(Into::into)
}

pub async fn plaid_credentials(executor: impl Executor<'_, Database = Sqlite>) -> Result<Vec<PlaidCredential>> {
    queries::list_plaid_credentials(executor, queries::ListPlaidCredentialsParams::default())
        .await
        .map_err(Into::into)
        .and_then(|rows| rows.into_iter().map(PlaidCredential::try_from).collect())
}

pub async fn plaid_credential(
    executor: impl Executor<'_, Database = Sqlite>,
    id: i64,
) -> Result<Option<PlaidCredential>> {
    plaid_credentials_by_ids(executor, &[id])
        .await
        .map(|mut credentials| credentials.remove(&id))
}

pub async fn plaid_credentials_by_ids(
    executor: impl Executor<'_, Database = Sqlite>,
    ids: &[i64],
) -> Result<HashMap<i64, PlaidCredential>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    queries::list_plaid_credentials(executor, queries::ListPlaidCredentialsParams { ids: Some(ids) })
        .await
        .map_err(Into::into)
        .and_then(|rows| {
            rows.into_iter()
                .map(|row| {
                    let id = row.id;
                    PlaidCredential::try_from(row).map(|credential| (id, credential))
                })
                .collect::<Result<HashMap<_, _>>>()
        })
}

pub async fn plaid_credential_secret_by_id(
    executor: impl Executor<'_, Database = Sqlite>,
    id: i64,
) -> Result<Option<crate::clients::plaid::PlaidCredential>> {
    queries::plaid_credential_secret_by_id_opt(executor, queries::PlaidCredentialSecretByIdParams { id })
        .await
        .map(|row| {
            row.map(|row| crate::clients::plaid::PlaidCredential {
                client_id: row.client_id,
                secret: row.secret,
                environment: row.environment.as_str().into(),
            })
        })
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::{
        CLIENT_ID_REQUIRED, SECRET_REQUIRED, create_plaid_credential, delete_plaid_credential, plaid_credential,
        plaid_credential_secret_by_id, plaid_credentials, plaid_credentials_by_ids, update_plaid_credential,
    };
    use crate::{
        database::{dbtest, queries},
        schema::{CreatePlaidCredentialInput, PlaidEnvironment, UpdatePlaidCredentialInput},
        testutil::store::{create_owner, seed_plaid_item},
    };

    fn create_input() -> CreatePlaidCredentialInput {
        CreatePlaidCredentialInput {
            client_id: " client-1 ".to_owned(),
            secret: " secret-1 ".to_owned(),
            environment: PlaidEnvironment::Development,
            label: Some(" Primary ".to_owned()),
        }
    }

    #[tokio::test]
    async fn validates_creates_updates_and_deletes_credentials() {
        let pool = dbtest::open().await.unwrap();
        let mut missing_client_id = create_input();
        missing_client_id.client_id = " ".to_owned();
        assert_eq!(
            create_plaid_credential(&pool, missing_client_id)
                .await
                .unwrap_err()
                .to_string(),
            CLIENT_ID_REQUIRED
        );
        let mut missing_secret = create_input();
        missing_secret.secret = " ".to_owned();
        assert_eq!(
            create_plaid_credential(&pool, missing_secret)
                .await
                .unwrap_err()
                .to_string(),
            SECRET_REQUIRED
        );

        let created = create_plaid_credential(&pool, create_input()).await.unwrap();
        assert_eq!(created.client_id, "client-1");
        assert_eq!(created.label.as_deref(), Some("Primary"));
        assert_eq!(created.environment, PlaidEnvironment::Development);
        assert_eq!(plaid_credentials(&pool).await.unwrap(), vec![created.clone()]);
        assert_eq!(
            plaid_credential_secret_by_id(&pool, i64::from(created.id))
                .await
                .unwrap()
                .unwrap()
                .secret,
            "secret-1"
        );

        let updated = update_plaid_credential(
            &pool,
            UpdatePlaidCredentialInput {
                id: created.id,
                secret: "secret-2".to_owned(),
                environment: PlaidEnvironment::Production,
            },
        )
        .await
        .unwrap();
        assert_eq!(updated.environment, PlaidEnvironment::Production);
        assert_eq!(plaid_credentials_by_ids(&pool, &[]).await.unwrap().len(), 0);
        assert!(delete_plaid_credential(&pool, i64::from(created.id)).await.unwrap());
        assert!(plaid_credential(&pool, i64::from(created.id)).await.unwrap().is_none());
        assert!(!delete_plaid_credential(&pool, i64::from(created.id)).await.unwrap());
    }

    #[tokio::test]
    async fn counts_active_items_and_rejects_invalid_storage_environments() {
        let pool = dbtest::open().await.unwrap();
        let owner = create_owner(&pool, "Owner").await.unwrap();
        let (item_id, _) = seed_plaid_item(&pool, &owner, "item").await.unwrap();
        let credential_id = i64::from(plaid_credentials(&pool).await.unwrap().pop().unwrap().id);

        assert_eq!(
            plaid_credentials_by_ids(&pool, &[credential_id]).await.unwrap()[&credential_id].item_count,
            1
        );
        assert!(delete_plaid_credential(&pool, credential_id).await.is_err());

        queries::delete_plaid_item(&pool, queries::DeletePlaidItemParams { id: item_id })
            .await
            .unwrap();
        assert!(delete_plaid_credential(&pool, credential_id).await.unwrap());

        let invalid = create_plaid_credential(&pool, create_input()).await.unwrap();
        sqlx::query("UPDATE plaid_credentials SET environment = 'invalid' WHERE id = ?")
            .bind(invalid.id)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            plaid_credentials(&pool).await.unwrap_err().to_string(),
            "parse persisted Plaid environment \"invalid\""
        );
    }
}
