use std::{net::IpAddr, str::FromStr, sync::Arc};

use axum::{
    extract::{Form, Query, State},
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
};
use chrono::Utc;
use serde::Deserialize;
use url::Url;

use super::{json_response, oauth_error, public_json};
use crate::auth::store::split_scopes;
use crate::auth::{
    AuthCode, CLIENT_ALLOWED_SCOPES, LoginSession, OAuthClient, Service, granted_scopes_for_role, random_token,
};
use crate::schema::Role;

const AUTHORIZE_LIFETIME: chrono::TimeDelta = chrono::TimeDelta::seconds(600);
const INVALID_REQUEST: &str = "The request is missing a required parameter, includes an invalid parameter value, includes a parameter more than once, or is otherwise malformed.";
const INVALID_CLIENT: &str = "Client authentication failed (e.g., unknown client, no client authentication included, or unsupported authentication method).";
const INVALID_SCOPE: &str = "The requested scope is invalid, unknown, or malformed.";
const UNSUPPORTED_RESPONSE_TYPE: &str =
    "The authorization server does not support obtaining an authorization code using this method.";
const UNAUTHORIZED_CLIENT: &str = "The client is not authorized to request an authorization code using this method.";

#[derive(Deserialize)]
pub(super) struct AuthorizeRequest {
    client_id: Option<String>,
    redirect_uri: Option<String>,
    response_type: Option<String>,
    scope: Option<String>,
    state: Option<String>,
    code_challenge: Option<String>,
    code_challenge_method: Option<String>,
    auth_method: Option<String>,
    session_id: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct ConsentRequest {
    session_id: String,
    consent: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct RegistrationRequest {
    #[serde(default)]
    client_name: String,
    #[serde(default)]
    redirect_uris: Vec<String>,
    #[serde(default)]
    grant_types: Vec<String>,
    #[serde(default)]
    response_types: Vec<String>,
    #[serde(default)]
    application_type: String,
    #[serde(default)]
    token_endpoint_auth_method: String,
}

pub(super) async fn authorize(
    State(service): State<Arc<Service>>,
    Query(request): Query<AuthorizeRequest>,
    headers: HeaderMap,
) -> Response {
    if let Some(session_id) = request.session_id.filter(|id| !id.is_empty()) {
        return complete_authorize(&service, &session_id, false, accepts_json(&headers)).await;
    }

    let client = match service
        .store()
        .client(request.client_id.as_deref().unwrap_or_default())
        .await
    {
        Ok(Some(client)) => client,
        Ok(None) => return oauth_error(StatusCode::UNAUTHORIZED, "invalid_client", INVALID_CLIENT),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "load client").into_response(),
    };
    let redirect_uri = match authorization_redirect_uri(&client, request.redirect_uri.as_deref()) {
        Ok(redirect_uri) => redirect_uri,
        Err(_) => return oauth_error(StatusCode::BAD_REQUEST, "invalid_request", INVALID_REQUEST),
    };
    let requested_scopes = request
        .scope
        .as_deref()
        .map(split_scopes)
        .filter(|scopes| !scopes.is_empty())
        .unwrap_or_else(|| vec!["read".to_owned(), "write".to_owned()]);

    let validation = match () {
        _ if request.response_type.as_deref() != Some("code") => {
            Err(("unsupported_response_type", UNSUPPORTED_RESPONSE_TYPE))
        }
        _ if !client
            .response_types
            .iter()
            .any(|response_type| response_type == "code")
            || !client
                .grant_types
                .iter()
                .any(|grant_type| grant_type == "authorization_code") =>
        {
            Err(("unauthorized_client", UNAUTHORIZED_CLIENT))
        }
        _ if request.code_challenge.as_deref().is_none_or(str::is_empty)
            || request.code_challenge_method.as_deref() != Some("S256") =>
        {
            Err(("invalid_request", INVALID_REQUEST))
        }
        _ if requested_scopes.iter().any(|scope| !client.scopes.contains(scope)) => {
            Err(("invalid_scope", INVALID_SCOPE))
        }
        _ => Ok(()),
    };
    if let Err((error, description)) = validation {
        return authorize_error(&redirect_uri, request.state.as_deref(), error, description);
    }

    let session = LoginSession {
        id: random_token(16),
        client_id: client.id,
        redirect_uri,
        state: request.state.unwrap_or_default(),
        code_challenge: request.code_challenge.unwrap_or_default(),
        code_challenge_method: "S256".to_owned(),
        scopes: requested_scopes.join(" "),
        callback_state: random_token(24),
        subject: String::new(),
        authenticated: false,
        expires_at: (Utc::now() + AUTHORIZE_LIFETIME).into(),
        email: String::new(),
        email_otp: String::new(),
        email_otp_expires_at: None,
        email_otp_attempts: 0,
        email_magic_token: String::new(),
        pkce_verifier: String::new(),
        webauthn_session: String::new(),
        purpose: String::new(),
    };
    if service.store().create_login_session(&session).await.is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "save login session").into_response();
    }
    match request.auth_method.as_deref() {
        Some("email") if !service.email_enabled() => {
            (StatusCode::BAD_REQUEST, "email auth is not enabled").into_response()
        }
        Some("google") if !service.google_enabled() => {
            (StatusCode::BAD_REQUEST, "google auth is not enabled").into_response()
        }
        Some("webauthn") if !service.passkey_enabled() => {
            (StatusCode::BAD_REQUEST, "webauthn is not enabled").into_response()
        }
        Some("webauthn") => json_response(StatusCode::OK, serde_json::json!({"login_session_id": session.id})),
        Some("email") => redirect(&format!(
            "{}/auth/email-challenge?login_session={}",
            service.issuer_url(),
            session.id
        )),
        Some("google") => redirect(&format!(
            "{}/auth/google?login_session={}",
            service.issuer_url(),
            session.id
        )),
        Some(_) => (StatusCode::BAD_REQUEST, "unsupported auth method").into_response(),
        None => redirect(&format!(
            "{}/auth/login?login_session={}",
            service.issuer_url(),
            session.id
        )),
    }
}

pub(super) async fn consent_form(
    State(service): State<Arc<Service>>,
    form: Result<Form<ConsentRequest>, axum::extract::rejection::FormRejection>,
) -> Response {
    let session_id = match form {
        Ok(Form(consent)) if !consent.session_id.is_empty() => consent.session_id,
        Ok(_) => {
            return oauth_error(
                StatusCode::BAD_REQUEST,
                "invalid_request",
                "No active authorization session",
            );
        }
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid form").into_response(),
    };
    render_consent_for_session(&service, &session_id).await
}

pub(super) async fn consent(
    State(service): State<Arc<Service>>,
    headers: HeaderMap,
    form: Result<Form<ConsentRequest>, axum::extract::rejection::FormRejection>,
) -> Response {
    let consent = match form {
        Ok(Form(consent)) if !consent.session_id.is_empty() => consent,
        Ok(_) => {
            return oauth_error(
                StatusCode::BAD_REQUEST,
                "invalid_request",
                "No active authorization session",
            );
        }
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid form").into_response(),
    };
    if consent.consent.as_deref() == Some("allow") {
        return complete_authorize(&service, &consent.session_id, true, accepts_json(&headers)).await;
    }
    deny_authorize(&service, &consent.session_id).await
}

pub(super) async fn register(
    State(service): State<Arc<Service>>,
    request: Result<axum::Json<RegistrationRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if !service.dcr_settings().enabled {
        return StatusCode::NOT_FOUND.into_response();
    }
    let request = match request {
        Ok(axum::Json(request)) => request,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid registration").into_response(),
    };
    if request.redirect_uris.is_empty()
        || (!request.token_endpoint_auth_method.is_empty() && request.token_endpoint_auth_method != "none")
    {
        return (StatusCode::BAD_REQUEST, "invalid registration").into_response();
    }
    if request.redirect_uris.iter().any(|uri| {
        !allowed_dynamic_redirect_uri(
            uri,
            &service.issuer_url(),
            &service.dcr_settings().dynamic_redirect_hosts,
        )
    }) {
        return (
            StatusCode::BAD_REQUEST,
            "redirect_uri must target the issuer host, an allowed host, localhost, or a private app scheme",
        )
            .into_response();
    }

    let client_id = random_token(18);
    let application_type =
        if request.application_type.is_empty() { "native".to_owned() } else { request.application_type };
    let client = OAuthClient {
        id: client_id.clone(),
        redirect_uris: request.redirect_uris,
        grant_types: default_or(request.grant_types, ["authorization_code", "refresh_token"]),
        response_types: default_or(request.response_types, ["code"]),
        scopes: CLIENT_ALLOWED_SCOPES.iter().map(ToString::to_string).collect(),
        application_type,
        client_name: request.client_name,
        public: true,
        preseeded: false,
    };
    if service.store().save_client(client.clone()).await.is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "save client").into_response();
    }
    let mut response = serde_json::json!({
        "client_id": client_id,
        "client_id_issued_at": Utc::now().timestamp(),
        "token_endpoint_auth_method": "none",
        "grant_types": client.grant_types,
        "response_types": client.response_types,
        "redirect_uris": client.redirect_uris,
    });
    if !client.client_name.is_empty() {
        response["client_name"] = client.client_name.into();
    }
    public_json(response)
}

pub(super) async fn complete_authorize(
    service: &Service,
    session_id: &str,
    consent_approved: bool,
    wants_json: bool,
) -> Response {
    let session = match service.store().login_session_by_id(session_id).await {
        Ok(Some(session)) if session.authenticated && session.expires_at() > Utc::now() => session,
        Ok(_) => return (StatusCode::BAD_REQUEST, "login session expired").into_response(),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "load login session").into_response(),
    };
    let client = match service.store().client(&session.client_id).await {
        Ok(Some(client)) => client,
        Ok(None) | Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "client not found").into_response(),
    };
    let role = match role_for_session(service, &session).await {
        Ok(role) => role,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "load user role").into_response(),
    };
    let scopes = granted_scopes_for_role(role, &split_scopes(&session.scopes));
    if !client.preseeded && !consent_approved {
        return render_consent(&session, &client, &scopes);
    }
    let claimed = match service.store().claim_authenticated_login_session(&session.id).await {
        Ok(claimed) => claimed,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "claim login session").into_response(),
    };
    if !claimed {
        return (StatusCode::BAD_REQUEST, "login session expired").into_response();
    }
    let code = random_token(32);
    let auth_code = AuthCode {
        client_id: session.client_id.clone(),
        subject: session.subject.clone(),
        scopes: scopes.iter().map(ToString::to_string).collect::<Vec<_>>().join(" "),
        redirect_uri: session.redirect_uri.clone(),
        code_challenge: session.code_challenge.clone(),
        code_challenge_method: session.code_challenge_method.clone(),
        expires_at: (Utc::now() + AUTHORIZE_LIFETIME).into(),
        active: true,
    };
    if service.store().create_auth_code(&code, &auth_code).await.is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "create authorization code").into_response();
    }
    let callback = match callback_url(&session.redirect_uri, &code, &session.state) {
        Some(callback) => callback,
        None => return (StatusCode::INTERNAL_SERVER_ERROR, "invalid redirect uri").into_response(),
    };
    if wants_json {
        return json_response(StatusCode::OK, serde_json::json!({"callback_url": callback}));
    }
    redirect(&callback)
}

async fn render_consent_for_session(service: &Service, session_id: &str) -> Response {
    let session = match service.store().login_session_by_id(session_id).await {
        Ok(Some(session)) if session.authenticated && session.expires_at() > Utc::now() => session,
        Ok(_) => return (StatusCode::BAD_REQUEST, "login session expired").into_response(),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "load login session").into_response(),
    };
    let client = match service.store().client(&session.client_id).await {
        Ok(Some(client)) => client,
        Ok(None) | Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "client not found").into_response(),
    };
    let role = match role_for_session(service, &session).await {
        Ok(role) => role,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "load user role").into_response(),
    };
    render_consent(
        &session,
        &client,
        &granted_scopes_for_role(role, &split_scopes(&session.scopes)),
    )
}

async fn role_for_session(service: &Service, session: &LoginSession) -> anyhow::Result<Role> {
    if session.subject.is_empty() {
        return Ok(Role::Writer);
    }
    service
        .store()
        .user_role(&session.subject)
        .await?
        .ok_or_else(|| anyhow::anyhow!("user role not found"))
}

fn render_consent(session: &LoginSession, client: &OAuthClient, scopes: &[crate::auth::Scope]) -> Response {
    let client_name = if client.client_name.is_empty() { &client.id } else { &client.client_name };
    let scope_list = if scopes.is_empty() {
        "<p>No scopes requested.</p>".to_owned()
    } else {
        format!(
            "<ul>{}</ul>",
            scopes
                .iter()
                .map(|scope| format!("<li>{}</li>", escape_html(&scope.to_string())))
                .collect::<String>()
        )
    };
    Html(
        CONSENT_TEMPLATE
            .replace("{client}", &escape_html(client_name))
            .replace("{redirect}", &escape_html(&session.redirect_uri))
            .replace("{scopes}", &scope_list)
            .replace("{session}", &escape_html(&session.id)),
    )
    .into_response()
}

async fn deny_authorize(service: &Service, session_id: &str) -> Response {
    let session = match service.store().login_session_by_id(session_id).await {
        Ok(Some(session)) => session,
        Ok(None) | Err(_) => return (StatusCode::BAD_REQUEST, "login session expired").into_response(),
    };
    if let Err(error) = service.store().delete_login_session(&session.id).await {
        tracing::warn!(%error, "delete denied login session");
    }
    let Ok(mut redirect_uri) = Url::parse(&session.redirect_uri) else {
        return (StatusCode::FORBIDDEN, "access denied").into_response();
    };
    set_query_value(&mut redirect_uri, "error", "access_denied");
    if !session.state.is_empty() {
        set_query_value(&mut redirect_uri, "state", &session.state);
    }
    redirect(redirect_uri.as_str())
}

fn authorization_redirect_uri(client: &OAuthClient, requested: Option<&str>) -> Result<String, ()> {
    match requested {
        Some(uri) if valid_redirect_uri(uri) && client.redirect_uris.iter().any(|registered| registered == uri) => {
            Ok(uri.to_owned())
        }
        Some(_) => Err(()),
        None if client.redirect_uris.len() == 1 && valid_redirect_uri(&client.redirect_uris[0]) => {
            Ok(client.redirect_uris[0].clone())
        }
        None => Err(()),
    }
}

fn allowed_dynamic_redirect_uri(uri: &str, issuer_url: &str, allowed_hosts: &[String]) -> bool {
    let Ok(parsed) = Url::parse(uri) else {
        return false;
    };
    if parsed.scheme().is_empty()
        || parsed.fragment().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return false;
    }
    match parsed.scheme().to_ascii_lowercase().as_str() {
        "https" => allowed_https_host(parsed.host_str(), issuer_url, allowed_hosts),
        "http" => parsed
            .host_str()
            .map(|host| {
                host.eq_ignore_ascii_case("localhost") || IpAddr::from_str(host).is_ok_and(|ip| ip.is_loopback())
            })
            .unwrap_or(false),
        "javascript" | "data" | "file" | "vbscript" | "about" | "blob" | "mailto" => false,
        _ => true,
    }
}

fn allowed_https_host(host: Option<&str>, issuer_url: &str, allowed_hosts: &[String]) -> bool {
    let Some(host) = host.map(str::trim).filter(|host| !host.is_empty()) else {
        return false;
    };
    let issuer_host = Url::parse(issuer_url)
        .ok()
        .and_then(|issuer| issuer.host_str().map(str::to_owned));
    issuer_host
        .as_deref()
        .is_some_and(|issuer| host.eq_ignore_ascii_case(issuer))
        || allowed_hosts
            .iter()
            .any(|allowed| host.eq_ignore_ascii_case(allowed.trim()))
}

fn valid_redirect_uri(uri: &str) -> bool {
    Url::parse(uri).is_ok()
}

fn callback_url(redirect_uri: &str, code: &str, state: &str) -> Option<String> {
    let mut callback = Url::parse(redirect_uri).ok()?;
    set_query_value(&mut callback, "code", code);
    if !state.is_empty() {
        set_query_value(&mut callback, "state", state);
    }
    Some(callback.into())
}

fn authorize_error(
    redirect_uri: &str,
    state: Option<&str>,
    error: &'static str,
    description: &'static str,
) -> Response {
    let Ok(mut redirect_uri) = Url::parse(redirect_uri) else {
        return oauth_error(StatusCode::BAD_REQUEST, error, description);
    };
    set_query_value(&mut redirect_uri, "error", error);
    set_query_value(&mut redirect_uri, "error_description", description);
    if let Some(state) = state.filter(|state| !state.is_empty()) {
        set_query_value(&mut redirect_uri, "state", state);
    }
    redirect(redirect_uri.as_str())
}

fn set_query_value(url: &mut Url, name: &str, value: &str) {
    let retained = url
        .query_pairs()
        .filter(|(key, _)| key != name)
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    let mut query = url.query_pairs_mut();
    query.clear();
    query.extend_pairs(retained.iter().map(|(key, value)| (key.as_str(), value.as_str())));
    query.append_pair(name, value);
}

pub(super) fn redirect(location: &str) -> Response {
    let mut response = Response::new(axum::body::Body::empty());
    match axum::http::HeaderValue::from_str(location) {
        Ok(location) => {
            *response.status_mut() = StatusCode::FOUND;
            response.headers_mut().insert("Location", location);
        }
        Err(_) => {
            *response.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
            *response.body_mut() = axum::body::Body::from("invalid redirect uri");
        }
    }
    response
}

fn accepts_json(headers: &HeaderMap) -> bool {
    headers.get("Accept").and_then(|value| value.to_str().ok()) == Some("application/json")
}

fn default_or<const N: usize>(value: Vec<String>, default: [&str; N]) -> Vec<String> {
    if value.is_empty() { default.into_iter().map(ToOwned::to_owned).collect() } else { value }
}

const CONSENT_TEMPLATE: &str = r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Authorize OAuth Client</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0}main{width:min(92vw,32rem);background:#111827;border:1px solid #334155;border-radius:1rem;padding:2rem;box-shadow:0 24px 80px rgba(0,0,0,.35)}p,li{color:#cbd5e1;line-height:1.5}code{display:block;overflow-wrap:anywhere;padding:.75rem;border-radius:.5rem;background:#020617;color:#bfdbfe}form{display:flex;gap:.75rem;margin-top:1.5rem}button{border:0;border-radius:.5rem;padding:.75rem 1rem;font-weight:700;cursor:pointer}button[value="allow"]{background:#22c55e;color:#052e16}button[value="deny"]{background:#334155;color:#f8fafc}</style></head><body><main><h1>Authorize {client}</h1><p>This third-party OAuth client wants access to your Tallyo account.</p><p>Redirect URI:</p><code>{redirect}</code><p>Scopes that will be granted:</p>{scopes}<form method="post" action="/consent"><input type="hidden" name="session_id" value="{session}"><button type="submit" name="consent" value="allow">Allow</button><button type="submit" name="consent" value="deny">Deny</button></form></main></body></html>"#;

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
