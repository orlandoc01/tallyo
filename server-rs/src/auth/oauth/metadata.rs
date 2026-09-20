use std::sync::Arc;

use axum::{extract::State, response::Response};

use super::super::{ALL_SCOPES, Service};
use super::public_json;

pub(super) async fn authorization_metadata(State(service): State<Arc<Service>>) -> Response {
    let issuer = service.issuer_url();
    let mut metadata = serde_json::json!({
        "issuer": issuer,
        "authorization_endpoint": format!("{issuer}/authorize"),
        "token_endpoint": format!("{issuer}/token"),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": scope_names(),
    });
    if service.dcr_settings().enabled {
        metadata["registration_endpoint"] = format!("{issuer}/register").into();
    }
    public_json(metadata)
}

pub(super) async fn protected_resource_metadata(State(service): State<Arc<Service>>) -> Response {
    public_json(resource_metadata(&service, ""))
}

pub(super) async fn mcp_protected_resource_metadata(State(service): State<Arc<Service>>) -> Response {
    public_json(resource_metadata(&service, "/mcp"))
}

pub(super) async fn auth_config(State(service): State<Arc<Service>>) -> Response {
    let scopes = service
        .master_password()
        .is_some()
        .then(scope_names)
        .unwrap_or_default();
    public_json(serde_json::json!({
        "master_password_status": service.master_password_status().to_string(),
        "google_auth_enabled": service.google_enabled(),
        "email_auth_enabled": service.email_enabled(),
        "webauthn_enabled": service.passkey_enabled(),
        "disable_all_auth": service.disable_all_auth(),
        "setup_complete": service.setup_complete(),
        "scopes": scopes,
    }))
}

fn resource_metadata(service: &Service, path: &str) -> serde_json::Value {
    let issuer = service.issuer_url();
    serde_json::json!({
        "resource": format!("{issuer}{path}"),
        "authorization_servers": [issuer],
        "scopes_supported": scope_names(),
        "bearer_methods_supported": ["header"],
    })
}

fn scope_names() -> Vec<String> {
    ALL_SCOPES.iter().map(ToString::to_string).collect()
}
