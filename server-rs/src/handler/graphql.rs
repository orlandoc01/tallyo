use std::time::Duration;

use async_graphql::{ErrorExtensionValues, ServerError};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse, rejection::GraphQLRejection};
use axum::{
    Extension, RequestExt,
    extract::{FromRequest, Request, State},
    response::{IntoResponse, Response},
};

use crate::{
    apierror::{Code, INTERNAL_MESSAGE},
    auth::Identity,
    graph::GraphSchema,
};

pub(super) const MAX_QUERY_BODY: usize = 1 << 20;
const QUERY_TIMEOUT: Duration = Duration::from_secs(55);

pub(super) async fn handler(
    State(schema): State<GraphSchema>,
    Extension(identity): Extension<Identity>,
    request: Request,
) -> Response {
    let request = match GraphQLRequest::<GraphQLRejection>::from_request(request.with_limited_body(), &()).await {
        Ok(request) => request.into_inner().data(identity),
        Err(rejection) => return rejection.into_response(),
    };
    let response = match tokio::time::timeout(QUERY_TIMEOUT, schema.execute(request)).await {
        Ok(response) => response,
        Err(_) => {
            tracing::error!(timeout = ?QUERY_TIMEOUT, "graphql request timed out");
            timed_out()
        }
    };
    GraphQLResponse::from(response).into_response()
}

fn timed_out() -> async_graphql::Response {
    let mut error = ServerError::new(INTERNAL_MESSAGE, None);
    let mut extensions = ErrorExtensionValues::default();
    extensions.set("code", Code::Internal.to_string());
    error.extensions = Some(extensions);
    async_graphql::Response::from_errors(vec![error])
}

#[cfg(test)]
mod tests {
    use super::timed_out;

    #[test]
    fn timeout_presents_a_single_internal_error() {
        let response = timed_out();
        assert_eq!(response.errors.len(), 1);
        assert_eq!(response.errors[0].message, "internal error");
        assert_eq!(
            response.errors[0].extensions.as_ref().unwrap().get("code").unwrap(),
            &async_graphql::Value::from("INTERNAL")
        );
    }
}
