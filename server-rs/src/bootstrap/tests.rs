use std::{path::PathBuf, sync::Arc, time::Duration};

use serde_json::{Value, json};
use tokio::{net::TcpListener, time::timeout};
use tokio_util::sync::CancellationToken;

use super::{App, run};
use crate::{
    admin::{LocaleConfig, Patch, SectionPatch},
    auth::Scope,
    config::{Authorization, Config, MasterPassword},
    database::dbtest,
    utils::timezone::FALLBACK_TIMEZONE,
};

const OWNERS_QUERY: &str = "{ owners { items { name } } }";
const SHUTDOWN_BOUND: Duration = Duration::from_secs(10);

fn config(db_path: PathBuf, port: u16, sync_off: bool) -> Config {
    Config {
        config_file_path: None,
        db_path,
        db_encryption_key: None,
        port,
        sync_off,
        authorization: Authorization {
            disable_all_auth: false,
            master_password: Some(MasterPassword::try_from("secret".to_owned()).unwrap()),
        },
    }
}

async fn assemble(sync_off: bool) -> (App, CancellationToken) {
    let pool = dbtest::open().await.unwrap();
    let shutdown = CancellationToken::new();
    let app = App::assemble(pool, config(PathBuf::from(":memory:"), 0, sync_off), shutdown.clone())
        .await
        .unwrap();
    (app, shutdown)
}

async fn listener() -> (TcpListener, String) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    (listener, base)
}

#[tokio::test]
async fn serves_requests_and_closes_the_pool_after_shutdown() {
    let (app, shutdown) = assemble(true).await;
    let (pool, auth) = (app.pool.clone(), Arc::clone(&app.auth));
    let (listener, base) = listener().await;
    let server = tokio::spawn(app.serve(listener));

    let client = reqwest::Client::new();
    let health = client.get(format!("{base}/healthz")).send().await.unwrap();
    assert_eq!(health.status(), 204);

    let query = json!({ "query": OWNERS_QUERY });
    let anonymous = client.post(format!("{base}/query")).json(&query).send().await.unwrap();
    assert_eq!(anonymous.status(), 401);

    let token = auth
        .mint_access_token("person@example.com", &[Scope::ReadOwners], "UTC")
        .unwrap();
    let response = client
        .post(format!("{base}/query"))
        .bearer_auth(token)
        .json(&query)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body: Value = response.json().await.unwrap();
    assert!(body["data"]["owners"]["items"].is_array(), "{body}");
    drop(client);

    shutdown.cancel();
    timeout(SHUTDOWN_BOUND, server).await.unwrap().unwrap().unwrap();
    assert!(pool.is_closed());
}

#[tokio::test]
async fn sync_loops_start_and_stop_on_shutdown() {
    let (app, shutdown) = assemble(false).await;
    let pool = app.pool.clone();
    let (listener, base) = listener().await;
    let server = tokio::spawn(app.serve(listener));

    let health = reqwest::get(format!("{base}/healthz")).await.unwrap();
    assert_eq!(health.status(), 204);

    shutdown.cancel();
    timeout(SHUTDOWN_BOUND, server).await.unwrap().unwrap().unwrap();
    assert!(pool.is_closed());
}

#[tokio::test]
async fn runtime_configuration_changes_reach_the_registered_targets() {
    let (app, _shutdown) = assemble(true).await;
    assert_eq!(app.auth.timezone(), FALLBACK_TIMEZONE);
    app.manager
        .update_sections(Patch {
            locale: Some(SectionPatch {
                enabled: true,
                fields: LocaleConfig {
                    timezone: "Europe/Berlin".to_owned(),
                },
            }),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(app.auth.timezone(), "Europe/Berlin");
}

#[tokio::test]
async fn run_opens_the_database_and_serves_until_cancelled() {
    let dir = tempfile::tempdir().unwrap();
    let shutdown = CancellationToken::new();
    shutdown.cancel();
    timeout(
        SHUTDOWN_BOUND,
        run(config(dir.path().join("tallyo.db"), 0, true), shutdown),
    )
    .await
    .unwrap()
    .unwrap();
}

#[tokio::test]
async fn run_fails_when_the_port_is_taken() {
    let dir = tempfile::tempdir().unwrap();
    let (taken, _) = listener().await;
    let port = taken.local_addr().unwrap().port();
    let error = run(
        config(dir.path().join("tallyo.db"), port, true),
        CancellationToken::new(),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("in use"), "{error:#}");
}
