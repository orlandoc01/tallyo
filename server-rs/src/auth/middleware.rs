use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Request, State},
    http::{HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};

use super::{ALL_SCOPES, Identity, Service, roles::parse_scopes};

pub async fn protect(State(service): State<Arc<Service>>, request: Request, next: Next) -> Response {
    protect_resource(service, request, next, "/.well-known/oauth-protected-resource").await
}
pub async fn protect_mcp(State(service): State<Arc<Service>>, request: Request, next: Next) -> Response {
    protect_resource(service, request, next, "/.well-known/oauth-protected-resource/mcp").await
}

async fn protect_resource(service: Arc<Service>, mut request: Request, next: Next, metadata_path: &str) -> Response {
    let bearer_identity = bearer_token(&request).and_then(|token| {
        service.verify_access_token(token).ok().map(|claims| Identity {
            subject: Some(claims.sub),
            scopes: parse_scopes(&claims.scope),
            timezone: if claims.locale.timezone.is_empty() { service.timezone() } else { claims.locale.timezone },
        })
    });
    let master_password = service.master_password().and_then(|password| {
        request
            .headers()
            .get("X-API-Key")
            .is_some_and(|value| subtle::ConstantTimeEq::ct_eq(value.as_bytes(), password.as_str().as_bytes()).into())
            .then_some(password)
    });
    let identity = match (master_password, bearer_identity) {
        _ if service.disable_all_auth() => Some(Identity {
            subject: None,
            scopes: ALL_SCOPES.to_vec(),
            timezone: service.timezone(),
        }),
        (_, Some(identity)) => Some(identity),
        (Some(_), _) => Some(Identity {
            subject: None,
            scopes: ALL_SCOPES.to_vec(),
            timezone: service.timezone(),
        }),
        _ => None,
    };
    if let Some(identity) = identity {
        request.extensions_mut().insert(identity);
        return next.run(request).await;
    }
    let mut response = Response::new(Body::from("unauthorized"));
    *response.status_mut() = StatusCode::UNAUTHORIZED;
    let header = format!("Bearer resource_metadata=\"{}{}\"", service.issuer_url(), metadata_path);
    response
        .headers_mut()
        .insert("WWW-Authenticate", HeaderValue::from_str(&header).unwrap());
    response
}

pub async fn require_oauth(State(service): State<Arc<Service>>, request: Request, next: Next) -> Response {
    if service.oauth_enabled() { next.run(request).await } else { StatusCode::NOT_FOUND.into_response() }
}

pub async fn dev_cors(State(service): State<Arc<Service>>, request: Request, next: Next) -> Response {
    let origin = request
        .headers()
        .get("Origin")
        .and_then(|value| value.to_str().ok())
        .map(|origin| origin.trim_end_matches('/').to_owned());
    let mut response = if request.method() == Method::OPTIONS {
        StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(request).await
    };
    if let Some(origin) = origin.filter(|origin| service.dev_origin_allowed(origin)) {
        let headers = response.headers_mut();
        headers.insert("Access-Control-Allow-Origin", HeaderValue::from_str(&origin).unwrap());
        headers.insert(
            "Access-Control-Expose-Headers",
            HeaderValue::from_static("Mcp-Session-Id"),
        );
        headers.insert("Vary", HeaderValue::from_static("Origin"));
        headers.insert(
            "Access-Control-Allow-Headers",
            HeaderValue::from_static("Authorization, Content-Type, X-API-Key"),
        );
        headers.insert(
            "Access-Control-Allow-Methods",
            HeaderValue::from_static("GET, POST, PATCH, DELETE, OPTIONS"),
        );
    }
    response
}

fn bearer_token(request: &Request) -> Option<&str> {
    let values = request
        .headers()
        .get("Authorization")?
        .to_str()
        .ok()?
        .split_whitespace()
        .collect::<Vec<_>>();
    (values.len() == 2 && values[0].eq_ignore_ascii_case("bearer")).then_some(values[1])
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::{
        Router,
        body::to_bytes,
        http::{Request, StatusCode},
        middleware,
        routing::get,
    };
    use tower::ServiceExt;

    use super::{dev_cors, protect, protect_mcp};
    use crate::{
        auth::{AuthSettings, Config, Scope, Service},
        database::dbtest,
        middleware::client_ip::ClientIpResolver,
    };

    async fn service() -> Arc<Service> {
        let config = Config::new(
            AuthSettings {
                issuer_url: "https://tallyo.test".to_owned(),
                oauth_enabled: true,
                frontend_redirect_uris: vec!["https://web.test/callback".to_owned()],
                dev_cors_allowed_origins: vec!["https://web.test/".to_owned()],
                ..Default::default()
            },
            ClientIpResolver::new(&[]).unwrap(),
        );
        Arc::new(Service::new(config, dbtest::open().await.unwrap()).await.unwrap())
    }

    #[tokio::test]
    async fn protects_bearer_requests_and_advertises_mcp_metadata() {
        let service = service().await;
        let token = service
            .mint_access_token("person@example.com", &[Scope::ReadAccounts], "UTC")
            .unwrap();
        let router = Router::new()
            .route("/", get(|| async { "ok" }))
            .layer(middleware::from_fn_with_state(Arc::clone(&service), protect));
        let response = router
            .oneshot(
                Request::builder()
                    .uri("/")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let router = Router::new()
            .route("/", get(|| async { "ok" }))
            .layer(middleware::from_fn_with_state(service, protect_mcp));
        let response = router
            .oneshot(Request::builder().uri("/").body(axum::body::Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response.headers()["WWW-Authenticate"],
            "Bearer resource_metadata=\"https://tallyo.test/.well-known/oauth-protected-resource/mcp\""
        );
        assert_eq!(to_bytes(response.into_body(), 1024).await.unwrap(), "unauthorized");
    }

    #[tokio::test]
    async fn applies_development_cors_only_to_allowed_origins() {
        let service = service().await;
        let router = Router::new()
            .route("/", get(|| async { "ok" }))
            .layer(middleware::from_fn_with_state(service, dev_cors));
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/")
                    .header("Origin", "https://web.test/")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["Access-Control-Allow-Origin"], "https://web.test");
        for header in [
            "Access-Control-Allow-Origin",
            "Access-Control-Expose-Headers",
            "Vary",
            "Access-Control-Allow-Headers",
            "Access-Control-Allow-Methods",
        ] {
            assert!(response.headers().contains_key(header));
        }

        let response = router
            .oneshot(
                Request::builder()
                    .uri("/")
                    .header("Origin", "https://other.test")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().get("Access-Control-Allow-Origin").is_none());
    }
}
