use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    extract::{Request, connect_info::ConnectInfo},
    http::{HeaderName, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};

use super::client_ip::{ClientIpResolver, canonicalize_ip};
use crate::utils::future::BoxFuture;

#[derive(Clone)]
struct RateLimit {
    request_limit: usize,
    window: Duration,
    resolver: ClientIpResolver,
    windows: Arc<Mutex<HashMap<IpAddr, Window>>>,
}

struct Window {
    started: Instant,
    requests: usize,
}

type Middleware = BoxFuture<'static, Response>;

pub fn rate_limit_with_client_ip(
    request_limit: usize,
    window: Duration,
    resolver: ClientIpResolver,
) -> impl Fn(Request, Next) -> Middleware + Clone {
    let rate_limit = RateLimit::new(request_limit, window, resolver);
    move |request, next| {
        let rate_limit = rate_limit.clone();
        Box::pin(async move {
            if !rate_limit.reserve(rate_limit.key(&request)) {
                return too_many_requests();
            }
            next.run(request).await
        })
    }
}

/// Limits per client address, counting only 401 responses to requests that present `credential_header`.
/// Requests without that header are neither counted nor blocked, so a full bucket cannot lock out
/// clients authenticating another way from the same address.
pub fn rate_limit_unauthorized(
    request_limit: usize,
    window: Duration,
    resolver: ClientIpResolver,
    credential_header: HeaderName,
) -> impl Fn(Request, Next) -> Middleware + Clone {
    let rate_limit = RateLimit::new(request_limit, window, resolver);
    move |request, next| {
        let rate_limit = rate_limit.clone();
        let credential_header = credential_header.clone();
        Box::pin(async move {
            if !request.headers().contains_key(&credential_header) {
                return next.run(request).await;
            }
            let key = rate_limit.key(&request);
            if !rate_limit.reserve(key) {
                return too_many_requests();
            }
            let response = next.run(request).await;
            if response.status() != StatusCode::UNAUTHORIZED {
                rate_limit.release(key);
            }
            response
        })
    }
}

fn too_many_requests() -> Response {
    (StatusCode::TOO_MANY_REQUESTS, "too many requests").into_response()
}

impl RateLimit {
    fn new(request_limit: usize, window: Duration, resolver: ClientIpResolver) -> Self {
        Self {
            request_limit,
            window,
            resolver,
            windows: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn key(&self, request: &Request) -> IpAddr {
        let remote = request
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|address| address.0.ip())
            .unwrap_or(IpAddr::from([0, 0, 0, 0]));
        canonicalize_ip(self.resolver.client_ip(remote, request.headers()))
    }

    /// Atomically takes one permit from the key's current window; false when the window is full.
    fn reserve(&self, key: IpAddr) -> bool {
        let now = Instant::now();
        let Ok(mut windows) = self.windows.lock() else {
            return false;
        };
        // ponytail: fixed windows allow edge bursts; replace with a sliding window only if these short auth limits prove insufficient.
        windows.retain(|_, value| now.duration_since(value.started) < self.window);
        let window = windows.entry(key).or_insert(Window {
            started: now,
            requests: 0,
        });
        if window.requests >= self.request_limit {
            return false;
        }
        window.requests += 1;
        true
    }

    fn release(&self, key: IpAddr) {
        if let Ok(mut windows) = self.windows.lock()
            && let Some(window) = windows.get_mut(&key)
        {
            window.requests = window.requests.saturating_sub(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;

    use axum::{
        Router,
        extract::connect_info::ConnectInfo,
        http::{HeaderName, HeaderValue, Request as HttpRequest, StatusCode},
        middleware,
        routing::get,
    };
    use tower::ServiceExt;

    use super::{rate_limit_unauthorized, rate_limit_with_client_ip};
    use crate::middleware::{client_ip::ClientIpResolver, logging::request_logger, security::security_headers};

    #[tokio::test]
    async fn unauthorized_limiter_counts_only_rejected_credential_requests() {
        let app = Router::new()
            .route("/ok", get(|| async { StatusCode::NO_CONTENT }))
            .route("/denied", get(|| async { StatusCode::UNAUTHORIZED }))
            .layer(middleware::from_fn(rate_limit_unauthorized(
                2,
                std::time::Duration::from_secs(60),
                ClientIpResolver::new(&[]).unwrap(),
                HeaderName::from_static("x-api-key"),
            )));
        let get = |uri: &str, key: bool| {
            let request = HttpRequest::builder().uri(uri);
            let request = if key { request.header("X-API-Key", "guess") } else { request };
            request.body(axum::body::Body::empty()).unwrap()
        };
        for _ in 0..3 {
            assert_eq!(
                app.clone().oneshot(get("/ok", true)).await.unwrap().status(),
                StatusCode::NO_CONTENT
            );
            assert_eq!(
                app.clone().oneshot(get("/denied", false)).await.unwrap().status(),
                StatusCode::UNAUTHORIZED
            );
        }
        for _ in 0..2 {
            assert_eq!(
                app.clone().oneshot(get("/denied", true)).await.unwrap().status(),
                StatusCode::UNAUTHORIZED
            );
        }
        assert_eq!(
            app.clone().oneshot(get("/denied", true)).await.unwrap().status(),
            StatusCode::TOO_MANY_REQUESTS
        );
        assert_eq!(
            app.clone().oneshot(get("/ok", true)).await.unwrap().status(),
            StatusCode::TOO_MANY_REQUESTS
        );
        assert_eq!(
            app.oneshot(get("/denied", false)).await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn concurrent_bursts_cannot_exceed_the_limit() {
        let app = Router::new()
            .route(
                "/",
                get(|| async {
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    StatusCode::UNAUTHORIZED
                }),
            )
            .layer(middleware::from_fn(rate_limit_unauthorized(
                3,
                std::time::Duration::from_secs(60),
                ClientIpResolver::new(&[]).unwrap(),
                HeaderName::from_static("x-api-key"),
            )));
        let requests = (0..10)
            .map(|_| {
                let app = app.clone();
                tokio::spawn(async move {
                    app.oneshot(
                        HttpRequest::builder()
                            .uri("/")
                            .header("X-API-Key", "guess")
                            .body(axum::body::Body::empty())
                            .unwrap(),
                    )
                    .await
                    .unwrap()
                    .status()
                })
            })
            .collect::<Vec<_>>();
        let mut statuses = Vec::new();
        for request in requests {
            statuses.push(request.await.unwrap());
        }
        assert_eq!(
            statuses
                .iter()
                .filter(|status| **status == StatusCode::UNAUTHORIZED)
                .count(),
            3
        );
        assert_eq!(
            statuses
                .iter()
                .filter(|status| **status == StatusCode::TOO_MANY_REQUESTS)
                .count(),
            7
        );
    }

    #[tokio::test]
    async fn limits_trusted_forwarded_clients_but_not_untrusted_headers() {
        let resolver = ClientIpResolver::new(&["10.0.0.0/24".to_owned()]).unwrap();
        let app = Router::new()
            .route("/", get(|| async { StatusCode::NO_CONTENT }))
            .layer(middleware::from_fn(rate_limit_with_client_ip(
                1,
                std::time::Duration::from_secs(60),
                resolver,
            )));
        let first = request("10.0.0.1:1", "198.51.100.25");
        let second = request("10.0.0.2:2", "198.51.100.25");
        assert_eq!(
            app.clone().oneshot(first).await.unwrap().status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            app.oneshot(second).await.unwrap().status(),
            StatusCode::TOO_MANY_REQUESTS
        );
    }

    #[tokio::test]
    async fn honors_runtime_proxy_updates_and_remote_ports_share_a_limit() {
        let resolver = ClientIpResolver::new(&[]).unwrap();
        resolver.set_trusted_proxy_cidrs(&["10.0.0.0/24".to_owned()]).unwrap();
        let app = Router::new()
            .route("/", get(|| async { StatusCode::NO_CONTENT }))
            .layer(middleware::from_fn(rate_limit_with_client_ip(
                1,
                std::time::Duration::from_secs(60),
                resolver,
            )));
        assert_eq!(
            app.clone()
                .oneshot(request("10.0.0.1:1", "198.51.100.25"))
                .await
                .unwrap()
                .status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            app.oneshot(request("10.0.0.2:2", "198.51.100.25"))
                .await
                .unwrap()
                .status(),
            StatusCode::TOO_MANY_REQUESTS
        );
    }

    #[tokio::test]
    async fn logger_and_security_headers_preserve_responses() {
        let app = Router::new()
            .route("/", get(|| async { StatusCode::ACCEPTED }))
            .layer(middleware::from_fn(security_headers(false, None)))
            .layer(middleware::from_fn(request_logger));
        let response = app
            .oneshot(HttpRequest::builder().uri("/").body(axum::body::Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        assert_eq!(response.headers()["x-frame-options"], "DENY");
        for name in ["x-content-type-options", "referrer-policy", "x-xss-protection"] {
            assert!(response.headers().contains_key(name));
        }
    }

    fn request(remote: &str, forwarded_for: &str) -> HttpRequest<axum::body::Body> {
        let mut request = HttpRequest::builder().uri("/").body(axum::body::Body::empty()).unwrap();
        request
            .headers_mut()
            .insert("X-Forwarded-For", HeaderValue::from_str(forwarded_for).unwrap());
        request
            .extensions_mut()
            .insert(ConnectInfo(remote.parse::<SocketAddr>().unwrap()));
        request
    }
}
