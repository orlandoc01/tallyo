use axum::{
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use chrono::Utc;

use crate::auth::{LOGIN_SESSION_LIFETIME, LoginSession, Service, random_token, token_signature};

const LOGIN_COOKIE: &str = "tallyo_login";
const HOST_LOGIN_COOKIE: &str = "__Host-tallyo_login";
const LOGIN_SESSION_EXPIRED: &str = "login session expired";

pub(super) struct Cookie<'a> {
    pub(super) name: &'a str,
    pub(super) value: &'a str,
    pub(super) path: &'a str,
    pub(super) max_age_seconds: i64,
    pub(super) http_only: bool,
}

/// Appends a `SameSite=Lax` cookie, marked `Secure` whenever the issuer is served over https.
pub(super) fn append_cookie(response: &mut Response, service: &Service, cookie: Cookie<'_>) {
    let header_value = format!(
        "{}={}; Path={}; Max-Age={}; SameSite=Lax{}{}",
        cookie.name,
        cookie.value,
        cookie.path,
        cookie.max_age_seconds,
        if cookie.http_only { "; HttpOnly" } else { "" },
        if secure_issuer(service) { "; Secure" } else { "" }
    );
    if let Ok(header_value) = HeaderValue::from_str(&header_value) {
        response.headers_mut().append(header::SET_COOKIE, header_value);
    }
}

fn secure_issuer(service: &Service) -> bool {
    service.issuer_url().starts_with("https://")
}

// `__Host-` cookies cannot be planted by sibling hosts or via Domain, but require Secure.
fn login_cookie_name(service: &Service) -> &'static str {
    if secure_issuer(service) { HOST_LOGIN_COOKIE } else { LOGIN_COOKIE }
}

/// A fresh browser-binding secret; its signature is what the login session stores.
pub(super) struct Binding(String);

impl Binding {
    pub(super) fn generate() -> Self {
        Self(random_token(32))
    }

    pub(super) fn signature(&self) -> String {
        token_signature(&self.0)
    }

    pub(super) fn attach(self, mut response: Response, service: &Service) -> Response {
        append_cookie(
            &mut response,
            service,
            Cookie {
                name: login_cookie_name(service),
                value: &self.0,
                path: "/",
                max_age_seconds: LOGIN_SESSION_LIFETIME.num_seconds(),
                http_only: true,
            },
        );
        response
    }
}

pub(super) fn login_binding(headers: &HeaderMap, service: &Service) -> Option<String> {
    let name = login_cookie_name(service);
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(cookie_name, _)| *cookie_name == name)
        .map(|(_, value)| value.to_owned())
}

pub(super) fn session_bound(session: &LoginSession, binding: Option<&str>) -> bool {
    binding.is_some_and(|binding| {
        subtle::ConstantTimeEq::ct_eq(token_signature(binding).as_bytes(), session.browser_binding.as_bytes()).into()
    })
}

pub(super) fn login_session_expired() -> Response {
    (StatusCode::BAD_REQUEST, LOGIN_SESSION_EXPIRED).into_response()
}

pub(super) enum BindingError {
    /// Missing, expired, or not bound to this browser; callers answer exactly as for an expired session.
    Expired,
    Internal,
}

impl IntoResponse for BindingError {
    fn into_response(self) -> Response {
        match self {
            Self::Expired => login_session_expired(),
            Self::Internal => (StatusCode::INTERNAL_SERVER_ERROR, "load login session").into_response(),
        }
    }
}

/// Loads a live login session and requires the request to carry the browser binding it was created with.
pub(super) async fn bound_login_session(
    service: &Service,
    session_id: &str,
    headers: &HeaderMap,
) -> Result<LoginSession, BindingError> {
    let session = service
        .store()
        .login_session_by_id(session_id)
        .await
        .map_err(|_| BindingError::Internal)?
        .filter(|session| session.expires_at() > Utc::now())
        .ok_or(BindingError::Expired)?;
    if !session_bound(&session, login_binding(headers, service).as_deref()) {
        return Err(BindingError::Expired);
    }
    Ok(session)
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, HeaderValue, header};

    use super::login_binding;
    use crate::{
        auth::{AuthSettings, Config, Service},
        database::dbtest,
        middleware::client_ip::ClientIpResolver,
    };

    async fn service(issuer_url: &str) -> Service {
        Service::new(
            Config::new(
                AuthSettings {
                    issuer_url: issuer_url.to_owned(),
                    oauth_enabled: true,
                    frontend_redirect_uris: vec![format!("{issuer_url}/auth/callback")],
                    ..Default::default()
                },
                ClientIpResolver::new(&[]).unwrap(),
            ),
            dbtest::open().await.unwrap(),
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn reads_only_the_cookie_name_that_matches_the_issuer_scheme() {
        let https = service("https://tallyo.test").await;
        let http = service("http://localhost:8080").await;
        let mut headers = HeaderMap::new();
        headers.append(header::COOKIE, HeaderValue::from_static("other=1; tallyo_login=plain"));
        headers.append(
            header::COOKIE,
            HeaderValue::from_static("__Host-tallyo_login=host ; other=2"),
        );
        assert_eq!(login_binding(&headers, &https).as_deref(), Some("host"));
        assert_eq!(login_binding(&headers, &http).as_deref(), Some("plain"));

        let mut planted = HeaderMap::new();
        planted.insert(header::COOKIE, HeaderValue::from_static("tallyo_login=attacker"));
        assert_eq!(login_binding(&planted, &https), None);
        assert_eq!(login_binding(&HeaderMap::new(), &https), None);
    }
}
