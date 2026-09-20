use std::{
    any::Any,
    panic::AssertUnwindSafe,
    sync::{Arc, Mutex, PoisonError},
    time::Instant,
};

use async_graphql::{
    ErrorExtensionValues, Request, Response, ServerError, ServerResult, Variables,
    extensions::{
        Extension, ExtensionContext, ExtensionFactory, NextExecute, NextParseQuery, NextPrepareRequest, NextRequest,
    },
    parser::types::{ExecutableDocument, OperationType},
};
use futures_util::FutureExt;

use super::{Loaders, Resolver};
use crate::apierror::{ApiError, Code, INTERNAL_MESSAGE};

pub(super) const INVALID_REQUEST: &str = "invalid GraphQL request";
const INPUT_PARSE_PREFIX: &str = "Failed to parse \"";

pub(super) struct GraphExtension;

impl ExtensionFactory for GraphExtension {
    fn create(&self) -> Arc<dyn Extension> {
        Arc::new(RequestExtension::default())
    }
}

#[derive(Default)]
struct RequestExtension {
    operation: Mutex<Operation>,
}

#[derive(Default)]
struct Operation {
    name: Option<String>,
    definitions: Vec<(Option<String>, OperationType)>,
}

impl Operation {
    fn kind(&self) -> String {
        self.definitions
            .iter()
            .find(|(name, _)| self.name.is_none() || *name == self.name)
            .map(|(_, kind)| kind.to_string())
            .unwrap_or_default()
    }
}

#[async_graphql::async_trait::async_trait]
impl Extension for RequestExtension {
    async fn request(&self, ctx: &ExtensionContext<'_>, next: NextRequest<'_>) -> Response {
        let start = Instant::now();
        let response = match AssertUnwindSafe(next.run(ctx)).catch_unwind().await {
            Ok(mut response) => {
                response.errors.iter_mut().for_each(present);
                response
            }
            Err(panic) => {
                tracing::error!(panic = panic_message(&*panic), "graphql panic");
                Response::from_errors(vec![internal_error()])
            }
        };
        let operation = self.operation.lock().unwrap_or_else(PoisonError::into_inner);
        let name = operation.name.as_deref().unwrap_or_default();
        let kind = operation.kind();
        let duration = start.elapsed();
        if response.errors.is_empty() {
            tracing::info!(operation = name, r#type = kind, ?duration, "graphql operation");
        } else {
            tracing::error!(operation = name, r#type = kind, ?duration, errors = ?response.errors, "graphql operation");
        }
        response
    }

    async fn prepare_request(
        &self,
        ctx: &ExtensionContext<'_>,
        request: Request,
        next: NextPrepareRequest<'_>,
    ) -> ServerResult<Request> {
        let resolver = ctx.data_unchecked::<Resolver>();
        next.run(ctx, request.data(Loaders::new(resolver))).await
    }

    async fn parse_query(
        &self,
        ctx: &ExtensionContext<'_>,
        query: &str,
        variables: &Variables,
        next: NextParseQuery<'_>,
    ) -> ServerResult<ExecutableDocument> {
        let document = next.run(ctx, query, variables).await?;
        self.operation
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .definitions = document
            .operations
            .iter()
            .map(|(name, operation)| (name.map(|name| name.to_string()), operation.node.ty))
            .collect();
        Ok(document)
    }

    async fn execute(
        &self,
        ctx: &ExtensionContext<'_>,
        operation_name: Option<&str>,
        next: NextExecute<'_>,
    ) -> Response {
        self.operation.lock().unwrap_or_else(PoisonError::into_inner).name = operation_name.map(str::to_owned);
        next.run(ctx, operation_name).await
    }
}

fn present(error: &mut ServerError) {
    if let Some(api_error) = error.source.as_deref().and_then(api_error) {
        error.message = api_error.message.clone();
        return set_code(error, api_error.code);
    }
    if error.source.is_none() && error.path.is_empty() {
        error.message = INVALID_REQUEST.to_owned();
        return set_code(error, Code::BadUserInput);
    }
    // Input coercion failures carry no source; their message only ever wraps our own scalar errors.
    if error.source.is_none() && error.message.starts_with(INPUT_PARSE_PREFIX) {
        return set_code(error, Code::BadUserInput);
    }
    tracing::error!(path = ?error.path, error = %error.message, "graphql error");
    error.message = INTERNAL_MESSAGE.to_owned();
    set_code(error, Code::Internal);
}

fn api_error(source: &(dyn Any + Send + Sync)) -> Option<&ApiError> {
    source.downcast_ref::<ApiError>().or_else(|| {
        source
            .downcast_ref::<anyhow::Error>()
            .and_then(|error| error.chain().find_map(|cause| cause.downcast_ref::<ApiError>()))
    })
}

fn set_code(error: &mut ServerError, code: Code) {
    let mut extensions = ErrorExtensionValues::default();
    extensions.set("code", code.to_string());
    error.extensions = Some(extensions);
}

fn internal_error() -> ServerError {
    let mut error = ServerError::new(INTERNAL_MESSAGE, None);
    set_code(&mut error, Code::Internal);
    error
}

fn panic_message(panic: &(dyn Any + Send)) -> &str {
    panic
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| panic.downcast_ref::<String>().map(String::as_str))
        .unwrap_or("unknown panic")
}

#[cfg(test)]
mod tests {
    use async_graphql::{EmptyMutation, EmptySubscription, Object, PathSegment, Schema, ServerError};

    use super::{GraphExtension, INVALID_REQUEST, api_error, present};
    use crate::apierror::{ApiError, Code, INTERNAL_MESSAGE};

    struct Probe;

    #[Object]
    impl Probe {
        async fn boom(&self) -> bool {
            if std::hint::black_box(true) {
                panic!("resolver exploded");
            }
            false
        }

        async fn value(&self) -> bool {
            true
        }
    }

    fn code(error: &ServerError) -> String {
        error.extensions.as_ref().unwrap().get("code").unwrap().to_string()
    }

    #[test]
    fn presents_errors_by_source_and_shape() {
        let mut public = ServerError::new("leaked", None);
        public.path = vec![PathSegment::Field("field".into())];
        public.source = Some(std::sync::Arc::new(
            anyhow::Error::new(ApiError::bad_input("date must use YYYY-MM-DD")).context("wrapped"),
        ));
        present(&mut public);
        assert_eq!(
            (public.message.as_str(), code(&public).as_str()),
            ("date must use YYYY-MM-DD", "\"BAD_USER_INPUT\"")
        );

        let mut direct = ServerError::new("leaked", None);
        direct.source = Some(std::sync::Arc::new(ApiError::new("nope", Code::Forbidden)));
        present(&mut direct);
        assert_eq!(
            (direct.message.as_str(), code(&direct).as_str()),
            ("nope", "\"FORBIDDEN\"")
        );

        let mut validation = ServerError::new(
            "Cannot query field \"bogus\" on type \"Query\". Did you mean \"budgets\"?",
            None,
        );
        present(&mut validation);
        assert_eq!(
            (validation.message.as_str(), code(&validation).as_str()),
            (INVALID_REQUEST, "\"BAD_USER_INPUT\"")
        );

        let mut internal = ServerError::new("SELECT private_key_pem FROM signing_keys", None);
        internal.path = vec![PathSegment::Field("someField".into())];
        present(&mut internal);
        assert_eq!(
            (internal.message.as_str(), code(&internal).as_str()),
            (INTERNAL_MESSAGE, "\"INTERNAL\"")
        );

        let mut sourced = ServerError::new("SELECT private_key_pem FROM signing_keys secret-token", None);
        sourced.source = Some(std::sync::Arc::new(anyhow::anyhow!("secret-token")));
        present(&mut sourced);
        assert_eq!(
            (sourced.message.as_str(), code(&sourced).as_str()),
            (INTERNAL_MESSAGE, "\"INTERNAL\"")
        );

        let mut coercion = ServerError::new("Failed to parse \"Money\": money must be finite", None);
        coercion.path = vec![PathSegment::Field("createTransaction".into())];
        present(&mut coercion);
        assert_eq!(coercion.message, "Failed to parse \"Money\": money must be finite");
        assert_eq!(code(&coercion), "\"BAD_USER_INPUT\"");

        assert!(api_error(&anyhow::anyhow!("plain")).is_none());
    }

    #[tokio::test]
    async fn panics_become_a_single_internal_error() {
        let schema = Schema::build(Probe, EmptyMutation, EmptySubscription)
            .data(crate::graph::tests::resolver(
                crate::database::dbtest::open().await.unwrap(),
            ))
            .extension(GraphExtension)
            .finish();
        let response = schema.execute("{ value boom }").await;
        assert_eq!(response.data, async_graphql::Value::Null);
        assert_eq!(response.errors.len(), 1);
        assert_eq!(response.errors[0].message, INTERNAL_MESSAGE);
        assert_eq!(code(&response.errors[0]), "\"INTERNAL\"");
        assert!(serde_json::to_string(&response).unwrap().contains("\"errors\""));

        let response = schema.execute("query Named { value }").await;
        assert!(response.errors.is_empty());
        assert_eq!(response.data.to_string(), "{value: true}");
    }
}
