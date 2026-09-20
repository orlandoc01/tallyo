mod export;
mod graphql;
mod import;
mod web;

#[cfg(test)]
mod tests;

use std::sync::Arc;

use async_graphql::http::{GraphQLPlaygroundConfig, playground_source};
use axum::{
    Router,
    extract::{DefaultBodyLimit, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};

use crate::{
    admin::runtimeconfig::Manager,
    auth::{self, Scope, Service, dev_cors, protect, protect_mcp},
    graph::{self, Resolver},
    middleware::{logging::request_logger, security::security_headers},
    utils::future::BoxFuture,
};

const CSP: &str = "default-src 'self'; script-src 'self' https://cdn.plaid.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.plaid.com https://icons.duckduckgo.com; connect-src 'self' https://*.plaid.com; frame-src https://*.plaid.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'";
const MAX_MCP_BODY: usize = 1 << 20;

pub struct Config {
    pub auth: Arc<Service>,
    pub resolver: Resolver,
    pub runtime: Arc<Manager>,
    pub mcp: Router,
}

pub fn router(config: Config) -> Router {
    let auth = config.auth;
    let https = auth.issuer_url().starts_with("https://");
    Router::new()
        .route("/healthz", get(|| async { StatusCode::NO_CONTENT }))
        .merge(auth::router(Arc::clone(&auth)))
        .merge(
            config
                .mcp
                .route_layer(middleware::from_fn(dynamic_mcp(Arc::clone(&auth), config.runtime)))
                .route_layer(DefaultBodyLimit::max(MAX_MCP_BODY)),
        )
        .merge(protected_routes(Arc::clone(&auth), config.resolver))
        .fallback(web::spa)
        // axum runs the last layer first, so Go's logger → security headers → CORS order is added in reverse
        .layer(middleware::from_fn_with_state(auth, dev_cors))
        .layer(middleware::from_fn(security_headers(https, Some(CSP.to_owned()))))
        .layer(middleware::from_fn(request_logger))
}

fn protected_routes(auth: Arc<Service>, resolver: Resolver) -> Router {
    Router::new()
        .route(
            "/transactions/export",
            get(export::handler).route_layer(middleware::from_fn(require_scope(Scope::ReadTransactions))),
        )
        .route(
            "/transactions/import",
            post(import::handler)
                .route_layer(middleware::from_fn(require_scope(Scope::WriteTransactions)))
                .route_layer(DefaultBodyLimit::max(import::MAX_IMPORT_BODY)),
        )
        .with_state(resolver.pool.clone())
        .route(
            "/query",
            get(graphql::handler)
                .post(graphql::handler)
                .route_layer(DefaultBodyLimit::max(graphql::MAX_QUERY_BODY)),
        )
        .with_state(graph::build_schema(resolver))
        .route("/playground", get(playground))
        .route_layer(middleware::from_fn_with_state(auth, protect))
}

async fn playground() -> Html<String> {
    Html(playground_source(
        GraphQLPlaygroundConfig::new("/query").title("Tallyo GraphQL"),
    ))
}

fn require_scope(scope: Scope) -> impl Fn(Request, Next) -> BoxFuture<'static, Response> + Clone {
    move |request, next| {
        Box::pin(async move {
            match auth::identity(request.extensions()) {
                Some(identity) if identity.has_scope(scope) => next.run(request).await,
                _ => (StatusCode::FORBIDDEN, "forbidden").into_response(),
            }
        })
    }
}

fn dynamic_mcp(
    auth: Arc<Service>,
    runtime: Arc<Manager>,
) -> impl Fn(Request, Next) -> BoxFuture<'static, Response> + Clone {
    move |request, next| {
        let auth = Arc::clone(&auth);
        let runtime = Arc::clone(&runtime);
        Box::pin(async move {
            if !runtime.sections().mcp.enabled {
                StatusCode::NOT_FOUND.into_response()
            } else if !auth.oauth_enabled() {
                protect(State(auth), request, next).await
            } else {
                protect_mcp(State(auth), request, next).await
            }
        })
    }
}
