mod authorize;
mod identity_provider;
mod metadata;
mod token;
mod webauthn;

use std::{sync::Arc, time::Duration};

use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::{HeaderValue, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{any, get, post},
};
use serde::Serialize;

use super::{Service, middleware::require_oauth};
use crate::middleware::ratelimit::rate_limit_with_client_ip;

const MAX_AUTH_REQUEST_BODY: usize = 1 << 20;
const AUTH_RATE_WINDOW: Duration = Duration::from_secs(10 * 60);
const EMAIL_RATE_WINDOW: Duration = Duration::from_secs(15);
const TOKEN_RATE_WINDOW: Duration = Duration::from_secs(10);

pub fn router(service: Arc<Service>) -> Router {
    let resolver = service.client_ip_resolver();
    let auth_limiter = rate_limit_with_client_ip(20, AUTH_RATE_WINDOW, resolver.clone());
    let email_limiter = rate_limit_with_client_ip(5, EMAIL_RATE_WINDOW, resolver.clone());
    let token_limiter = rate_limit_with_client_ip(10, TOKEN_RATE_WINDOW, resolver);
    Router::new()
        .route("/auth/config", any(metadata::auth_config))
        .route(
            "/.well-known/openid-configuration",
            any(|| async { StatusCode::NOT_FOUND }),
        )
        .merge(metadata_routes(Arc::clone(&service)))
        .merge(
            Router::new()
                .route("/register", post(authorize::register))
                .route("/authorize", any(authorize::authorize))
                .route("/consent", get(authorize::consent_form).post(authorize::consent))
                .route_layer(middleware::from_fn(auth_limiter.clone()))
                .route_layer(DefaultBodyLimit::max(MAX_AUTH_REQUEST_BODY))
                .route_layer(middleware::from_fn_with_state(Arc::clone(&service), require_oauth)),
        )
        .merge(
            Router::new()
                .route("/token", post(token::exchange))
                .route_layer(middleware::from_fn(token_limiter))
                .route_layer(DefaultBodyLimit::max(MAX_AUTH_REQUEST_BODY))
                .route_layer(middleware::from_fn_with_state(Arc::clone(&service), require_oauth)),
        )
        .merge(
            Router::new()
                .route("/auth/email/send", post(identity_provider::email_send))
                .route("/auth/email/verify", post(identity_provider::email_verify))
                .route("/auth/email/magic", get(identity_provider::email_magic))
                .route_layer(middleware::from_fn(email_limiter.clone()))
                .route_layer(DefaultBodyLimit::max(MAX_AUTH_REQUEST_BODY))
                .route_layer(middleware::from_fn_with_state(Arc::clone(&service), require_oauth)),
        )
        .merge(
            Router::new()
                .route("/auth/google", any(identity_provider::google_login))
                .route("/auth/google/callback", any(identity_provider::google_callback))
                .route_layer(middleware::from_fn(auth_limiter)),
        )
        .merge(webauthn::routes(Arc::clone(&service), email_limiter))
        .with_state(Arc::clone(&service))
}

fn metadata_routes(service: Arc<Service>) -> Router<Arc<Service>> {
    Router::new()
        .route(
            "/.well-known/oauth-authorization-server",
            any(metadata::authorization_metadata),
        )
        .route(
            "/.well-known/oauth-protected-resource",
            any(metadata::protected_resource_metadata),
        )
        .route(
            "/.well-known/oauth-protected-resource/mcp",
            any(metadata::mcp_protected_resource_metadata),
        )
        .route_layer(middleware::from_fn_with_state(service, require_oauth))
}

fn json_response<T: Serialize>(status: StatusCode, value: T) -> Response {
    let mut response = axum::Json(value).into_response();
    *response.status_mut() = status;
    response
}

fn public_json<T: Serialize>(value: T) -> Response {
    let mut response = json_response(StatusCode::OK, value);
    response
        .headers_mut()
        .insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
    response
}

fn oauth_error(status: StatusCode, error: &'static str, description: &'static str) -> Response {
    json_response(
        status,
        serde_json::json!({"error": error, "error_description": description}),
    )
}

#[cfg(test)]
mod tests;
