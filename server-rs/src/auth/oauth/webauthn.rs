use std::{future::Future, pin::Pin, sync::Arc};

use axum::{
    Extension, Json, Router,
    extract::{Path, Query, Request, State},
    http::StatusCode,
    middleware,
    response::{IntoResponse, Response},
    routing::{get, patch, post},
};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use webauthn_rs_core::proto::PublicKeyCredential;

use super::{MAX_AUTH_REQUEST_BODY, json_response};
use crate::auth::{
    Identity, Service, WebAuthnCredential,
    middleware::{protect, require_oauth},
    webauthn::WebAuthnError,
};

pub(super) fn routes<F>(service: Arc<Service>, limiter: F) -> Router<Arc<Service>>
where
    F: Fn(Request, middleware::Next) -> Pin<Box<dyn Future<Output = Response> + Send>> + Clone + Send + Sync + 'static,
{
    Router::new()
        .merge(
            Router::new()
                .route("/auth/webauthn/register/begin", post(register_begin))
                .route("/auth/webauthn/register/finish", post(register_finish))
                .route("/auth/webauthn/credentials", get(credentials))
                .route(
                    "/auth/webauthn/credentials/{id}",
                    patch(rename_credential).delete(delete_credential),
                )
                .route_layer(axum::extract::DefaultBodyLimit::max(MAX_AUTH_REQUEST_BODY))
                .route_layer(middleware::from_fn_with_state(Arc::clone(&service), protect)),
        )
        .merge(
            Router::new()
                .route("/auth/webauthn/login/begin", post(login_begin))
                .route("/auth/webauthn/login/finish", post(login_finish))
                .route_layer(middleware::from_fn(limiter))
                .route_layer(axum::extract::DefaultBodyLimit::max(MAX_AUTH_REQUEST_BODY))
                .route_layer(middleware::from_fn_with_state(service, require_oauth)),
        )
}

#[derive(Deserialize)]
struct RegisterBeginRequest {
    name: String,
    #[serde(default)]
    email: String,
}

#[derive(Deserialize)]
struct RegisterFinishQuery {
    #[serde(default)]
    email: String,
}

#[derive(Deserialize)]
struct CredentialNameRequest {
    name: String,
}

#[derive(Deserialize)]
struct LoginBeginRequest {
    login_session_id: String,
}

#[derive(Deserialize)]
struct LoginFinishRequest {
    login_session_id: String,
    assertion: PublicKeyCredential,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CredentialResponse {
    id: String,
    name: String,
    created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_used_at: Option<String>,
}

async fn register_begin(
    State(service): State<Arc<Service>>,
    identity: Option<Extension<Identity>>,
    request: Result<Json<RegisterBeginRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Some(response) = webauthn_or_404(&service) {
        return response;
    }
    let request = match request {
        Ok(Json(request)) if !request.name.trim().is_empty() => request,
        _ => return (StatusCode::BAD_REQUEST, "invalid registration").into_response(),
    };
    let user_id = match request_user_id(&service, identity, &request.email).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    match crate::auth::webauthn::begin_registration(&service, user_id, request.name.trim().to_owned()).await {
        Ok(options) => json_response(StatusCode::OK, options),
        Err(error) => {
            tracing::error!(?error, "begin webauthn registration");
            (StatusCode::INTERNAL_SERVER_ERROR, "begin webauthn registration").into_response()
        }
    }
}

async fn register_finish(
    State(service): State<Arc<Service>>,
    identity: Option<Extension<Identity>>,
    Query(query): Query<RegisterFinishQuery>,
    request: Result<Json<crate::auth::webauthn::RegistrationResponse>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Some(response) = webauthn_or_404(&service) {
        return response;
    }
    let user_id = match request_user_id(&service, identity, &query.email).await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    let request = match request {
        Ok(Json(request)) => request,
        Err(_) => return (StatusCode::BAD_REQUEST, "finish webauthn registration").into_response(),
    };
    match crate::auth::webauthn::finish_registration(&service, user_id, request).await {
        Ok(credential) => json_response(StatusCode::CREATED, CredentialResponse::from(credential)),
        Err(WebAuthnError::Expired) => (StatusCode::BAD_REQUEST, "registration session expired").into_response(),
        Err(WebAuthnError::Rejected(error)) => {
            tracing::warn!(%error, "finish webauthn registration");
            (StatusCode::BAD_REQUEST, "finish webauthn registration").into_response()
        }
        Err(WebAuthnError::Internal(error)) => {
            tracing::error!(%error, "finish webauthn registration");
            (StatusCode::INTERNAL_SERVER_ERROR, "finish webauthn registration").into_response()
        }
    }
}

async fn credentials(State(service): State<Arc<Service>>, identity: Option<Extension<Identity>>) -> Response {
    if let Some(response) = webauthn_or_404(&service) {
        return response;
    }
    let user_id = match request_user_id(&service, identity, "").await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    match service.store().webauthn_credentials_by_user_id(user_id).await {
        Ok(credentials) => json_response(
            StatusCode::OK,
            credentials
                .into_iter()
                .map(CredentialResponse::from)
                .collect::<Vec<_>>(),
        ),
        Err(error) => {
            tracing::error!(%error, "list webauthn credentials");
            (StatusCode::INTERNAL_SERVER_ERROR, "list webauthn credentials").into_response()
        }
    }
}

async fn rename_credential(
    State(service): State<Arc<Service>>,
    identity: Option<Extension<Identity>>,
    Path(id): Path<String>,
    request: Result<Json<CredentialNameRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Some(response) = webauthn_or_404(&service) {
        return response;
    }
    let user_id = match request_user_id(&service, identity, "").await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    let name = match request {
        Ok(Json(request)) if !request.name.trim().is_empty() => request.name.trim().to_owned(),
        _ => return (StatusCode::BAD_REQUEST, "invalid credential").into_response(),
    };
    match service.store().rename_webauthn_credential(&id, user_id, &name).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (StatusCode::NOT_FOUND, "credential not found").into_response(),
        Err(error) => {
            tracing::error!(%error, "rename webauthn credential");
            (StatusCode::INTERNAL_SERVER_ERROR, "update credential").into_response()
        }
    }
}

async fn delete_credential(
    State(service): State<Arc<Service>>,
    identity: Option<Extension<Identity>>,
    Path(id): Path<String>,
) -> Response {
    if let Some(response) = webauthn_or_404(&service) {
        return response;
    }
    let user_id = match request_user_id(&service, identity, "").await {
        Ok(user_id) => user_id,
        Err(response) => return response,
    };
    match service.store().delete_webauthn_credential(&id, user_id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (StatusCode::NOT_FOUND, "credential not found").into_response(),
        Err(error) => {
            tracing::error!(%error, "delete webauthn credential");
            (StatusCode::INTERNAL_SERVER_ERROR, "update credential").into_response()
        }
    }
}

async fn login_begin(
    State(service): State<Arc<Service>>,
    request: Result<Json<LoginBeginRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Some(response) = webauthn_or_404(&service) {
        return response;
    }
    let request = match request {
        Ok(Json(request)) if !request.login_session_id.is_empty() => request,
        _ => return (StatusCode::BAD_REQUEST, "login session not found or expired").into_response(),
    };
    match crate::auth::webauthn::begin_login(&service, &request.login_session_id).await {
        Ok(options) => json_response(StatusCode::OK, options),
        Err(WebAuthnError::Expired) => (StatusCode::BAD_REQUEST, "login session not found or expired").into_response(),
        Err(WebAuthnError::Rejected(error)) => {
            tracing::warn!(%error, "begin webauthn login");
            (StatusCode::BAD_REQUEST, "begin webauthn login").into_response()
        }
        Err(WebAuthnError::Internal(error)) => {
            tracing::error!(%error, "begin webauthn login");
            (StatusCode::INTERNAL_SERVER_ERROR, "begin webauthn login").into_response()
        }
    }
}

async fn login_finish(
    State(service): State<Arc<Service>>,
    request: Result<Json<LoginFinishRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Some(response) = webauthn_or_404(&service) {
        return response;
    }
    let request = match request {
        Ok(Json(request)) if !request.login_session_id.is_empty() => request,
        _ => return (StatusCode::BAD_REQUEST, "login session not found or expired").into_response(),
    };
    match crate::auth::webauthn::finish_login(&service, &request.login_session_id, request.assertion).await {
        Ok(redirect_url) => json_response(StatusCode::OK, serde_json::json!({"redirect_url": redirect_url})),
        Err(WebAuthnError::Expired) => (StatusCode::BAD_REQUEST, "login session not found or expired").into_response(),
        Err(WebAuthnError::Rejected(error)) => {
            tracing::warn!(%error, "finish webauthn login");
            (StatusCode::BAD_REQUEST, "finish webauthn login").into_response()
        }
        Err(WebAuthnError::Internal(error)) => {
            tracing::error!(%error, "finish webauthn login");
            (StatusCode::INTERNAL_SERVER_ERROR, "finish webauthn login").into_response()
        }
    }
}

fn webauthn_or_404(service: &Service) -> Option<Response> {
    (!service.passkey_enabled()).then(|| (StatusCode::NOT_FOUND, "webauthn is not enabled").into_response())
}

fn request_subject(service: &Service, identity: Option<Extension<Identity>>, fallback: &str) -> Option<String> {
    match identity
        .and_then(|Extension(identity)| identity.subject)
        .filter(|subject| !subject.is_empty())
    {
        Some(subject) => Some(subject),
        None if !service.setup_complete() && !fallback.trim().is_empty() => Some(fallback.trim().to_owned()),
        None => None,
    }
}

async fn request_user_id(
    service: &Service,
    identity: Option<Extension<Identity>>,
    fallback: &str,
) -> Result<i64, Response> {
    let Some(email) = request_subject(service, identity, fallback) else {
        return Err((StatusCode::UNAUTHORIZED, "authenticated user required").into_response());
    };
    service
        .store()
        .user_id_by_email(&email)
        .await
        .map_err(|error| {
            tracing::error!(%error, "lookup authenticated user");
            (StatusCode::INTERNAL_SERVER_ERROR, "lookup authenticated user").into_response()
        })?
        .ok_or_else(|| (StatusCode::INTERNAL_SERVER_ERROR, "lookup authenticated user").into_response())
}

impl From<WebAuthnCredential> for CredentialResponse {
    fn from(credential: WebAuthnCredential) -> Self {
        Self {
            id: credential.id,
            name: credential.name,
            created_at: DateTime::<Utc>::from(credential.created_at).to_rfc3339_opts(SecondsFormat::Secs, true),
            last_used_at: credential
                .last_used_at
                .map(DateTime::<Utc>::from)
                .map(|value| value.to_rfc3339_opts(SecondsFormat::Secs, true)),
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::{DateTime, Utc};

    use super::*;
    use crate::{
        auth::{AuthSettings, Config},
        database::dbtest,
        middleware::client_ip::ClientIpResolver,
    };

    async fn service(setup_complete: bool) -> Service {
        Service::new(
            Config {
                setup_complete,
                ..Config::new(
                    AuthSettings {
                        issuer_url: "https://tallyo.test".to_owned(),
                        oauth_enabled: true,
                        frontend_redirect_uris: vec!["https://web.test/callback".to_owned()],
                        ..Default::default()
                    },
                    ClientIpResolver::new(&[]).unwrap(),
                )
            },
            dbtest::open().await.unwrap(),
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn request_subject_prefers_identity_and_only_falls_back_during_setup() {
        let service = service(false).await;
        let mut identity = Identity::with_scopes(Vec::new());
        identity.subject = Some("identity@example.com".to_owned());
        assert_eq!(
            request_subject(&service, Some(Extension(identity)), "fallback@example.com"),
            Some("identity@example.com".to_owned())
        );
        assert_eq!(
            request_subject(&service, None, " fallback@example.com "),
            Some("fallback@example.com".to_owned())
        );
        assert_eq!(request_subject(&service, None, " "), None);

        service.update_setup_complete(true);
        assert_eq!(request_subject(&service, None, "fallback@example.com"), None);
    }

    #[test]
    fn credential_response_serializes_required_and_optional_timestamps() {
        let created_at = "2026-09-06T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let last_used_at = "2026-09-06T13:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let credential = WebAuthnCredential {
            id: "credential".to_owned(),
            user_id: 1,
            name: "Laptop".to_owned(),
            credential: "{}".to_owned(),
            created_at: created_at.into(),
            last_used_at: Some(last_used_at.into()),
        };
        let response = serde_json::to_value(CredentialResponse::from(credential.clone())).unwrap();
        assert_eq!(response["id"], "credential");
        assert_eq!(response["name"], "Laptop");
        assert_eq!(response["createdAt"], "2026-09-06T12:00:00Z");
        assert_eq!(response["lastUsedAt"], "2026-09-06T13:00:00Z");

        let response = serde_json::to_value(CredentialResponse::from(WebAuthnCredential {
            last_used_at: None,
            ..credential
        }))
        .unwrap();
        assert!(response.get("lastUsedAt").is_none());
    }
}
