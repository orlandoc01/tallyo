use anyhow::Result;
use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use rmcp::ServerHandler;
use tower::ServiceExt;

use super::{Client, all_scopes, server};
use crate::mcpserver::{ALLOWED_ORIGIN, INSTRUCTIONS, router};

#[tokio::test]
async fn router_serves_mcp() -> Result<()> {
    let (_, server) = server().await?;
    let response = router(server.clone())
        .oneshot(Request::post("/mcp").body(Body::empty())?)
        .await?;
    assert_ne!(response.status(), StatusCode::NOT_FOUND);

    let client = Client::connect(server, Some(all_scopes())).await?;
    let tools = client.request("tools/list", serde_json::json!({})).await?;
    assert_eq!(tools["tools"].as_array().map(Vec::len), Some(26));
    Ok(())
}

#[tokio::test]
async fn get_info_matches_go() -> Result<()> {
    let (_, server) = server().await?;
    let info = server.get_info();
    assert_eq!(info.server_info.name, "Tallyo");
    assert_eq!(info.server_info.version, "1.0.0");
    assert_eq!(info.instructions.as_deref(), Some(INSTRUCTIONS));
    assert!(info.capabilities.tools.is_some());
    Ok(())
}

#[tokio::test]
async fn cors_headers_match_mcp_go_for_claude() -> Result<()> {
    let (_, server) = server().await?;
    let app = router(server);

    let preflight = app
        .clone()
        .oneshot(
            Request::options("/mcp")
                .header(header::ORIGIN, ALLOWED_ORIGIN)
                .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(preflight.status(), StatusCode::NO_CONTENT);
    let headers = preflight.headers();
    assert_eq!(headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], ALLOWED_ORIGIN);
    assert_eq!(headers[header::ACCESS_CONTROL_EXPOSE_HEADERS], "Mcp-Session-Id");
    assert_eq!(
        headers[header::ACCESS_CONTROL_ALLOW_METHODS],
        "GET, POST, DELETE, OPTIONS"
    );
    assert_eq!(
        headers[header::ACCESS_CONTROL_ALLOW_HEADERS],
        "Content-Type, Mcp-Session-Id, Last-Event-ID, Authorization"
    );
    assert_eq!(headers[header::VARY], "Origin");

    let simple = app
        .clone()
        .oneshot(
            Request::post("/mcp")
                .header(header::ORIGIN, ALLOWED_ORIGIN)
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(simple.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], ALLOWED_ORIGIN);
    assert_eq!(simple.headers()[header::VARY], "Origin");

    let other = app
        .oneshot(
            Request::post("/mcp")
                .header(header::ORIGIN, "https://evil.example")
                .body(Body::empty())?,
        )
        .await?;
    assert!(!other.headers().contains_key(header::ACCESS_CONTROL_ALLOW_ORIGIN));
    assert_eq!(other.headers()[header::VARY], "Origin");
    Ok(())
}
