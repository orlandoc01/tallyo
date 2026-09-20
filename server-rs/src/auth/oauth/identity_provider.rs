use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use chrono::Utc;
use serde::Deserialize;

use super::json_response;
use crate::auth::{
    ERR_ALREADY_USED, ERR_EMAIL_AUTH_NOT_ENABLED, ERR_EXPIRED, ERR_INVALID_CODE, ERR_INVALID_TOKEN,
    ERR_LOGIN_SESSION_ALREADY_AUTHENTICATED, ERR_LOGIN_SESSION_NOT_FOUND_OR_EXPIRED, ERR_OTP_COOLDOWN,
    ERR_TOO_MANY_ATTEMPTS, EmailMagicLink, EmailSend, EmailVerify, GOOGLE_CALLBACK_TIMEOUT, GoogleClient, Service,
};

#[derive(Deserialize)]
pub(super) struct EmailSendRequest {
    login_session_id: String,
    email: String,
    #[serde(default)]
    code_verifier: String,
}

#[derive(Deserialize)]
pub(super) struct EmailVerifyRequest {
    login_session_id: String,
    email: String,
    code: String,
}

#[derive(Deserialize)]
pub(super) struct MagicLinkRequest {
    token: String,
    session_id: String,
    email: String,
}

#[derive(Deserialize)]
pub(super) struct GoogleLoginRequest {
    login_session: String,
}

#[derive(Deserialize)]
pub(super) struct GoogleCallbackRequest {
    state: String,
    code: String,
}

pub(super) async fn email_send(
    State(service): State<Arc<Service>>,
    request: Result<axum::Json<EmailSendRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if !service.email_enabled() {
        return (StatusCode::NOT_FOUND, ERR_EMAIL_AUTH_NOT_ENABLED).into_response();
    }
    let request = match request {
        Ok(axum::Json(request)) => request,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid request").into_response(),
    };
    if request.login_session_id.is_empty() || request.email.is_empty() {
        return (StatusCode::BAD_REQUEST, "missing required fields").into_response();
    }
    match service
        .send_email_code(EmailSend {
            login_session_id: request.login_session_id,
            email: request.email,
            code_verifier: request.code_verifier,
        })
        .await
    {
        Ok(result) => match result.message {
            Some(message) => json_response(
                StatusCode::OK,
                serde_json::json!({"sent": result.sent, "message": message}),
            ),
            None => json_response(StatusCode::OK, serde_json::json!({"sent": result.sent})),
        },
        Err(error) if error.to_string() == ERR_LOGIN_SESSION_NOT_FOUND_OR_EXPIRED => {
            (StatusCode::BAD_REQUEST, ERR_LOGIN_SESSION_NOT_FOUND_OR_EXPIRED).into_response()
        }
        Err(error) if error.to_string() == ERR_LOGIN_SESSION_ALREADY_AUTHENTICATED => {
            (StatusCode::BAD_REQUEST, ERR_LOGIN_SESSION_ALREADY_AUTHENTICATED).into_response()
        }
        Err(error) if error.to_string() == ERR_OTP_COOLDOWN => {
            (StatusCode::TOO_MANY_REQUESTS, ERR_OTP_COOLDOWN).into_response()
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "send email failed").into_response(),
    }
}

pub(super) async fn email_verify(
    State(service): State<Arc<Service>>,
    request: Result<axum::Json<EmailVerifyRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if !service.email_enabled() {
        return (StatusCode::NOT_FOUND, ERR_EMAIL_AUTH_NOT_ENABLED).into_response();
    }
    let request = match request {
        Ok(axum::Json(request)) => request,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid request").into_response(),
    };
    if request.login_session_id.is_empty() || request.email.is_empty() || request.code.is_empty() {
        return (StatusCode::BAD_REQUEST, "missing required fields").into_response();
    }
    match service
        .verify_email_code(EmailVerify {
            login_session_id: request.login_session_id,
            email: request.email,
            code: request.code,
        })
        .await
    {
        Ok(session) => json_response(
            StatusCode::OK,
            serde_json::json!({"redirect_url": format!("{}/authorize?session_id={}", service.issuer_url(), session.id)}),
        ),
        Err(error) if error.to_string() == ERR_INVALID_CODE => {
            email_verification_error("invalid_code", "Incorrect code. Please try again.")
        }
        Err(error) if error.to_string() == ERR_TOO_MANY_ATTEMPTS => {
            email_verification_error("too_many_attempts", "Too many incorrect attempts. Please start over.")
        }
        Err(error) if error.to_string() == ERR_EXPIRED => {
            email_verification_error("expired", "Code has expired. Please request a new one.")
        }
        Err(_) => (StatusCode::BAD_REQUEST, "verification failed").into_response(),
    }
}

pub(super) async fn email_magic(
    State(service): State<Arc<Service>>,
    Query(request): Query<MagicLinkRequest>,
) -> Response {
    if request.token.is_empty() || request.session_id.is_empty() || request.email.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "missing required parameters").into_response();
    }
    let email = request.email.trim().to_lowercase();
    let allowed = match service.store().is_email_allowed(&email).await {
        Ok(allowed) => allowed,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "check email allowed").into_response(),
    };
    if !allowed {
        return invalid_magic_link();
    }
    match service
        .verify_email_magic_link(EmailMagicLink {
            token: request.token,
            session_id: request.session_id,
            email,
        })
        .await
    {
        Ok(session) => {
            let mut response =
                super::authorize::redirect(&format!("{}/authorize?session_id={}", service.issuer_url(), session.id));
            if !session.pkce_verifier.is_empty() {
                set_magic_cookie(
                    &mut response,
                    "pkce-verifier",
                    &session.pkce_verifier,
                    "/auth/callback",
                    &service,
                );
            }
            if session.purpose == "passkey" {
                let value: String =
                    url::form_urlencoded::byte_serialize(b"/settings/passkeys?onboarding=passkey").collect();
                set_magic_cookie(&mut response, "st_post_login", &value, "/", &service);
            }
            response
        }
        Err(error) if error.to_string() == ERR_EXPIRED => (
            StatusCode::BAD_REQUEST,
            "Magic link has expired. Please request a new sign-in email.",
        )
            .into_response(),
        Err(error) if matches!(error.to_string().as_str(), ERR_INVALID_TOKEN | ERR_ALREADY_USED) => {
            invalid_magic_link()
        }
        Err(_) => invalid_magic_link(),
    }
}

pub(super) async fn google_login(
    State(service): State<Arc<Service>>,
    Query(request): Query<GoogleLoginRequest>,
) -> Response {
    if !service.google_enabled() {
        return (StatusCode::NOT_FOUND, "google auth is not enabled").into_response();
    }
    let session = match service.store().login_session_by_id(&request.login_session).await {
        Ok(Some(session)) if session.expires_at() > Utc::now() => session,
        Ok(_) | Err(_) => return (StatusCode::BAD_REQUEST, "login session expired").into_response(),
    };
    let Some(client) = service.google_client() else {
        return (StatusCode::NOT_FOUND, "google auth is not enabled").into_response();
    };
    super::authorize::redirect(&client.authorization_url(&session.callback_state))
}

pub(super) async fn google_callback(
    State(service): State<Arc<Service>>,
    Query(request): Query<GoogleCallbackRequest>,
) -> Response {
    if !service.google_enabled() {
        return (StatusCode::NOT_FOUND, "google auth is not enabled").into_response();
    }
    let Some(client) = service.google_client() else {
        return (StatusCode::NOT_FOUND, "google auth is not enabled").into_response();
    };
    match tokio::time::timeout(
        GOOGLE_CALLBACK_TIMEOUT,
        google_callback_inner(&service, &client, request),
    )
    .await
    {
        Ok(Ok(session_id)) => {
            super::authorize::redirect(&format!("{}/authorize?session_id={}", service.issuer_url(), session_id))
        }
        Ok(Err(GoogleCallbackError::State)) => (StatusCode::BAD_REQUEST, "authorization state expired").into_response(),
        Ok(Err(GoogleCallbackError::Token)) | Err(_) => {
            (StatusCode::BAD_GATEWAY, "google token exchange failed").into_response()
        }
        Ok(Err(GoogleCallbackError::Email)) => (StatusCode::BAD_GATEWAY, "google email lookup failed").into_response(),
        Ok(Err(GoogleCallbackError::Allowed)) => {
            (StatusCode::INTERNAL_SERVER_ERROR, "check email allowed").into_response()
        }
        Ok(Err(GoogleCallbackError::Denied)) => {
            (StatusCode::BAD_REQUEST, "google authentication failed").into_response()
        }
        Ok(Err(GoogleCallbackError::Save)) => (StatusCode::INTERNAL_SERVER_ERROR, "save login").into_response(),
    }
}

enum GoogleCallbackError {
    State,
    Token,
    Email,
    Allowed,
    Denied,
    Save,
}

async fn google_callback_inner(
    service: &Service,
    client: &GoogleClient,
    request: GoogleCallbackRequest,
) -> Result<String, GoogleCallbackError> {
    let session = service
        .store()
        .login_session_by_callback_state(&request.state)
        .await
        .map_err(|_| GoogleCallbackError::State)?
        .filter(|session| session.expires_at() > Utc::now())
        .ok_or(GoogleCallbackError::State)?;
    let token = client
        .exchange(&request.code)
        .await
        .map_err(|_| GoogleCallbackError::Token)?;
    let email = client
        .email(&token)
        .await
        .map_err(|_| GoogleCallbackError::Email)?
        .to_lowercase();
    let allowed = service
        .store()
        .is_email_allowed(&email)
        .await
        .map_err(|_| GoogleCallbackError::Allowed)?;
    if !allowed {
        return Err(GoogleCallbackError::Denied);
    }
    service
        .store()
        .mark_login_session_authenticated(&session.id, &email)
        .await
        .map_err(|_| GoogleCallbackError::Save)?;
    Ok(session.id)
}

fn email_verification_error(error: &'static str, message: &'static str) -> Response {
    json_response(
        StatusCode::BAD_REQUEST,
        serde_json::json!({"error": error, "message": message}),
    )
}

fn invalid_magic_link() -> Response {
    (StatusCode::BAD_REQUEST, "Invalid or already used magic link.").into_response()
}

fn set_magic_cookie(response: &mut Response, name: &str, value: &str, path: &str, service: &Service) {
    let secure = if service.issuer_url().starts_with("https://") { "; Secure" } else { "" };
    let cookie = format!("{name}={value}; Path={path}; Max-Age=300; SameSite=Lax{secure}");
    if let Ok(cookie) = HeaderValue::from_str(&cookie) {
        response.headers_mut().append("Set-Cookie", cookie);
    }
}
