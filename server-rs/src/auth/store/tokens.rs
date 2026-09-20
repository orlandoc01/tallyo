use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sqlx::{Sqlite, Transaction};

use crate::database::{queries, with_tx};

use super::{AuthCode, OAuthToken, Store, affected, split_scopes};
use crate::auth::token_signature;

impl Store {
    pub async fn create_auth_code(&self, code: &str, auth: &AuthCode) -> Result<()> {
        queries::create_auth_code(
            &self.pool,
            queries::CreateAuthCodeParams {
                signature: &token_signature(code),
                client_id: &auth.client_id,
                subject: &auth.subject,
                scopes: Some(&auth.scopes),
                redirect_uri: &auth.redirect_uri,
                code_challenge: &auth.code_challenge,
                code_challenge_method: &auth.code_challenge_method,
                expires_at: auth.expires_at,
            },
        )
        .await
        .context("create authorization code")
    }

    pub async fn auth_code(&self, code: &str, now: DateTime<Utc>, active_only: bool) -> Result<Option<AuthCode>> {
        queries::auth_code_opt(
            &self.pool,
            queries::AuthCodeParams {
                signature: &token_signature(code),
                now: now.into(),
                active_only,
            },
        )
        .await
        .context("load authorization code")
    }

    pub async fn invalidate_auth_code(&self, code: &str) -> Result<bool> {
        Ok(queries::invalidate_auth_code(
            &self.pool,
            queries::InvalidateAuthCodeParams {
                signature: &token_signature(code),
            },
        )
        .await?
            == 1)
    }

    pub async fn exchange_auth_code(&self, code: &str, access: OAuthToken, refresh: OAuthToken) -> Result<bool> {
        let signature = token_signature(code);
        with_tx(&self.pool, |transaction| {
            Box::pin(async move {
                let invalidated = queries::invalidate_auth_code(
                    &mut **transaction,
                    queries::InvalidateAuthCodeParams { signature: &signature },
                )
                .await?;
                if invalidated != 1 {
                    return Ok(false);
                }

                insert_token_pair(transaction, &access, &refresh).await?;
                Ok(true)
            })
        })
        .await
    }

    pub async fn update_auth_code_pkce(&self, code: &str, challenge: &str, method: &str) -> Result<()> {
        queries::update_auth_code_pkce(
            &self.pool,
            queries::UpdateAuthCodePkceParams {
                code_challenge: challenge,
                code_challenge_method: method,
                signature: &token_signature(code),
            },
        )
        .await
        .context("update pkce request session")
    }

    pub async fn create_access_token(&self, token: &OAuthToken) -> Result<()> {
        let scopes = token.scopes.join(" ");
        queries::create_access_token(
            &self.pool,
            queries::CreateAccessTokenParams {
                signature: &token.signature,
                client_id: &token.client_id,
                subject: &token.subject,
                scopes: Some(&scopes),
                expires_at: token.expires_at.into(),
                request_id: (!token.request_id.is_empty()).then_some(token.request_id.as_str()),
            },
        )
        .await
        .context("create access token")
    }

    pub async fn access_token(&self, signature: &str, now: DateTime<Utc>) -> Result<Option<OAuthToken>> {
        let row = queries::access_token_opt(
            &self.pool,
            queries::AccessTokenParams {
                signature,
                now: now.into(),
            },
        )
        .await?;
        Ok(row.map(|row| OAuthToken::from((signature.to_owned(), row))))
    }

    pub async fn delete_access_token(&self, signature: &str) -> Result<()> {
        queries::delete_access_token(&self.pool, queries::DeleteAccessTokenParams { signature })
            .await
            .context("delete access token")
    }

    pub async fn delete_access_tokens_by_request_id(&self, request_id: &str) -> Result<()> {
        queries::delete_access_tokens_by_request_id(
            &self.pool,
            queries::DeleteAccessTokensByRequestIdParams {
                request_id: Some(request_id),
            },
        )
        .await
        .context("delete access tokens by request ID")
    }

    pub async fn create_refresh_token(&self, token: &OAuthToken) -> Result<()> {
        let scopes = token.scopes.join(" ");
        queries::create_refresh_token(
            &self.pool,
            queries::CreateRefreshTokenParams {
                signature: &token.signature,
                client_id: &token.client_id,
                subject: &token.subject,
                scopes: Some(&scopes),
                expires_at: token.expires_at.into(),
                request_id: (!token.request_id.is_empty()).then_some(token.request_id.as_str()),
            },
        )
        .await
        .context("create refresh token")
    }

    pub async fn refresh_token(
        &self,
        signature: &str,
        now: DateTime<Utc>,
        active_only: bool,
    ) -> Result<Option<OAuthToken>> {
        let row = queries::refresh_token_opt(
            &self.pool,
            queries::RefreshTokenParams {
                signature,
                now: now.into(),
                active_only,
            },
        )
        .await?;
        Ok(row.map(|row| OAuthToken::from((signature.to_owned(), row))))
    }

    pub async fn revoke_refresh_token(&self, signature: &str) -> Result<()> {
        queries::revoke_refresh_token(&self.pool, queries::RevokeRefreshTokenParams { signature })
            .await
            .context("revoke refresh token")
    }

    pub async fn revoke_refresh_tokens_by_request_id(&self, request_id: &str) -> Result<()> {
        queries::revoke_refresh_tokens_by_request_id(
            &self.pool,
            queries::RevokeRefreshTokensByRequestIdParams {
                request_id: Some(request_id),
            },
        )
        .await
        .context("revoke refresh tokens by request ID")
    }

    pub async fn revoke_live_refresh_token(&self, signature: &str, now: DateTime<Utc>) -> Result<()> {
        affected(
            queries::revoke_live_refresh_token(
                &self.pool,
                queries::RevokeLiveRefreshTokenParams {
                    signature,
                    now: now.into(),
                },
            )
            .await?,
            "revoke live refresh token",
        )
    }

    pub async fn revoke_token_chain(&self, request_id: &str) -> Result<()> {
        self.delete_access_tokens_by_request_id(request_id).await?;
        self.revoke_refresh_tokens_by_request_id(request_id).await
    }

    pub async fn rotate_refresh_token(
        &self,
        old_signature: String,
        now: DateTime<Utc>,
        access: OAuthToken,
        refresh: OAuthToken,
    ) -> Result<bool> {
        with_tx(&self.pool, |transaction| {
            Box::pin(async move {
                let revoked = queries::revoke_live_refresh_token(
                    &mut **transaction,
                    queries::RevokeLiveRefreshTokenParams {
                        signature: &old_signature,
                        now: now.into(),
                    },
                )
                .await?;
                if revoked != 1 {
                    return Ok(false);
                }

                queries::delete_access_tokens_by_request_id(
                    &mut **transaction,
                    queries::DeleteAccessTokensByRequestIdParams {
                        request_id: Some(&refresh.request_id),
                    },
                )
                .await?;
                insert_token_pair(transaction, &access, &refresh).await?;
                Ok(true)
            })
        })
        .await
    }
}

async fn insert_token_pair(
    transaction: &mut Transaction<'_, Sqlite>,
    access: &OAuthToken,
    refresh: &OAuthToken,
) -> Result<()> {
    let access_scopes = access.scopes.join(" ");
    queries::create_access_token(
        &mut **transaction,
        queries::CreateAccessTokenParams {
            signature: &access.signature,
            client_id: &access.client_id,
            subject: &access.subject,
            scopes: Some(&access_scopes),
            expires_at: access.expires_at.into(),
            request_id: Some(&access.request_id),
        },
    )
    .await?;
    let refresh_scopes = refresh.scopes.join(" ");
    queries::create_refresh_token(
        &mut **transaction,
        queries::CreateRefreshTokenParams {
            signature: &refresh.signature,
            client_id: &refresh.client_id,
            subject: &refresh.subject,
            scopes: Some(&refresh_scopes),
            expires_at: refresh.expires_at.into(),
            request_id: Some(&refresh.request_id),
        },
    )
    .await?;
    Ok(())
}

impl From<(String, queries::AccessTokenRow)> for OAuthToken {
    fn from((signature, row): (String, queries::AccessTokenRow)) -> Self {
        Self {
            signature,
            client_id: row.client_id,
            subject: row.subject,
            scopes: split_scopes(&row.scopes),
            expires_at: row.expires_at.into(),
            request_id: row.request_id,
            active: row.active,
        }
    }
}

impl From<(String, queries::RefreshTokenRow)> for OAuthToken {
    fn from((signature, row): (String, queries::RefreshTokenRow)) -> Self {
        Self {
            signature,
            client_id: row.client_id,
            subject: row.subject,
            scopes: split_scopes(&row.scopes),
            expires_at: row.expires_at.into(),
            request_id: row.request_id,
            active: row.active,
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};

    use super::*;
    use crate::{
        auth::{AuthCode, OAuthToken},
        database::dbtest,
    };

    #[tokio::test]
    async fn persists_oauth_tokens() {
        let store = Store::new(dbtest::open().await.unwrap());
        let now = "2026-09-06T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
        store
            .upsert_frontend_client(&["https://client.test/callback".to_owned()])
            .await
            .unwrap();
        let code = AuthCode {
            client_id: "tallyo-web".to_owned(),
            subject: "person@example.com".to_owned(),
            scopes: "read:accounts write:accounts".to_owned(),
            redirect_uri: "https://client.test/callback".to_owned(),
            code_challenge: "challenge".to_owned(),
            code_challenge_method: "S256".to_owned(),
            expires_at: (now + Duration::minutes(10)).into(),
            active: true,
        };
        store.create_auth_code("code", &code).await.unwrap();
        assert_eq!(store.auth_code("code", now, true).await.unwrap().unwrap(), code);
        store.update_auth_code_pkce("code", "next", "S256").await.unwrap();
        store.invalidate_auth_code("code").await.unwrap();
        assert!(!store.auth_code("code", now, false).await.unwrap().unwrap().active);

        let token = OAuthToken {
            signature: "access-signature".to_owned(),
            client_id: "tallyo-web".to_owned(),
            subject: "person@example.com".to_owned(),
            scopes: vec!["read:accounts".to_owned()],
            expires_at: now + Duration::minutes(10),
            request_id: "code".to_owned(),
            active: true,
        };
        store.create_access_token(&token).await.unwrap();
        assert_eq!(store.access_token(&token.signature, now).await.unwrap().unwrap(), token);
        store.delete_access_tokens_by_request_id("code").await.unwrap();
        assert!(store.access_token(&token.signature, now).await.unwrap().is_none());
        let refresh = OAuthToken {
            signature: "refresh-signature".to_owned(),
            ..token
        };
        store.create_refresh_token(&refresh).await.unwrap();
        assert_eq!(
            store
                .refresh_token(&refresh.signature, now, true)
                .await
                .unwrap()
                .unwrap(),
            refresh
        );
        store.revoke_live_refresh_token(&refresh.signature, now).await.unwrap();
        assert!(
            !store
                .refresh_token(&refresh.signature, now, false)
                .await
                .unwrap()
                .unwrap()
                .active
        );
        store.revoke_refresh_tokens_by_request_id("code").await.unwrap();
    }
}
