use axum::{
    Json,
    extract::{
        State,
        multipart::{Multipart, MultipartRejection},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use sqlx::SqlitePool;

use crate::transactions::{parse_import_csv, store::import_transactions};

pub(super) const MAX_IMPORT_BODY: usize = 10 << 20;
const INVALID_FORM: &str = "invalid multipart form or file too large";

pub(super) async fn handler(
    State(pool): State<SqlitePool>,
    multipart: Result<Multipart, MultipartRejection>,
) -> Response {
    let Ok(mut multipart) = multipart else {
        return (StatusCode::BAD_REQUEST, INVALID_FORM).into_response();
    };
    let file = loop {
        match multipart.next_field().await {
            Ok(Some(field)) if field.name() == Some("file") => break field,
            Ok(Some(_)) => {}
            Ok(None) => return (StatusCode::BAD_REQUEST, "missing file field").into_response(),
            Err(_) => return (StatusCode::BAD_REQUEST, INVALID_FORM).into_response(),
        }
    };
    let Ok(content) = file.bytes().await else {
        return (StatusCode::BAD_REQUEST, INVALID_FORM).into_response();
    };
    let (rows, parse_errors) = match parse_import_csv(content.as_ref()) {
        Ok(parsed) => parsed,
        Err(error) => return (StatusCode::BAD_REQUEST, format!("csv parse error: {error:#}")).into_response(),
    };
    let mut result = match import_transactions(&pool, &rows).await {
        Ok(result) => result,
        Err(error) => {
            tracing::error!(%error, "import transactions failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, "import failed").into_response();
        }
    };
    // Parse errors go first so row numbers align with the original file.
    result.skipped += parse_errors.len();
    result.errors = parse_errors.into_iter().chain(result.errors).collect();
    Json(result).into_response()
}
