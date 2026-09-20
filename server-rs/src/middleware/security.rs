use std::{future::Future, pin::Pin};

use axum::{
    extract::Request,
    http::header::{CONTENT_SECURITY_POLICY, HeaderName, HeaderValue, REFERRER_POLICY, STRICT_TRANSPORT_SECURITY},
    middleware::Next,
    response::Response,
};

const X_FRAME_OPTIONS: HeaderName = HeaderName::from_static("x-frame-options");
const X_CONTENT_TYPE_OPTIONS: HeaderName = HeaderName::from_static("x-content-type-options");
const X_XSS_PROTECTION: HeaderName = HeaderName::from_static("x-xss-protection");

pub fn security_headers(
    enable_hsts: bool,
    csp: Option<String>,
) -> impl Fn(Request, Next) -> Pin<Box<dyn Future<Output = Response> + Send>> + Clone {
    let csp = csp.and_then(|value| match HeaderValue::from_str(&value) {
        Ok(value) => Some(value),
        Err(error) => {
            tracing::warn!(%error, "invalid Content-Security-Policy header");
            None
        }
    });
    move |request, next| {
        let csp = csp.clone();
        Box::pin(async move {
            let mut response = next.run(request).await;
            let headers = response.headers_mut();
            headers.insert(X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
            headers.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
            headers.insert(
                REFERRER_POLICY,
                HeaderValue::from_static("strict-origin-when-cross-origin"),
            );
            headers.insert(X_XSS_PROTECTION, HeaderValue::from_static("0"));
            if enable_hsts {
                headers.insert(
                    STRICT_TRANSPORT_SECURITY,
                    HeaderValue::from_static("max-age=63072000; includeSubDomains"),
                );
            }
            if let Some(csp) = csp {
                headers.insert(CONTENT_SECURITY_POLICY, csp);
            }
            response
        })
    }
}
