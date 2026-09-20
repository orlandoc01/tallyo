use std::borrow::Cow;

use axum::{
    body::Bytes,
    http::{StatusCode, Uri, header},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "web/dist/"]
struct Dist;

const IMMUTABLE: &str = "public, max-age=31536000, immutable";
const NO_CACHE: &str = "no-cache";

pub(super) async fn spa(uri: Uri) -> Response {
    serve::<Dist>(uri.path())
}

pub(super) fn serve<A: RustEmbed>(path: &str) -> Response {
    let requested = path.trim_start_matches('/');
    let (file, cache_control) = match A::get(requested).filter(|_| !requested.is_empty()) {
        Some(file) => (
            Some(file),
            if path.starts_with("/assets/") { IMMUTABLE } else { NO_CACHE },
        ),
        None => (A::get("index.html"), NO_CACHE),
    };
    let Some(file) = file else {
        return ([(header::CACHE_CONTROL, cache_control)], StatusCode::NOT_FOUND).into_response();
    };
    let body = match file.data {
        Cow::Borrowed(bytes) => Bytes::from_static(bytes),
        Cow::Owned(bytes) => Bytes::from(bytes),
    };
    (
        [
            (header::CACHE_CONTROL, cache_control),
            (header::CONTENT_TYPE, file.metadata.mimetype()),
        ],
        body,
    )
        .into_response()
}
