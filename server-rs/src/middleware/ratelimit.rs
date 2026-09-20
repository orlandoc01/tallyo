use std::{
    collections::HashMap,
    future::Future,
    net::{IpAddr, SocketAddr},
    pin::Pin,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    extract::{Request, connect_info::ConnectInfo},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};

use super::client_ip::{ClientIpResolver, canonicalize_ip};

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

pub fn rate_limit_with_client_ip(
    request_limit: usize,
    window: Duration,
    resolver: ClientIpResolver,
) -> impl Fn(Request, Next) -> Pin<Box<dyn Future<Output = Response> + Send>> + Clone {
    let rate_limit = RateLimit {
        request_limit,
        window,
        resolver,
        windows: Arc::new(Mutex::new(HashMap::new())),
    };
    move |request, next| {
        let rate_limit = rate_limit.clone();
        Box::pin(async move {
            if rate_limit.permits(&request) {
                next.run(request).await
            } else {
                (StatusCode::TOO_MANY_REQUESTS, "too many requests").into_response()
            }
        })
    }
}

impl RateLimit {
    fn permits(&self, request: &Request) -> bool {
        let remote = request
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|address| address.0.ip())
            .unwrap_or(IpAddr::from([0, 0, 0, 0]));
        let key = canonicalize_ip(self.resolver.client_ip(remote, request.headers()));
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
        window.requests += 1;
        window.requests <= self.request_limit
    }
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;

    use axum::{
        Router,
        extract::connect_info::ConnectInfo,
        http::{HeaderValue, Request as HttpRequest, StatusCode},
        middleware,
        routing::get,
    };
    use tower::ServiceExt;

    use super::rate_limit_with_client_ip;
    use crate::middleware::{client_ip::ClientIpResolver, logging::request_logger, security::security_headers};

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
