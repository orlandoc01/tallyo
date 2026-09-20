mod payload;
mod schema;
mod server;
mod tools;

use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use anyhow::{Context, Result, anyhow, bail, ensure};
use axum::{
    Extension, Router,
    body::{Body, to_bytes},
    http::{HeaderValue, Request, Response, StatusCode, header},
};
use futures_util::StreamExt;
use serde_json::{Value, json};
use sqlx::SqlitePool;
use tower::ServiceExt;

use super::{Server, router};
use crate::{
    accounts::{EventBus, LinkService, PlaidClientFactory, SimpleFinService},
    admin::{Manager, Service as AdminService},
    apierror::ApiError,
    auth::{ALL_SCOPES, Identity, Scope},
    clients::simplefin::SimpleFinClient,
    config::{Authorization, Config},
    database::dbtest,
    graph::Resolver,
    ids::{GlobalId, GlobalIdType},
    transactions::Syncer,
    wealth::{ManualSyncAdapter, WealthService},
};

pub(super) async fn server() -> Result<(SqlitePool, Server)> {
    let pool = dbtest::open().await?;
    Ok((
        pool.clone(),
        Server {
            resolver: resolver(pool),
        },
    ))
}

// Mirrors graph::tests::resolver: every domain handle over one in-memory database.
fn resolver(pool: SqlitePool) -> Resolver {
    let events = EventBus::default();
    let syncer = Arc::new(Syncer::new(pool.clone(), Vec::new()));
    let manager = Arc::new(Manager::new(pool.clone()));
    Resolver {
        wealth: Arc::new(WealthService::new(pool.clone(), None, || "UTC".to_owned())),
        linker: Arc::new(LinkService {
            pool: pool.clone(),
            clients: Arc::new(PlaidClientFactory::new(pool.clone())),
            syncer: syncer.clone(),
            events: events.clone(),
        }),
        simplefin: Arc::new(SimpleFinService {
            pool: pool.clone(),
            client: SimpleFinClient::new().unwrap(),
            events,
        }),
        admin: Arc::new(AdminService::new(pool.clone(), manager)),
        syncer,
        manual_snapshots: Arc::new(ManualSyncAdapter::new(pool.clone()).unwrap()),
        config: Arc::new(Config {
            config_file_path: None,
            db_path: PathBuf::from("/tmp/tallyo.db"),
            db_encryption_key: None,
            port: 8080,
            sync_off: false,
            authorization: Authorization {
                disable_all_auth: false,
                master_password: None,
            },
        }),
        pool,
    }
}

pub(super) fn identity(scopes: &[Scope]) -> Identity {
    Identity::with_scopes(scopes.to_vec())
}

pub(super) fn all_scopes() -> Identity {
    identity(ALL_SCOPES)
}

pub(super) fn global_id(typ: GlobalIdType, id: i64) -> String {
    GlobalId::new(typ, id).encoded_string()
}

pub(super) fn api_error(error: &anyhow::Error) -> &ApiError {
    error
        .chain()
        .find_map(|cause| cause.downcast_ref::<ApiError>())
        .unwrap_or_else(|| panic!("not an ApiError: {error:?}"))
}

/// Drives the streamable HTTP router the way an MCP client does, with the identity the auth
/// middleware would have attached to the request.
pub(super) struct Client {
    router: Router,
    session: Option<HeaderValue>,
    next_id: AtomicU64,
}

impl Client {
    pub(super) async fn connect(server: Server, identity: Option<Identity>) -> Result<Self> {
        let router = router(server);
        let router = match identity {
            Some(identity) => router.layer(Extension(identity)),
            None => router,
        };
        let mut client = Self {
            router,
            session: None,
            next_id: AtomicU64::new(1),
        };
        let response = client
            .post(json!({
                "jsonrpc": "2.0",
                "id": 0,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "test", "version": "0.0.0"}
                }
            }))
            .await?;
        if response.status() != StatusCode::OK {
            let status = response.status();
            let body = to_bytes(response.into_body(), usize::MAX).await?;
            bail!("initialize: {status}: {}", String::from_utf8_lossy(&body));
        }
        client.session = Some(
            response
                .headers()
                .get("mcp-session-id")
                .cloned()
                .context("initialize response lacks Mcp-Session-Id")?,
        );
        message(response).await?;
        let response = client
            .post(json!({"jsonrpc": "2.0", "method": "notifications/initialized"}))
            .await?;
        ensure!(
            response.status() == StatusCode::ACCEPTED,
            "initialized: {}",
            response.status()
        );
        Ok(client)
    }

    async fn post(&self, body: Value) -> Result<Response<Body>> {
        let mut request = Request::post("/mcp")
            .header(header::HOST, "tallyo.example")
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::ACCEPT, "application/json, text/event-stream");
        if let Some(session) = &self.session {
            request = request.header("mcp-session-id", session.clone());
        }
        Ok(self
            .router
            .clone()
            .oneshot(request.body(Body::from(body.to_string()))?)
            .await?)
    }

    pub(super) async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let response = self
            .post(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}))
            .await?;
        ensure!(response.status() == StatusCode::OK, "{method}: {}", response.status());
        let mut message = message(response).await?;
        match message.get_mut("result") {
            Some(result) => Ok(result.take()),
            None => Err(anyhow!("jsonrpc error: {message}")),
        }
    }

    pub(super) async fn call(&self, tool: &str, arguments: Value) -> Result<Value> {
        self.request("tools/call", json!({"name": tool, "arguments": arguments}))
            .await
    }
}

async fn message(response: Response<Body>) -> Result<Value> {
    let json = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("application/json"));
    if json {
        return Ok(serde_json::from_slice(
            &to_bytes(response.into_body(), usize::MAX).await?,
        )?);
    }
    let mut stream = response.into_body().into_data_stream();
    let mut buffer = String::new();
    while let Some(chunk) = stream.next().await {
        buffer.push_str(std::str::from_utf8(&chunk?)?);
        while let Some(end) = buffer.find('\n') {
            let line = buffer[..end].trim().to_owned();
            buffer.drain(..=end);
            // Priming events carry an empty data line.
            if let Some(data) = line
                .strip_prefix("data:")
                .map(str::trim)
                .filter(|data| !data.is_empty())
            {
                let value: Value = serde_json::from_str(data)?;
                if value.get("result").is_some() || value.get("error").is_some() {
                    return Ok(value);
                }
            }
        }
    }
    bail!("stream ended without a JSON-RPC response")
}

pub(super) fn text(result: &Value) -> &str {
    result["content"][0]["text"].as_str().unwrap_or_default()
}

pub(super) fn is_error(result: &Value) -> bool {
    result["isError"].as_bool().unwrap_or_default()
}
