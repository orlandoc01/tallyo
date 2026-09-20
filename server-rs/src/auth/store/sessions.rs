use anyhow::{Context, Result};
use chrono::Utc;

use crate::database::{Timestamp, queries};

use super::{
    ERR_ALREADY_USED, ERR_EXPIRED, ERR_INVALID_CODE, ERR_INVALID_TOKEN, ERR_TOO_MANY_ATTEMPTS, EmailOtpUpdate,
    LoginSession, Store,
};
use crate::auth::token_signature;

impl Store {
    pub async fn create_login_session(&self, session: &LoginSession) -> Result<()> {
        queries::create_login_session(
            &self.pool,
            queries::CreateLoginSessionParams {
                id: &session.id,
                client_id: &session.client_id,
                redirect_uri: &session.redirect_uri,
                state: Some(&session.state),
                code_challenge: &session.code_challenge,
                code_challenge_method: &session.code_challenge_method,
                scopes: Some(&session.scopes),
                callback_state: &session.callback_state,
                expires_at: session.expires_at,
                purpose: Some(&session.purpose),
            },
        )
        .await
        .context("create login session")
    }

    pub async fn login_session_by_id(&self, id: &str) -> Result<Option<LoginSession>> {
        self.login_session(queries::LoginSessionsParams {
            id: Some(id),
            ..Default::default()
        })
        .await
    }

    pub async fn login_session_by_callback_state(&self, callback_state: &str) -> Result<Option<LoginSession>> {
        self.login_session(queries::LoginSessionsParams {
            callback_state: Some(callback_state),
            ..Default::default()
        })
        .await
    }

    async fn login_session(&self, params: queries::LoginSessionsParams<'_>) -> Result<Option<LoginSession>> {
        Ok(queries::login_sessions(&self.pool, params).await?.into_iter().next())
    }

    pub async fn mark_login_session_authenticated(&self, id: &str, subject: &str) -> Result<()> {
        super::affected(
            queries::mark_login_session_authenticated(
                &self.pool,
                queries::MarkLoginSessionAuthenticatedParams {
                    subject: Some(subject),
                    id,
                    now: Utc::now().into(),
                },
            )
            .await?,
            "mark login session authenticated",
        )
    }

    pub async fn claim_authenticated_login_session(&self, id: &str) -> Result<bool> {
        Ok(queries::claim_authenticated_login_session(
            &self.pool,
            queries::ClaimAuthenticatedLoginSessionParams {
                id,
                now: Utc::now().into(),
            },
        )
        .await?
            == 1)
    }

    pub async fn delete_login_session(&self, id: &str) -> Result<()> {
        queries::delete_login_session(&self.pool, queries::DeleteLoginSessionParams { id })
            .await
            .context("delete login session")
    }

    pub async fn save_email_otp(&self, update: &EmailOtpUpdate) -> Result<()> {
        queries::save_email_otp(
            &self.pool,
            queries::SaveEmailOtpParams {
                email: Some(&update.email),
                email_otp: Some(&update.hashed_otp),
                email_otp_expires_at: Some(update.expires_at.into()),
                email_magic_token: Some(&update.hashed_magic_token),
                pkce_verifier: Some(&update.pkce_verifier),
                id: &update.session_id,
            },
        )
        .await
        .context("save email otp")
    }

    pub async fn verify_email_otp(&self, session_id: &str, email: &str, otp: &str) -> Result<LoginSession> {
        self.verify_email_secret(session_id, email, otp, true).await
    }

    pub async fn verify_email_magic_token(&self, session_id: &str, email: &str, token: &str) -> Result<LoginSession> {
        self.verify_email_secret(session_id, email, token, false).await
    }

    async fn verify_email_secret(
        &self,
        session_id: &str,
        email: &str,
        secret: &str,
        otp: bool,
    ) -> Result<LoginSession> {
        let session = self
            .login_session_by_id(session_id)
            .await?
            .context("login session not found")?;
        let stored = if otp {
            anyhow::ensure!(session.email_otp_attempts < 5, ERR_TOO_MANY_ATTEMPTS);
            anyhow::ensure!(
                !session.email_otp.is_empty()
                    && session
                        .email_otp_expires_at()
                        .is_some_and(|expires_at| expires_at > Utc::now()),
                ERR_EXPIRED
            );
            queries::increment_email_otp_attempts(
                &self.pool,
                queries::IncrementEmailOtpAttemptsParams { id: session_id },
            )
            .await?;
            &session.email_otp
        } else {
            anyhow::ensure!(!session.authenticated, ERR_ALREADY_USED);
            anyhow::ensure!(
                !session.email_magic_token.is_empty()
                    && session
                        .email_otp_expires_at()
                        .is_some_and(|expires_at| expires_at > Utc::now()),
                ERR_EXPIRED
            );
            &session.email_magic_token
        };
        let email_matches = subtle::ConstantTimeEq::ct_eq(session.email.as_bytes(), email.as_bytes()).into();
        let secret_matches =
            subtle::ConstantTimeEq::ct_eq(stored.as_bytes(), token_signature(secret).as_bytes()).into();
        anyhow::ensure!(
            email_matches && secret_matches,
            if otp { ERR_INVALID_CODE } else { ERR_INVALID_TOKEN }
        );
        self.mark_login_session_authenticated(session_id, &session.email)
            .await?;
        self.login_session_by_id(session_id)
            .await?
            .context("login session not found")
    }

    pub async fn cleanup_expired(&self) -> Result<()> {
        let now: Timestamp = Utc::now().into();
        queries::cleanup_expired_auth_codes(&self.pool, queries::CleanupExpiredAuthCodesParams { now }).await?;
        queries::cleanup_expired_access_tokens(&self.pool, queries::CleanupExpiredAccessTokensParams { now }).await?;
        queries::cleanup_expired_refresh_tokens(&self.pool, queries::CleanupExpiredRefreshTokensParams { now }).await?;
        queries::cleanup_expired_login_sessions(&self.pool, queries::CleanupExpiredLoginSessionsParams { now }).await?;
        queries::cleanup_expired_web_authn_registrations(
            &self.pool,
            queries::CleanupExpiredWebAuthnRegistrationsParams { now },
        )
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};
    use sqlx::query_scalar;

    use super::{
        ERR_ALREADY_USED, ERR_EXPIRED, ERR_INVALID_CODE, ERR_TOO_MANY_ATTEMPTS, EmailOtpUpdate, LoginSession, Store,
    };
    use crate::{
        auth::{AuthCode, OAuthToken, WebAuthnRegistration, token_signature},
        database::{dbtest, queries},
    };

    fn session() -> LoginSession {
        LoginSession {
            id: "session".to_owned(),
            client_id: "client".to_owned(),
            redirect_uri: "https://client.test/callback".to_owned(),
            state: String::new(),
            code_challenge: "challenge".to_owned(),
            code_challenge_method: "S256".to_owned(),
            scopes: "read".to_owned(),
            callback_state: "state".to_owned(),
            subject: String::new(),
            authenticated: false,
            expires_at: (Utc::now() + Duration::minutes(10)).into(),
            email: String::new(),
            email_otp: String::new(),
            email_otp_expires_at: None,
            email_otp_attempts: 0,
            email_magic_token: String::new(),
            pkce_verifier: String::new(),
            webauthn_session: String::new(),
            purpose: String::new(),
        }
    }

    async fn store_with_secret(expires_at: chrono::DateTime<Utc>) -> Store {
        let store = Store::new(dbtest::open().await.unwrap());
        store.create_login_session(&session()).await.unwrap();
        store
            .save_email_otp(&EmailOtpUpdate {
                session_id: "session".to_owned(),
                email: "person@example.com".to_owned(),
                hashed_otp: token_signature("123456"),
                hashed_magic_token: token_signature("magic"),
                pkce_verifier: String::new(),
                expires_at,
            })
            .await
            .unwrap();
        store
    }

    #[tokio::test]
    async fn round_trips_generated_login_session() {
        let store = Store::new(dbtest::open().await.unwrap());
        let expires_at = "2026-09-06T12:00:00Z".parse::<chrono::DateTime<Utc>>().unwrap();
        let original = LoginSession {
            scopes: "read write".to_owned(),
            expires_at: expires_at.into(),
            ..session()
        };
        store.create_login_session(&original).await.unwrap();
        let loaded = store.login_session_by_id(&original.id).await.unwrap().unwrap();
        assert_eq!(loaded, original);
        assert_eq!(loaded.expires_at(), expires_at);
        assert_eq!(loaded.email_otp_expires_at(), None);

        store
            .save_email_otp(&EmailOtpUpdate {
                session_id: original.id.clone(),
                email: "person@example.com".to_owned(),
                hashed_otp: token_signature("123456"),
                hashed_magic_token: token_signature("magic"),
                pkce_verifier: "verifier".to_owned(),
                expires_at,
            })
            .await
            .unwrap();
        let loaded = store
            .login_session_by_callback_state(&original.callback_state)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded.scopes, original.scopes);
        assert_eq!(loaded.email_otp_expires_at(), Some(expires_at));
    }

    #[tokio::test]
    async fn verifies_email_secrets_with_go_compatible_ordering() {
        let store = store_with_secret(Utc::now() + Duration::minutes(10)).await;
        assert_eq!(
            store
                .verify_email_otp("session", "person@example.com", "wrong")
                .await
                .unwrap_err()
                .to_string(),
            ERR_INVALID_CODE
        );
        for _ in 0..4 {
            assert_eq!(
                store
                    .verify_email_otp("session", "person@example.com", "wrong")
                    .await
                    .unwrap_err()
                    .to_string(),
                ERR_INVALID_CODE
            );
        }
        assert_eq!(
            store
                .verify_email_otp("session", "person@example.com", "wrong")
                .await
                .unwrap_err()
                .to_string(),
            ERR_TOO_MANY_ATTEMPTS
        );

        let expired = store_with_secret(Utc::now() - Duration::seconds(1)).await;
        assert_eq!(
            expired
                .verify_email_otp("session", "person@example.com", "123456")
                .await
                .unwrap_err()
                .to_string(),
            ERR_EXPIRED
        );
        assert!(
            store
                .verify_email_magic_token("session", "person@example.com", "magic")
                .await
                .is_ok()
        );
        assert_eq!(
            store
                .verify_email_magic_token("session", "person@example.com", "magic")
                .await
                .unwrap_err()
                .to_string(),
            ERR_ALREADY_USED
        );
        assert_eq!(
            expired
                .verify_email_magic_token("session", "person@example.com", "magic")
                .await
                .unwrap_err()
                .to_string(),
            ERR_EXPIRED
        );
    }

    #[tokio::test]
    async fn cleans_only_expired_auth_records() {
        let pool = dbtest::open().await.unwrap();
        let store = Store::new(pool.clone());
        let now = Utc::now();
        store
            .upsert_frontend_client(&["https://client.test/callback".to_owned()])
            .await
            .unwrap();
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
        for (name, expires_at) in [
            ("expired", now - Duration::seconds(1)),
            ("live", now + Duration::minutes(1)),
        ] {
            let auth = AuthCode {
                client_id: "tallyo-web".to_owned(),
                subject: "person@example.com".to_owned(),
                scopes: "read".to_owned(),
                redirect_uri: "https://client.test/callback".to_owned(),
                code_challenge: String::new(),
                code_challenge_method: String::new(),
                expires_at: expires_at.into(),
                active: true,
            };
            store.create_auth_code(&format!("code-{name}"), &auth).await.unwrap();
            let token = OAuthToken {
                signature: format!("access-{name}"),
                client_id: "tallyo-web".to_owned(),
                subject: "person@example.com".to_owned(),
                scopes: vec!["read".to_owned()],
                expires_at,
                request_id: String::new(),
                active: true,
            };
            store.create_access_token(&token).await.unwrap();
            store
                .create_refresh_token(&OAuthToken {
                    signature: format!("refresh-{name}"),
                    ..token
                })
                .await
                .unwrap();
            let login = LoginSession {
                id: format!("session-{name}"),
                callback_state: format!("callback-{name}"),
                expires_at: expires_at.into(),
                ..session()
            };
            store.create_login_session(&login).await.unwrap();
        }
        let live_user = queries::insert_user(
            &pool,
            queries::InsertUserParams {
                email: "live@example.com",
                role: "admin",
                invited_by: None,
            },
        )
        .await
        .unwrap();
        for (name, expires_at) in [
            ("expired", now - Duration::seconds(1)),
            ("live", now + Duration::minutes(1)),
        ] {
            store
                .save_webauthn_registration(&WebAuthnRegistration {
                    user_id: if name == "expired" { user.id } else { live_user.id },
                    name: name.to_owned(),
                    session: "{}".to_owned(),
                    expires_at: expires_at.into(),
                })
                .await
                .unwrap();
        }
        store.cleanup_expired().await.unwrap();
        for table in [
            "oauth_authorization_codes",
            "oauth_access_tokens",
            "oauth_refresh_tokens",
            "login_sessions",
            "webauthn_registrations",
        ] {
            assert_eq!(
                query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {table}"))
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                1
            );
        }
    }
}
