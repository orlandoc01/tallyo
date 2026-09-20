use std::time::Instant;

use axum::{extract::Request, middleware::Next, response::Response};

pub async fn request_logger(request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let started = Instant::now();
    let response = next.run(request).await;
    tracing::info!(%method, %path, status = %response.status(), duration = ?started.elapsed(), "http request");
    response
}
