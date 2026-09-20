mod projections;
mod projections_analysis;
mod projections_budget;
mod projections_networth;
mod projections_plaid;
mod projections_rules;
mod projections_spending;
mod projections_transactions;
mod tools;

use std::{any::Any, panic::AssertUnwindSafe, sync::Arc, time::Duration};

use axum::{
    Router,
    extract::Request,
    http::{HeaderValue, Method, StatusCode, header, request::Parts},
    middleware::{self, Next},
    response::{IntoResponse, Response},
};
use futures_util::FutureExt;
use rmcp::{
    ErrorData, ServerHandler,
    model::{
        CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, Implementation, ListToolsResult,
        PaginatedRequestParams, ServerCapabilities, ServerInfo,
    },
    service::{RequestContext, RoleServer},
    transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
    },
};
use serde_json::{Map, Value};

use crate::{
    apierror::{ApiError, INTERNAL_MESSAGE},
    auth::{self, Identity},
    graph::{Resolver, operation_scope, require_scope},
};
use tools::{TOOLS, ToolOutput, ToolSpec};

const INSTRUCTIONS: &str = "Personal finance tracker for a household. Amounts are USD; positive means money spent, negative means refund or credit. Spending reports exclude transfers and income unless a tool description says otherwise.";
const ALLOWED_ORIGIN: &str = "https://claude.ai";
const SESSION_IDLE_TTL: Duration = Duration::from_secs(30 * 60);

#[derive(Clone)]
pub struct Server {
    pub resolver: Resolver,
}

impl ServerHandler for Server {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("Tallyo", "1.0.0"))
            .with_instructions(INSTRUCTIONS)
    }

    async fn list_tools(
        &self,
        _: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(
            TOOLS.iter().map(ToolSpec::definition).collect(),
        ))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let spec = TOOLS
            .iter()
            .find(|spec| spec.name == request.name)
            .ok_or_else(|| ErrorData::invalid_params(format!("unknown tool: {}", request.name), None))?;
        let arguments = request
            .arguments
            .map_or_else(|| Value::Object(Map::new()), Value::Object);
        Ok(self.call(spec, identity(&context), arguments).await.into())
    }
}

impl Server {
    // Go's addTool wrapper: scope check before binding, public errors verbatim, everything else masked.
    async fn call(&self, spec: &ToolSpec, identity: Option<&Identity>, arguments: Value) -> CallToolResult {
        let granted =
            operation_scope(spec.operation(), spec.operation_name).and_then(|scope| require_scope(identity, scope));
        let identity = match granted {
            Ok(identity) => identity,
            Err(error) => return tool_error(spec.name, error.into()),
        };
        match AssertUnwindSafe((spec.call)(self, identity, arguments))
            .catch_unwind()
            .await
        {
            Ok(Ok(output)) => tool_result(output),
            Ok(Err(error)) => tool_error(spec.name, error),
            Err(panic) => {
                tracing::error!(tool = spec.name, panic = panic_message(&*panic), "mcp tool panic");
                error_result(INTERNAL_MESSAGE)
            }
        }
    }
}

fn identity(context: &RequestContext<RoleServer>) -> Option<&Identity> {
    context
        .extensions
        .get::<Parts>()
        .and_then(|parts| auth::identity(&parts.extensions))
}

fn tool_result(output: ToolOutput) -> CallToolResult {
    let ToolOutput { value, summary } = output;
    let text = if summary.is_empty() { value.to_string() } else { format!("{summary}\n{value}") };
    let mut result = CallToolResult::structured(value);
    result.content = vec![ContentBlock::text(text)];
    result
}

fn tool_error(tool: &str, error: anyhow::Error) -> CallToolResult {
    match error.chain().find_map(|cause| cause.downcast_ref::<ApiError>()) {
        Some(public) => error_result(public.message.clone()),
        None => {
            tracing::error!(tool, error = ?error, "mcp tool error");
            error_result(INTERNAL_MESSAGE)
        }
    }
}

fn error_result(message: impl Into<String>) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(message)])
}

fn panic_message(panic: &(dyn Any + Send)) -> &str {
    panic
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| panic.downcast_ref::<String>().map(String::as_str))
        .unwrap_or("unknown panic")
}

/// Streamable HTTP MCP endpoint at `/mcp`; auth, the enable switch and the body cap are mounted in front of it.
pub fn router(server: Server) -> Router {
    let mut sessions = LocalSessionManager::default();
    sessions.session_config.keep_alive = Some(SESSION_IDLE_TTL);
    // rmcp only accepts loopback Host headers by default; the reverse proxy forwards the public host.
    let config = StreamableHttpServerConfig::default().disable_allowed_hosts();
    let service = StreamableHttpService::new(move || Ok(server.clone()), Arc::new(sessions), config);
    Router::new()
        .route_service("/mcp", service)
        .layer(middleware::from_fn(cors))
}

async fn cors(request: Request, next: Next) -> Response {
    let allowed = request
        .headers()
        .get(header::ORIGIN)
        .is_some_and(|origin| origin == ALLOWED_ORIGIN);
    let preflight =
        request.method() == Method::OPTIONS && request.headers().contains_key(header::ACCESS_CONTROL_REQUEST_METHOD);
    let mut response = if preflight { StatusCode::NO_CONTENT.into_response() } else { next.run(request).await };
    let headers = response.headers_mut();
    headers.append(header::VARY, HeaderValue::from_static("Origin"));
    if allowed {
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_static(ALLOWED_ORIGIN),
        );
        headers.insert(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            HeaderValue::from_static("Mcp-Session-Id"),
        );
    }
    if preflight {
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, POST, DELETE, OPTIONS"),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("Content-Type, Mcp-Session-Id, Last-Event-ID, Authorization"),
        );
    }
    response
}

#[cfg(test)]
mod tests;
