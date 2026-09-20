use anyhow::{Context, Result};
use chrono::{DateTime, Utc};

use crate::database::{queries, with_tx};

use super::{Store, WebAuthnCredential, WebAuthnRegistration, affected};

impl Store {
    pub async fn consume_webauthn_registration(&self, credential: &WebAuthnCredential) -> Result<()> {
        let credential = credential.clone();
        with_tx(&self.pool, |transaction| {
            Box::pin(async move {
                queries::create_web_authn_credential(
                    &mut **transaction,
                    queries::CreateWebAuthnCredentialParams {
                        id: &credential.id,
                        user_id: credential.user_id,
                        name: &credential.name,
                        credential: &credential.credential,
                    },
                )
                .await?;
                affected(
                    queries::delete_web_authn_registration(
                        &mut **transaction,
                        queries::DeleteWebAuthnRegistrationParams {
                            user_id: credential.user_id,
                        },
                    )
                    .await?,
                    "delete webauthn registration",
                )
            })
        })
        .await
    }

    pub async fn create_webauthn_credential(&self, credential: &WebAuthnCredential) -> Result<()> {
        queries::create_web_authn_credential(
            &self.pool,
            queries::CreateWebAuthnCredentialParams {
                id: &credential.id,
                user_id: credential.user_id,
                name: &credential.name,
                credential: &credential.credential,
            },
        )
        .await
        .context("create webauthn credential")
    }

    pub async fn webauthn_credentials_by_user_id(&self, user_id: i64) -> Result<Vec<WebAuthnCredential>> {
        queries::web_authn_credentials_by_user_id(&self.pool, queries::WebAuthnCredentialsByUserIdParams { user_id })
            .await
            .context("load webauthn credentials")
    }

    pub async fn update_webauthn_credential(
        &self,
        id: &str,
        credential_json: &str,
        last_used_at: DateTime<Utc>,
    ) -> Result<()> {
        queries::update_web_authn_credential(
            &self.pool,
            queries::UpdateWebAuthnCredentialParams {
                credential: credential_json,
                last_used_at: Some(last_used_at.into()),
                id,
            },
        )
        .await
        .context("update webauthn credential")
    }

    pub async fn save_login_session_webauthn(&self, id: &str, session: &str) -> Result<()> {
        queries::save_login_session_web_authn(
            &self.pool,
            queries::SaveLoginSessionWebAuthnParams {
                webauthn_session: Some(session),
                id,
            },
        )
        .await
        .context("save webauthn login")
    }

    pub async fn rename_webauthn_credential(&self, id: &str, user_id: i64, name: &str) -> Result<bool> {
        Ok(queries::rename_web_authn_credential(
            &self.pool,
            queries::RenameWebAuthnCredentialParams { name, id, user_id },
        )
        .await?
            == 1)
    }

    pub async fn delete_webauthn_credential(&self, id: &str, user_id: i64) -> Result<bool> {
        Ok(
            queries::delete_web_authn_credential(&self.pool, queries::DeleteWebAuthnCredentialParams { id, user_id })
                .await?
                == 1,
        )
    }

    pub async fn save_webauthn_registration(&self, registration: &WebAuthnRegistration) -> Result<()> {
        queries::save_web_authn_registration(
            &self.pool,
            queries::SaveWebAuthnRegistrationParams {
                user_id: registration.user_id,
                name: &registration.name,
                session: &registration.session,
                expires_at: registration.expires_at,
            },
        )
        .await
        .context("save webauthn registration")
    }

    pub async fn webauthn_registration(&self, user_id: i64) -> Result<Option<WebAuthnRegistration>> {
        queries::web_authn_registration_opt(&self.pool, queries::WebAuthnRegistrationParams { user_id })
            .await
            .context("load webauthn registration")
    }

    pub async fn delete_webauthn_registration(&self, user_id: i64) -> Result<()> {
        affected(
            queries::delete_web_authn_registration(&self.pool, queries::DeleteWebAuthnRegistrationParams { user_id })
                .await?,
            "delete webauthn registration",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::dbtest;

    #[tokio::test]
    async fn round_trips_generated_webauthn_models() {
        let pool = dbtest::open().await.unwrap();
        let user = queries::insert_user(
            &pool,
            queries::InsertUserParams {
                email: "person@example.com",
                role: "admin",
                invited_by: None,
            },
        )
        .await
        .unwrap();
        let store = Store::new(pool);
        let now = "2026-09-06T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let registration = WebAuthnRegistration {
            user_id: user.id,
            name: "Passkey".to_owned(),
            session: "{\"challenge\":\"test\"}".to_owned(),
            expires_at: now.into(),
        };
        store.save_webauthn_registration(&registration).await.unwrap();
        assert_eq!(
            store.webauthn_registration(user.id).await.unwrap().unwrap(),
            registration
        );

        let credential = WebAuthnCredential {
            id: "credential".to_owned(),
            user_id: user.id,
            name: registration.name,
            credential: "{\"ID\":\"test\"}".to_owned(),
            created_at: now.into(),
            last_used_at: None,
        };
        store.consume_webauthn_registration(&credential).await.unwrap();
        assert!(store.webauthn_registration(user.id).await.unwrap().is_none());
        let loaded = store.webauthn_credentials_by_user_id(user.id).await.unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, credential.id);
        assert_eq!(loaded[0].name, credential.name);
        assert_eq!(loaded[0].user_id, credential.user_id);
        assert_eq!(loaded[0].credential, credential.credential);
        assert_eq!(loaded[0].last_used_at, None);

        store
            .update_webauthn_credential(&credential.id, "{\"ID\":\"updated\"}", now)
            .await
            .unwrap();
        let updated = store.webauthn_credentials_by_user_id(user.id).await.unwrap();
        assert_eq!(updated[0].created_at, loaded[0].created_at);
        assert_eq!(updated[0].credential, "{\"ID\":\"updated\"}");
        assert_eq!(updated[0].last_used_at, Some(now.into()));
    }
}
