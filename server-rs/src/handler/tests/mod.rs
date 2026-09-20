use std::{path::PathBuf, sync::Arc};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, Response, StatusCode, request::Builder},
    routing::any,
};
use rust_embed::RustEmbed;
use serde_json::{Value, json};
use sqlx::SqlitePool;
use tower::ServiceExt;

use super::{Config, router, web::serve};
use crate::{
    accounts::{EventBus, LinkService, PlaidClientFactory, SimpleFinService},
    admin::{Manager, McpConfig, Patch, SectionPatch, Service as AdminService, store as admin_store},
    auth::{ALL_SCOPES, AuthSettings, Config as AuthConfig, Scope, Service},
    clients::simplefin::SimpleFinClient,
    config::{Authorization, Config as AppConfig},
    database::dbtest,
    graph::Resolver,
    middleware::client_ip::ClientIpResolver,
    money::Cents,
    testutil::transactions::{account, transaction},
    transactions::Syncer,
    wealth::{ManualSyncAdapter, WealthService},
};

const ISSUER: &str = "https://tallyo.test";
const ORIGIN: &str = "https://web.test";
const OWNERS_QUERY: &str = "{ owners { items { name } } }";
const IMPORT_CSV: &str =
    "account_id,datetime,amount,merchant_name\nacc-1,2026-05-01,12.34,Coffee\n,2026-05-01,1,Shop\n";

#[derive(RustEmbed)]
#[folder = "src/handler/tests/dist/"]
struct TestDist;

struct Settings {
    issuer_url: &'static str,
    oauth_enabled: bool,
    mcp_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            issuer_url: ISSUER,
            oauth_enabled: true,
            mcp_enabled: true,
        }
    }
}

struct Fixture {
    pool: SqlitePool,
    auth: Arc<Service>,
    router: Router,
}

impl Fixture {
    async fn new(settings: Settings) -> Self {
        let pool = dbtest::open().await.unwrap();
        let auth = Arc::new(
            Service::new(
                AuthConfig::new(
                    AuthSettings {
                        issuer_url: settings.issuer_url.to_owned(),
                        oauth_enabled: settings.oauth_enabled,
                        frontend_redirect_uris: vec![format!("{ORIGIN}/callback")],
                        dev_cors_allowed_origins: vec![ORIGIN.to_owned()],
                        ..Default::default()
                    },
                    ClientIpResolver::new(&[]).unwrap(),
                ),
                pool.clone(),
            )
            .await
            .unwrap(),
        );
        admin_store::save_sections(
            &pool,
            &Patch {
                mcp: Some(SectionPatch {
                    enabled: settings.mcp_enabled,
                    fields: McpConfig::default(),
                }),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let runtime = Arc::new(Manager::new(pool.clone()));
        runtime.load(false, false).await.unwrap();
        let router = router(Config {
            auth: Arc::clone(&auth),
            resolver: resolver(pool.clone()),
            runtime,
            mcp: Router::new().route("/mcp", any(|| async { StatusCode::OK })),
        });
        Self { pool, auth, router }
    }

    fn token(&self, scopes: &[Scope]) -> String {
        self.auth
            .mint_access_token("person@example.com", scopes, "UTC")
            .unwrap()
    }

    fn authorized(&self, request: Builder, scopes: &[Scope]) -> Builder {
        request.header("Authorization", format!("Bearer {}", self.token(scopes)))
    }

    async fn send(&self, request: Builder) -> Response<Body> {
        self.send_body(request, Body::empty()).await
    }

    async fn send_body(&self, request: Builder, body: impl Into<Body>) -> Response<Body> {
        self.router
            .clone()
            .oneshot(request.body(body.into()).unwrap())
            .await
            .unwrap()
    }
}

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
        config: Arc::new(AppConfig {
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

fn get(path: &str) -> Builder {
    Request::builder().uri(path)
}

fn post(path: &str) -> Builder {
    Request::builder().method("POST").uri(path)
}

async fn text(response: Response<Body>) -> String {
    String::from_utf8(to_bytes(response.into_body(), usize::MAX).await.unwrap().to_vec()).unwrap()
}

async fn json_body(response: Response<Body>) -> Value {
    serde_json::from_str(&text(response).await).unwrap()
}

fn header<'a>(response: &'a Response<Body>, name: &str) -> &'a str {
    response.headers()[name].to_str().unwrap()
}

fn multipart(field: &str, content: &str) -> (&'static str, String) {
    (
        "multipart/form-data; boundary=boundary",
        format!(
            "--boundary\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"import.csv\"\r\nContent-Type: text/csv\r\n\r\n{content}\r\n--boundary--\r\n"
        ),
    )
}

#[tokio::test]
async fn healthz_carries_the_global_middleware_headers() {
    let fixture = Fixture::new(Settings::default()).await;
    let response = fixture.send(get("/healthz").header("Origin", ORIGIN)).await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(header(&response, "x-frame-options"), "DENY");
    assert_eq!(header(&response, "x-content-type-options"), "nosniff");
    assert_eq!(
        header(&response, "strict-transport-security"),
        "max-age=63072000; includeSubDomains"
    );
    assert!(
        header(&response, "content-security-policy")
            .starts_with("default-src 'self'; script-src 'self' https://cdn.plaid.com;")
    );
    assert_eq!(header(&response, "access-control-allow-origin"), ORIGIN);

    let fixture = Fixture::new(Settings {
        issuer_url: "http://localhost:8080",
        ..Default::default()
    })
    .await;
    let response = fixture.send(get("/healthz")).await;
    assert!(response.headers().get("strict-transport-security").is_none());
}

#[tokio::test]
async fn protected_routes_reject_anonymous_requests() {
    let fixture = Fixture::new(Settings::default()).await;
    for request in [
        get("/query"),
        get("/playground"),
        get("/transactions/export"),
        post("/transactions/import"),
    ] {
        let response = fixture.send(request).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            header(&response, "www-authenticate"),
            "Bearer resource_metadata=\"https://tallyo.test/.well-known/oauth-protected-resource\""
        );
    }
}

#[tokio::test]
async fn export_and_import_require_their_scopes() {
    let fixture = Fixture::new(Settings::default()).await;
    for request in [get("/transactions/export"), post("/transactions/import")] {
        let response = fixture.send(fixture.authorized(request, &[Scope::ReadAccounts])).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(text(response).await, "forbidden");
    }
}

#[tokio::test]
async fn query_executes_with_the_request_identity() {
    let fixture = Fixture::new(Settings::default()).await;
    let body = json!({ "query": OWNERS_QUERY }).to_string();
    let response = fixture
        .send_body(
            fixture
                .authorized(post("/query"), ALL_SCOPES)
                .header("Content-Type", "application/json"),
            body.clone(),
        )
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await,
        json!({ "data": { "owners": { "items": [] } } })
    );

    let encoded = url::form_urlencoded::byte_serialize(OWNERS_QUERY.as_bytes()).collect::<String>();
    let response = fixture
        .send(fixture.authorized(get(&format!("/query?query={encoded}")), ALL_SCOPES))
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await["data"]["owners"]["items"], json!([]));

    let response = fixture
        .send_body(
            fixture
                .authorized(post("/query"), &[Scope::ReadAccounts])
                .header("Content-Type", "application/json"),
            body,
        )
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    let errors = json_body(response).await["errors"].clone();
    assert_eq!(errors[0]["message"], "forbidden: read:owners access required");
    assert_eq!(errors[0]["extensions"]["code"], "FORBIDDEN");
}

#[tokio::test]
async fn query_rejects_bodies_over_the_cap() {
    let fixture = Fixture::new(Settings::default()).await;
    let body = json!({ "query": "#".repeat(1 << 20) }).to_string();
    let response = fixture
        .send_body(
            fixture
                .authorized(post("/query"), ALL_SCOPES)
                .header("Content-Type", "application/json"),
            body,
        )
        .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn playground_is_served_to_authenticated_users() {
    let fixture = Fixture::new(Settings::default()).await;
    let response = fixture.send(fixture.authorized(get("/playground"), &[])).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(header(&response, "content-type").starts_with("text/html"));
    assert!(text(response).await.contains("Tallyo GraphQL"));
}

#[tokio::test]
async fn export_streams_csv_and_rejects_bad_filters() {
    let fixture = Fixture::new(Settings::default()).await;
    let account_id = account(&fixture.pool, "acc-1").await.unwrap();
    let datetime = "2026-05-01T12:00:00Z".parse().unwrap();
    transaction(&fixture.pool, "Coffee", account_id, 0, Cents(1234), datetime)
        .await
        .unwrap();

    let response = fixture
        .send(fixture.authorized(get("/transactions/export"), &[Scope::ReadTransactions]))
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(header(&response, "content-type"), "text/csv");
    assert!(header(&response, "content-disposition").starts_with("attachment; filename=\"transactions-"));
    let body = text(response).await;
    let mut lines = body.lines();
    assert_eq!(
        lines.next().unwrap(),
        "external_id,source,datetime,posted_datetime,amount,merchant_name,original_name,category,account_id,account_name,owner,notes,is_recurring,is_reviewed,is_hidden,pending"
    );
    let row = lines.next().unwrap();
    assert!(
        row.starts_with("Coffee,manual,2026-05-01T12:00:00Z,2026-05-01T12:00:00Z,12.34,Coffee,"),
        "{row}"
    );
    assert_eq!(lines.next(), None);

    let response = fixture
        .send(fixture.authorized(
            get("/transactions/export?merchantPrefix=nothing"),
            &[Scope::ReadTransactions],
        ))
        .await;
    assert_eq!(text(response).await.lines().count(), 1);

    for (query, message) in [
        (
            "datetimeFrom=not-a-date",
            "invalid datetimeFrom: premature end of input",
        ),
        (
            "isReviewed=maybe",
            "invalid isReviewed: value \"maybe\" is not a boolean",
        ),
        ("categoryIds=nope", "invalid categoryIds: invalid global id"),
    ] {
        let response = fixture
            .send(fixture.authorized(
                get(&format!("/transactions/export?{query}")),
                &[Scope::ReadTransactions],
            ))
            .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{query}");
        assert_eq!(text(response).await, message);
    }
}

#[tokio::test]
async fn import_reports_rows_and_prepends_parse_errors() {
    let fixture = Fixture::new(Settings::default()).await;
    account(&fixture.pool, "acc-1").await.unwrap();
    let (content_type, body) = multipart("file", IMPORT_CSV);
    let response = fixture
        .send_body(
            fixture
                .authorized(post("/transactions/import"), &[Scope::WriteTransactions])
                .header("Content-Type", content_type),
            body,
        )
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await,
        json!({ "processed": 1, "skipped": 1, "errors": [{ "row": 2, "message": "account_id is required" }] })
    );

    let (content_type, body) = multipart(
        "file",
        "account_id,datetime,amount,merchant_name\nacc-1,2026-05-02,1.00,Tea\n",
    );
    let response = fixture
        .send_body(
            fixture
                .authorized(post("/transactions/import"), &[Scope::WriteTransactions])
                .header("Content-Type", content_type),
            body,
        )
        .await;
    assert_eq!(
        json_body(response).await,
        json!({ "processed": 1, "skipped": 0, "errors": [] })
    );
}

#[tokio::test]
async fn import_rejects_malformed_uploads() {
    let fixture = Fixture::new(Settings::default()).await;
    let oversized = multipart("file", &"x".repeat(10 << 20));
    for ((content_type, body), message) in [
        (
            multipart("file", "datetime,amount\n"),
            "csv parse error: missing required column \"account_id\"",
        ),
        (multipart("other", IMPORT_CSV), "missing file field"),
        (
            ("text/plain", IMPORT_CSV.to_owned()),
            "invalid multipart form or file too large",
        ),
        (oversized, "invalid multipart form or file too large"),
    ] {
        let response = fixture
            .send_body(
                fixture
                    .authorized(post("/transactions/import"), &[Scope::WriteTransactions])
                    .header("Content-Type", content_type),
                body,
            )
            .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{message}");
        assert_eq!(text(response).await, message);
    }
}

#[tokio::test]
async fn spa_caches_assets_and_falls_back_to_index() {
    let response = serve::<TestDist>("/assets/app.js");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        header(&response, "cache-control"),
        "public, max-age=31536000, immutable"
    );
    assert!(header(&response, "content-type").contains("javascript"));
    assert_eq!(text(response).await, "console.log(\"app\");\n");

    for path in ["/assets/missing.js", "/not-a-real-route", "/"] {
        let response = serve::<TestDist>(path);
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(header(&response, "cache-control"), "no-cache");
        assert_eq!(header(&response, "content-type"), "text/html");
        assert!(text(response).await.contains("<html"));
    }

    let fixture = Fixture::new(Settings::default()).await;
    let response = fixture.send(get("/not-a-real-route")).await;
    assert_eq!(header(&response, "cache-control"), "no-cache");
}

#[tokio::test]
async fn mcp_route_follows_runtime_and_auth_settings() {
    let fixture = Fixture::new(Settings {
        mcp_enabled: false,
        ..Default::default()
    })
    .await;
    assert_eq!(fixture.send(post("/mcp")).await.status(), StatusCode::NOT_FOUND);

    let fixture = Fixture::new(Settings {
        oauth_enabled: false,
        ..Default::default()
    })
    .await;
    let response = fixture.send(post("/mcp")).await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(header(&response, "www-authenticate").ends_with("/.well-known/oauth-protected-resource\""));

    let fixture = Fixture::new(Settings::default()).await;
    let response = fixture.send(post("/mcp")).await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(header(&response, "www-authenticate").ends_with("/.well-known/oauth-protected-resource/mcp\""));
    let response = fixture.send(fixture.authorized(post("/mcp"), &[])).await;
    assert_eq!(response.status(), StatusCode::OK);
}
