use std::{str::FromStr, sync::Arc};

use axum::{
    extract::{Form, State},
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use chrono::Utc;
use serde::{Deserialize, Serialize};

use super::oauth_error;
use crate::auth::{OAuthToken, Scope, Service, code_challenge, random_token, token_signature};

const INVALID_CLIENT: &str = "Client authentication failed (e.g., unknown client, no client authentication included, or unsupported authentication method).";
const INVALID_GRANT: &str = "The provided authorization grant is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client.";
const INVALID_REQUEST: &str = "The request is missing a required parameter, includes an invalid parameter value, includes a parameter more than once, or is otherwise malformed.";
const UNSUPPORTED_GRANT_TYPE: &str = "The authorization grant type is not supported by the authorization server.";
const UNAUTHORIZED_CLIENT: &str = "The client is not authorized to request this authorization grant type.";

#[derive(Deserialize)]
pub(super) struct TokenRequest {
    grant_type: String,
    client_id: Option<String>,
    code: Option<String>,
    code_verifier: Option<String>,
    redirect_uri: Option<String>,
    refresh_token: Option<String>,
}

#[derive(Serialize)]
struct TokenResponse {
    access_token: String,
    token_type: &'static str,
    expires_in: u64,
    refresh_token: String,
    scope: String,
}

pub(super) async fn exchange(
    State(service): State<Arc<Service>>,
    request: Result<Form<TokenRequest>, axum::extract::rejection::FormRejection>,
) -> Response {
    let request = match request {
        Ok(Form(request)) => request,
        Err(_) => return token_response(oauth_error(StatusCode::BAD_REQUEST, "invalid_request", INVALID_REQUEST)),
    };
    let _token_lock = service.token_lock().await;
    token_response(match request.grant_type.as_str() {
        "authorization_code" => exchange_authorization_code(&service, request).await,
        "refresh_token" => exchange_refresh_token(&service, request).await,
        _ => oauth_error(
            StatusCode::BAD_REQUEST,
            "unsupported_grant_type",
            UNSUPPORTED_GRANT_TYPE,
        ),
    })
}

async fn exchange_authorization_code(service: &Service, request: TokenRequest) -> Response {
    let client_id = match request.client_id.filter(|id| !id.is_empty()) {
        Some(client_id) => client_id,
        None => return invalid_client(),
    };
    let client = match service.store().client(&client_id).await {
        Ok(Some(client)) => client,
        Ok(None) => return invalid_client(),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "load client").into_response(),
    };
    if !client
        .grant_types
        .iter()
        .any(|grant_type| grant_type == "authorization_code")
    {
        return oauth_error(StatusCode::BAD_REQUEST, "unauthorized_client", UNAUTHORIZED_CLIENT);
    }
    let code = match request.code.filter(|code| !code.is_empty()) {
        Some(code) => code,
        None => return oauth_error(StatusCode::BAD_REQUEST, "invalid_request", INVALID_REQUEST),
    };
    let now = Utc::now();
    let code_session = match service.store().auth_code(&code, now, false).await {
        Ok(Some(code_session)) => code_session,
        Ok(None) => return invalid_grant(),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "load authorization code").into_response(),
    };
    if !code_session.active {
        if service.store().revoke_token_chain(&code).await.is_err() {
            return (StatusCode::INTERNAL_SERVER_ERROR, "revoke token chain").into_response();
        }
        return invalid_grant();
    }
    if code_session.client_id != client_id
        || request.redirect_uri.as_deref() != Some(&code_session.redirect_uri)
        || request.code_verifier.as_deref().is_none_or(str::is_empty)
        || code_session.code_challenge_method != "S256"
        || !bool::from(subtle::ConstantTimeEq::ct_eq(
            code_challenge(request.code_verifier.as_deref().unwrap()).as_bytes(),
            code_session.code_challenge.as_bytes(),
        ))
    {
        return invalid_grant();
    }
    let token = match mint_token_pair(service, &client_id, &code_session.subject, &code_session.scopes, &code) {
        Ok(token) => token,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "mint access token").into_response(),
    };
    match service
        .store()
        .exchange_auth_code(&code, token.access, token.refresh)
        .await
    {
        Ok(true) => axum::Json(token.response).into_response(),
        Ok(false) => {
            if service.store().revoke_token_chain(&code).await.is_err() {
                return (StatusCode::INTERNAL_SERVER_ERROR, "revoke token chain").into_response();
            }
            invalid_grant()
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "create token").into_response(),
    }
}

async fn exchange_refresh_token(service: &Service, request: TokenRequest) -> Response {
    let client_id = match request.client_id.filter(|id| !id.is_empty()) {
        Some(client_id) => client_id,
        None => return invalid_client(),
    };
    let client = match service.store().client(&client_id).await {
        Ok(Some(client)) => client,
        Ok(None) => return invalid_client(),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "load client").into_response(),
    };
    if !client
        .grant_types
        .iter()
        .any(|grant_type| grant_type == "refresh_token")
    {
        return oauth_error(StatusCode::BAD_REQUEST, "unauthorized_client", UNAUTHORIZED_CLIENT);
    }
    let refresh_token = match request.refresh_token.filter(|token| !token.is_empty()) {
        Some(refresh_token) => refresh_token,
        None => return oauth_error(StatusCode::BAD_REQUEST, "invalid_request", INVALID_REQUEST),
    };
    let now = Utc::now();
    let signature = token_signature(&refresh_token);
    let existing = match service.store().refresh_token(&signature, now, false).await {
        Ok(Some(token)) => token,
        Ok(None) => return invalid_grant(),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "load refresh token").into_response(),
    };
    if !existing.active {
        if service.store().revoke_token_chain(&existing.request_id).await.is_err() {
            return (StatusCode::INTERNAL_SERVER_ERROR, "revoke token chain").into_response();
        }
        return invalid_grant();
    }
    if existing.client_id != client_id {
        return invalid_grant();
    }
    let token = match mint_token_pair(
        service,
        &existing.client_id,
        &existing.subject,
        &existing.scopes.join(" "),
        &existing.request_id,
    ) {
        Ok(token) => token,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "mint access token").into_response(),
    };
    match service
        .store()
        .rotate_refresh_token(signature, now, token.access, token.refresh)
        .await
    {
        Ok(true) => axum::Json(token.response).into_response(),
        Ok(false) => invalid_grant(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "create token").into_response(),
    }
}

struct TokenPair {
    access: OAuthToken,
    refresh: OAuthToken,
    response: TokenResponse,
}

fn mint_token_pair(
    service: &Service,
    client_id: &str,
    subject: &str,
    scope_value: &str,
    request_id: &str,
) -> anyhow::Result<TokenPair> {
    let scopes = scope_value
        .split_whitespace()
        .map(Scope::from_str)
        .collect::<Result<Vec<_>, _>>()?;
    let access_token = service.mint_access_token(subject, &scopes, &service.timezone())?;
    let now = Utc::now();
    let access = OAuthToken {
        signature: access_token
            .rsplit_once('.')
            .map(|(_, signature)| signature.to_owned())
            .ok_or_else(|| anyhow::anyhow!("access token signature missing"))?,
        client_id: client_id.to_owned(),
        subject: subject.to_owned(),
        scopes: scopes.iter().map(ToString::to_string).collect(),
        expires_at: now + chrono::Duration::from_std(service.access_token_lifetime())?,
        request_id: request_id.to_owned(),
        active: true,
    };
    let refresh_token = random_token(32);
    let refresh = OAuthToken {
        signature: token_signature(&refresh_token),
        client_id: client_id.to_owned(),
        subject: subject.to_owned(),
        scopes: access.scopes.clone(),
        expires_at: now + chrono::Duration::from_std(service.refresh_token_lifetime())?,
        request_id: request_id.to_owned(),
        active: true,
    };
    Ok(TokenPair {
        response: TokenResponse {
            access_token,
            token_type: "bearer",
            expires_in: service.access_token_lifetime().as_secs(),
            refresh_token,
            scope: access.scopes.join(" "),
        },
        access,
        refresh,
    })
}

fn invalid_client() -> Response {
    oauth_error(StatusCode::UNAUTHORIZED, "invalid_client", INVALID_CLIENT)
}

fn invalid_grant() -> Response {
    oauth_error(StatusCode::BAD_REQUEST, "invalid_grant", INVALID_GRANT)
}

fn token_response(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert("Cache-Control", HeaderValue::from_static("no-store"));
    response
        .headers_mut()
        .insert("Pragma", HeaderValue::from_static("no-cache"));
    response
}
