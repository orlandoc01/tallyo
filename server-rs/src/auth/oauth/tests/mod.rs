use std::sync::Arc;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use chrono::{Duration, Utc};
use serde_json::Value;
use tower::ServiceExt;
use url::Url;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

use super::router;
use crate::{
    auth::{
        AuthSettings, Config, DcrSettings, EmailOtpUpdate, EmailSettings, GoogleEndpoints, GoogleSettings,
        LoginSession, OAuthClient, Scope, Service, SmtpConfig, WebAuthnSettings, code_challenge, token_signature,
    },
    database::{dbtest, queries},
    middleware::client_ip::ClientIpResolver,
    schema::Role,
};

const ISSUER: &str = "https://tallyo.test";
const REDIRECT_URI: &str = "https://web.test/auth/callback";
const VERIFIER: &str = "verifier";

async fn setup_service(
    passkeys: bool,
    setup_complete: bool,
    disable_all_auth: bool,
) -> (Arc<Service>, sqlx::SqlitePool) {
    let pool = dbtest::open().await.unwrap();
    let service = Service::new(
        Config {
            webauthn: WebAuthnSettings {
                enabled: passkeys,
                ..Default::default()
            },
            email: EmailSettings {
                enabled: true,
                ..Default::default()
            },
            dcr_settings: DcrSettings {
                enabled: true,
                dynamic_redirect_hosts: vec!["client.test".to_owned()],
            },
            setup_complete,
            ..Config::new(
                AuthSettings {
                    issuer_url: ISSUER.to_owned(),
                    oauth_enabled: true,
                    disable_all_auth,
                    frontend_redirect_uris: vec![REDIRECT_URI.to_owned()],
                    ..Default::default()
                },
                ClientIpResolver::new(&[]).unwrap(),
            )
        },
        pool.clone(),
    )
    .await
    .unwrap();
    add_user(&pool, "admin@example.com", Role::Admin).await;
    (Arc::new(service), pool)
}

async fn setup() -> (Arc<Service>, sqlx::SqlitePool) {
    setup_service(false, true, false).await
}

async fn add_user(pool: &sqlx::SqlitePool, email: &str, role: Role) -> i64 {
    let role = role.to_string().to_ascii_lowercase();
    queries::insert_user(
        pool,
        queries::InsertUserParams {
            email,
            role: &role,
            invited_by: None,
        },
    )
    .await
    .unwrap()
    .id
}

fn request(method: &str, uri: &str) -> Request<Body> {
    Request::builder().method(method).uri(uri).body(Body::empty()).unwrap()
}

fn json_request(method: &str, uri: &str, value: Value, token: Option<&str>) -> Request<Body> {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(token) = token {
        request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    request.body(Body::from(value.to_string())).unwrap()
}

fn bearer(service: &Service, email: &str) -> String {
    service.mint_access_token(email, &[Scope::ReadAccounts], "UTC").unwrap()
}

fn form_request(uri: &str, form: &[(&str, &str)]) -> Request<Body> {
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(form)
        .finish();
    Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(Body::from(body))
        .unwrap()
}

async fn json(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}

fn location(response: &axum::response::Response) -> Url {
    Url::parse(response.headers()[header::LOCATION].to_str().unwrap()).unwrap()
}

fn authorize_uri(auth_method: Option<&str>) -> String {
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    query
        .append_pair("response_type", "code")
        .append_pair("client_id", "tallyo-web")
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("scope", "read write")
        .append_pair("state", "client-state")
        .append_pair("code_challenge", &code_challenge(VERIFIER))
        .append_pair("code_challenge_method", "S256");
    if let Some(auth_method) = auth_method {
        query.append_pair("auth_method", auth_method);
    }
    format!("/authorize?{}", query.finish())
}

async fn authorization_code(service: &Arc<Service>) -> String {
    let start = router(Arc::clone(service))
        .oneshot(request("GET", &authorize_uri(None)))
        .await
        .unwrap();
    assert_eq!(start.status(), StatusCode::FOUND);
    let session_id = location(&start)
        .query_pairs()
        .find_map(|(key, value)| (key == "login_session").then_some(value.into_owned()))
        .unwrap();
    service
        .store()
        .mark_login_session_authenticated(&session_id, "admin@example.com")
        .await
        .unwrap();
    let completed = router(Arc::clone(service))
        .oneshot(request("GET", &format!("/authorize?session_id={session_id}")))
        .await
        .unwrap();
    assert_eq!(completed.status(), StatusCode::FOUND);
    location(&completed)
        .query_pairs()
        .find_map(|(key, value)| (key == "code").then_some(value.into_owned()))
        .unwrap()
}

async fn exchange_code(service: &Arc<Service>, code: &str) -> Value {
    let response = router(Arc::clone(service))
        .oneshot(form_request(
            "/token",
            &[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("code_verifier", VERIFIER),
                ("client_id", "tallyo-web"),
                ("redirect_uri", REDIRECT_URI),
            ],
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_token_headers(&response);
    json(response).await
}

fn assert_token_headers(response: &axum::response::Response) {
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(response.headers()["pragma"], "no-cache");
}

#[tokio::test]
async fn issues_tokens_rotates_refreshes_and_revokes_replayed_code_chains() {
    let (service, _) = setup().await;
    let code = authorization_code(&service).await;
    let first = exchange_code(&service, &code).await;
    let first_access = first["access_token"].as_str().unwrap();
    let first_refresh = first["refresh_token"].as_str().unwrap();
    assert_eq!(first["token_type"], "bearer");
    assert!(first["scope"].as_str().unwrap().contains("read:transactions"));
    assert_eq!(
        service.verify_access_token(first_access).unwrap().sub,
        "admin@example.com"
    );

    service.timezone_cache().set_timezone("America/Los_Angeles");
    let refreshed = router(Arc::clone(&service))
        .oneshot(form_request(
            "/token",
            &[
                ("grant_type", "refresh_token"),
                ("refresh_token", first_refresh),
                ("client_id", "tallyo-web"),
            ],
        ))
        .await
        .unwrap();
    assert_eq!(refreshed.status(), StatusCode::OK);
    let refreshed = json(refreshed).await;
    assert_eq!(
        service
            .verify_access_token(refreshed["access_token"].as_str().unwrap())
            .unwrap()
            .locale
            .timezone,
        "America/Los_Angeles"
    );

    let replay = router(Arc::clone(&service))
        .oneshot(form_request(
            "/token",
            &[
                ("grant_type", "authorization_code"),
                ("code", &code),
                ("code_verifier", VERIFIER),
                ("client_id", "tallyo-web"),
                ("redirect_uri", REDIRECT_URI),
            ],
        ))
        .await
        .unwrap();
    assert_eq!(replay.status(), StatusCode::BAD_REQUEST);
    assert_eq!(json(replay).await["error"], "invalid_grant");
    assert!(
        service
            .store()
            .refresh_token(
                &token_signature(refreshed["refresh_token"].as_str().unwrap()),
                Utc::now(),
                false,
            )
            .await
            .unwrap()
            .is_some_and(|token| !token.active)
    );
    assert!(
        service
            .store()
            .access_token(first_access.rsplit_once('.').unwrap().1, Utc::now())
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn only_one_concurrent_code_exchange_succeeds() {
    let (service, _) = setup().await;
    let code = authorization_code(&service).await;
    let app = router(Arc::clone(&service));
    let form = [
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("code_verifier", VERIFIER),
        ("client_id", "tallyo-web"),
        ("redirect_uri", REDIRECT_URI),
    ];
    let (first, second) = tokio::join!(
        app.clone().oneshot(form_request("/token", &form)),
        app.oneshot(form_request("/token", &form))
    );
    assert_eq!(
        [first.unwrap().status(), second.unwrap().status()]
            .into_iter()
            .filter(|status| *status == StatusCode::OK)
            .count(),
        1
    );
}

#[tokio::test]
async fn failed_authorization_code_exchange_keeps_the_code_active_and_creates_no_access_token() {
    let (service, pool) = setup().await;
    let code = authorization_code(&service).await;
    sqlx::query(
        "CREATE TRIGGER fail_refresh_insert BEFORE INSERT ON oauth_refresh_tokens BEGIN SELECT RAISE(FAIL, 'refresh insert failed'); END",
    )
    .execute(&pool)
    .await
    .unwrap();
    let response = router(Arc::clone(&service))
        .oneshot(form_request(
            "/token",
            &[
                ("grant_type", "authorization_code"),
                ("code", &code),
                ("code_verifier", VERIFIER),
                ("client_id", "tallyo-web"),
                ("redirect_uri", REDIRECT_URI),
            ],
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_token_headers(&response);
    assert!(
        service
            .store()
            .auth_code(&code, Utc::now(), false)
            .await
            .unwrap()
            .is_some_and(|auth_code| auth_code.active)
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM oauth_access_tokens")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn only_one_concurrent_authorize_completion_issues_a_code() {
    let (service, _) = setup().await;
    let session = login_session("claimed-session", "tallyo-web", REDIRECT_URI, "read write");
    service.store().create_login_session(&session).await.unwrap();
    service
        .store()
        .mark_login_session_authenticated(&session.id, "admin@example.com")
        .await
        .unwrap();
    let app = router(service);
    let (first, second) = tokio::join!(
        app.clone()
            .oneshot(request("GET", "/authorize?session_id=claimed-session")),
        app.oneshot(request("GET", "/authorize?session_id=claimed-session"))
    );
    let statuses = [first.unwrap().status(), second.unwrap().status()];
    assert_eq!(
        statuses
            .into_iter()
            .filter(|status| *status == StatusCode::FOUND)
            .count(),
        1
    );
    assert_eq!(
        statuses
            .into_iter()
            .filter(|status| *status == StatusCode::BAD_REQUEST)
            .count(),
        1
    );
}

#[tokio::test]
async fn refresh_token_reuse_revokes_the_rotated_chain() {
    let (service, _) = setup().await;
    let code = authorization_code(&service).await;
    let initial = exchange_code(&service, &code).await;
    let initial_refresh = initial["refresh_token"].as_str().unwrap();
    let rotated = router(Arc::clone(&service))
        .oneshot(form_request(
            "/token",
            &[
                ("grant_type", "refresh_token"),
                ("refresh_token", initial_refresh),
                ("client_id", "tallyo-web"),
            ],
        ))
        .await
        .unwrap();
    assert_eq!(rotated.status(), StatusCode::OK);
    assert_token_headers(&rotated);
    let rotated = json(rotated).await;
    let replay = router(Arc::clone(&service))
        .oneshot(form_request(
            "/token",
            &[
                ("grant_type", "refresh_token"),
                ("refresh_token", initial_refresh),
                ("client_id", "tallyo-web"),
            ],
        ))
        .await
        .unwrap();
    assert_eq!(replay.status(), StatusCode::BAD_REQUEST);
    assert_token_headers(&replay);
    assert_eq!(json(replay).await["error"], "invalid_grant");
    assert!(
        service
            .store()
            .refresh_token(
                &token_signature(rotated["refresh_token"].as_str().unwrap()),
                Utc::now(),
                false,
            )
            .await
            .unwrap()
            .is_some_and(|token| !token.active)
    );
    assert!(
        service
            .store()
            .access_token(
                rotated["access_token"].as_str().unwrap().rsplit_once('.').unwrap().1,
                Utc::now(),
            )
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn authorize_and_consent_fail_closed_for_missing_and_corrupt_users() {
    let (service, pool) = setup().await;
    service
        .store()
        .save_client(OAuthClient {
            id: "dynamic-client".to_owned(),
            redirect_uris: vec!["https://client.test/callback".to_owned()],
            grant_types: vec!["authorization_code".to_owned()],
            response_types: vec!["code".to_owned()],
            scopes: vec!["read:transactions".to_owned()],
            application_type: "native".to_owned(),
            client_name: String::new(),
            public: true,
            preseeded: false,
        })
        .await
        .unwrap();
    sqlx::query("INSERT INTO users (email, role) VALUES ('corrupt@example.com', 'corrupt')")
        .execute(&pool)
        .await
        .unwrap();
    for (id, subject) in [
        ("missing-user", "missing@example.com"),
        ("corrupt-user", "corrupt@example.com"),
    ] {
        let session = login_session(
            id,
            "dynamic-client",
            "https://client.test/callback",
            "read:transactions",
        );
        service.store().create_login_session(&session).await.unwrap();
        service
            .store()
            .mark_login_session_authenticated(&session.id, subject)
            .await
            .unwrap();
        let authorize = router(Arc::clone(&service))
            .oneshot(request("GET", &format!("/authorize?session_id={id}")))
            .await
            .unwrap();
        assert_eq!(authorize.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let consent = router(Arc::clone(&service))
            .oneshot(request("GET", &format!("/consent?session_id={id}")))
            .await
            .unwrap();
        assert_eq!(consent.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}

#[tokio::test]
async fn token_rejects_unsupported_grants_bad_pkce_and_unknown_refresh_tokens() {
    let (service, _) = setup().await;
    let code = authorization_code(&service).await;
    for (form, expected_error) in [
        (
            vec![("grant_type", "client_credentials"), ("client_id", "tallyo-web")],
            "unsupported_grant_type",
        ),
        (
            vec![
                ("grant_type", "authorization_code"),
                ("code", &code),
                ("code_verifier", "wrong"),
                ("client_id", "tallyo-web"),
                ("redirect_uri", REDIRECT_URI),
            ],
            "invalid_grant",
        ),
        (
            vec![
                ("grant_type", "refresh_token"),
                ("refresh_token", "unknown"),
                ("client_id", "tallyo-web"),
            ],
            "invalid_grant",
        ),
    ] {
        let response = router(Arc::clone(&service))
            .oneshot(form_request("/token", &form))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_token_headers(&response);
        assert_eq!(json(response).await["error"], expected_error);
    }
}

#[tokio::test]
async fn authorize_redirects_to_login_or_returns_the_enabled_webauthn_session() {
    let (service, _) = setup().await;
    let login = router(Arc::clone(&service))
        .oneshot(request("GET", &authorize_uri(None)))
        .await
        .unwrap();
    assert_eq!(login.status(), StatusCode::FOUND);
    assert_eq!(location(&login).path(), "/auth/login");
    let apply = service
        .prepare_webauthn_settings(
            ISSUER.to_owned(),
            WebAuthnSettings {
                enabled: true,
                ..Default::default()
            },
        )
        .unwrap();
    apply();
    let response = router(service)
        .oneshot(request("GET", &authorize_uri(Some("webauthn"))))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        json(response).await["login_session_id"]
            .as_str()
            .is_some_and(|id| !id.is_empty())
    );
}

#[tokio::test]
async fn email_handlers_report_expiry_sender_failures_and_authenticated_sessions() {
    let (service, _) = setup().await;
    let expired = login_session("expired-email", "tallyo-web", REDIRECT_URI, "read write");
    service.store().create_login_session(&expired).await.unwrap();
    service
        .store()
        .save_email_otp(&EmailOtpUpdate {
            session_id: expired.id.clone(),
            email: "admin@example.com".to_owned(),
            hashed_otp: token_signature("123456"),
            hashed_magic_token: token_signature("magic"),
            pkce_verifier: VERIFIER.to_owned(),
            expires_at: Utc::now() - Duration::seconds(1),
        })
        .await
        .unwrap();
    let expired_response = router(Arc::clone(&service))
        .oneshot(json_request(
            "POST",
            "/auth/email/verify",
            serde_json::json!({"login_session_id":"expired-email","email":"admin@example.com","code":"123456"}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(expired_response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(json(expired_response).await["error"], "expired");

    let authenticated = login_session("authenticated-email", "tallyo-web", REDIRECT_URI, "read write");
    service.store().create_login_session(&authenticated).await.unwrap();
    service
        .store()
        .mark_login_session_authenticated(&authenticated.id, "admin@example.com")
        .await
        .unwrap();
    let authenticated_response = router(Arc::clone(&service))
        .oneshot(json_request(
            "POST",
            "/auth/email/send",
            serde_json::json!({"login_session_id":"authenticated-email","email":"admin@example.com"}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(authenticated_response.status(), StatusCode::BAD_REQUEST);

    service.update_email_settings(EmailSettings {
        enabled: true,
        smtp: Some(SmtpConfig {
            host: "localhost".to_owned(),
            port: 25,
            from: "invalid-address".to_owned(),
            credentials: None,
        }),
    });
    let sender_failure = login_session("sender-failure", "tallyo-web", REDIRECT_URI, "read write");
    service.store().create_login_session(&sender_failure).await.unwrap();
    let sender_response = router(service)
        .oneshot(json_request(
            "POST",
            "/auth/email/send",
            serde_json::json!({"login_session_id":"sender-failure","email":"admin@example.com"}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(sender_response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn dcr_accepts_only_safe_redirect_uris_and_hides_when_disabled() {
    let (service, _) = setup().await;
    let app = router(Arc::clone(&service));
    for (uri, status) in [
        ("https://tallyo.test/callback", StatusCode::OK),
        ("https://client.test/callback", StatusCode::OK),
        ("http://localhost/callback", StatusCode::OK),
        ("http://127.0.0.1/callback", StatusCode::OK),
        ("app://callback", StatusCode::OK),
        ("https://other.test/callback", StatusCode::BAD_REQUEST),
        ("http://other.test/callback", StatusCode::BAD_REQUEST),
        ("javascript:alert(1)", StatusCode::BAD_REQUEST),
        ("data:text/plain,value", StatusCode::BAD_REQUEST),
        ("file:///tmp/callback", StatusCode::BAD_REQUEST),
        ("mailto:person@example.com", StatusCode::BAD_REQUEST),
    ] {
        let response = app
            .clone()
            .oneshot(json_request(
                "POST",
                "/register",
                serde_json::json!({"redirect_uris":[uri]}),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), status, "{uri}");
    }
    let unsupported = app
        .oneshot(json_request(
            "POST",
            "/register",
            serde_json::json!({"redirect_uris":["https://client.test/callback"],"token_endpoint_auth_method":"client_secret_post"}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(unsupported.status(), StatusCode::BAD_REQUEST);

    service.update_dcr_settings(DcrSettings::default());
    let app = router(service);
    let register = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/register",
            serde_json::json!({"redirect_uris":[REDIRECT_URI]}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(register.status(), StatusCode::NOT_FOUND);
    let metadata = app
        .oneshot(request("GET", "/.well-known/oauth-authorization-server"))
        .await
        .unwrap();
    assert!(json(metadata).await.get("registration_endpoint").is_none());
}

#[tokio::test]
async fn requires_consent_for_dynamic_clients_and_limits_scopes_to_the_role() {
    let (service, pool) = setup().await;
    add_user(&pool, "writer@example.com", Role::Writer).await;
    service
        .store()
        .save_client(OAuthClient {
            id: "dynamic-client".to_owned(),
            redirect_uris: vec!["https://client.test/callback".to_owned()],
            grant_types: vec!["authorization_code".to_owned(), "refresh_token".to_owned()],
            response_types: vec!["code".to_owned()],
            scopes: crate::auth::CLIENT_ALLOWED_SCOPES
                .iter()
                .map(ToString::to_string)
                .collect(),
            application_type: "native".to_owned(),
            client_name: "Dynamic Client".to_owned(),
            public: true,
            preseeded: false,
        })
        .await
        .unwrap();
    let session = login_session(
        "consent-session",
        "dynamic-client",
        "https://client.test/callback",
        "read:transactions write:users",
    );
    service.store().create_login_session(&session).await.unwrap();
    service
        .store()
        .mark_login_session_authenticated(&session.id, "writer@example.com")
        .await
        .unwrap();
    let consent = router(Arc::clone(&service))
        .oneshot(request("GET", "/authorize?session_id=consent-session"))
        .await
        .unwrap();
    assert_eq!(consent.status(), StatusCode::OK);
    assert!(
        String::from_utf8(to_bytes(consent.into_body(), usize::MAX).await.unwrap().to_vec())
            .unwrap()
            .contains("Authorize Dynamic Client")
    );

    let granted = router(Arc::clone(&service))
        .oneshot(form_request(
            "/consent",
            &[("session_id", "consent-session"), ("consent", "allow")],
        ))
        .await
        .unwrap();
    assert_eq!(granted.status(), StatusCode::FOUND);
    let code = location(&granted)
        .query_pairs()
        .find_map(|(key, value)| (key == "code").then_some(value.into_owned()))
        .unwrap();
    let exchanged = router(Arc::clone(&service))
        .oneshot(form_request(
            "/token",
            &[
                ("grant_type", "authorization_code"),
                ("code", &code),
                ("code_verifier", VERIFIER),
                ("client_id", "dynamic-client"),
                ("redirect_uri", "https://client.test/callback"),
            ],
        ))
        .await
        .unwrap();
    assert_eq!(exchanged.status(), StatusCode::OK);
    assert_eq!(json(exchanged).await["scope"], "read:transactions");
}

#[tokio::test]
async fn sends_and_verifies_email_codes_without_enumerating_unknown_addresses() {
    let (service, _) = setup().await;
    let session = login_session("email-session", "tallyo-web", REDIRECT_URI, "read write");
    service.store().create_login_session(&session).await.unwrap();
    let unknown = router(Arc::clone(&service))
        .oneshot(json_request(
            "POST",
            "/auth/email/send",
            serde_json::json!({"login_session_id":"email-session","email":"unknown@example.com","code_verifier":VERIFIER}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(unknown.status(), StatusCode::OK);
    assert_eq!(
        json(unknown).await["message"],
        "If that address is registered, a code has been sent."
    );

    service
        .store()
        .save_email_otp(&EmailOtpUpdate {
            session_id: session.id.clone(),
            email: "admin@example.com".to_owned(),
            hashed_otp: token_signature("123456"),
            hashed_magic_token: token_signature("magic"),
            pkce_verifier: VERIFIER.to_owned(),
            expires_at: Utc::now() + Duration::minutes(10),
        })
        .await
        .unwrap();
    let invalid = router(Arc::clone(&service))
        .oneshot(json_request(
            "POST",
            "/auth/email/verify",
            serde_json::json!({"login_session_id":"email-session","email":"admin@example.com","code":"000000"}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
    assert_eq!(json(invalid).await["error"], "invalid_code");
    let verified = router(Arc::clone(&service))
        .oneshot(json_request(
            "POST",
            "/auth/email/verify",
            serde_json::json!({"login_session_id":"email-session","email":"admin@example.com","code":"123456"}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(verified.status(), StatusCode::OK);
    assert!(
        json(verified).await["redirect_url"]
            .as_str()
            .unwrap()
            .contains("session_id=email-session")
    );
}

#[tokio::test]
async fn publishes_metadata_registers_valid_clients_and_rejects_disabled_google() {
    let (service, _) = setup().await;
    let app = router(Arc::clone(&service));
    let metadata = app
        .clone()
        .oneshot(request("GET", "/.well-known/oauth-authorization-server"))
        .await
        .unwrap();
    assert_eq!(metadata.status(), StatusCode::OK);
    assert_eq!(metadata.headers()["access-control-allow-origin"], "*");
    assert_eq!(
        json(metadata).await["registration_endpoint"],
        format!("{ISSUER}/register")
    );

    let registered = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/register",
            serde_json::json!({"client_name":"Client","redirect_uris":["https://client.test/callback"]}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(registered.status(), StatusCode::OK);
    assert!(
        json(registered).await["client_id"]
            .as_str()
            .is_some_and(|id| !id.is_empty())
    );

    let rejected = app
        .clone()
        .oneshot(json_request(
            "POST",
            "/register",
            serde_json::json!({"redirect_uris":["https://evil.test/callback"]}),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    let config = app.clone().oneshot(request("GET", "/auth/config")).await.unwrap();
    assert_eq!(config.status(), StatusCode::OK);
    assert_eq!(json(config).await["email_auth_enabled"], true);
    let google = app
        .oneshot(request("GET", "/auth/google?login_session=nope"))
        .await
        .unwrap();
    assert_eq!(google.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn magic_links_set_frontend_cookies_and_expired_links_stay_safe() {
    let (service, _) = setup().await;
    let mut session = login_session("magic-session", "tallyo-web", REDIRECT_URI, "read write");
    session.purpose = "passkey".to_owned();
    service.store().create_login_session(&session).await.unwrap();
    service
        .store()
        .save_email_otp(&EmailOtpUpdate {
            session_id: session.id.clone(),
            email: "admin@example.com".to_owned(),
            hashed_otp: String::new(),
            hashed_magic_token: token_signature("magic"),
            pkce_verifier: VERIFIER.to_owned(),
            expires_at: Utc::now() + Duration::minutes(10),
        })
        .await
        .unwrap();
    let response = router(Arc::clone(&service))
        .oneshot(request(
            "GET",
            "/auth/email/magic?token=magic&session_id=magic-session&email=admin%40example.com",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FOUND);
    let cookies = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|value| value.to_str().unwrap())
        .collect::<Vec<_>>();
    assert!(cookies.iter().any(|cookie| {
        cookie.starts_with("pkce-verifier=verifier; Path=/auth/callback; Max-Age=300; SameSite=Lax; Secure")
    }));
    assert!(cookies.iter().any(|cookie| cookie.starts_with(
        "st_post_login=%2Fsettings%2Fpasskeys%3Fonboarding%3Dpasskey; Path=/; Max-Age=300; SameSite=Lax; Secure"
    )));

    let reused = router(service)
        .oneshot(request(
            "GET",
            "/auth/email/magic?token=magic&session_id=magic-session&email=admin%40example.com",
        ))
        .await
        .unwrap();
    assert_eq!(reused.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn refresh_insert_failures_rollback_the_revocation_and_access_deletion() {
    let (service, pool) = setup().await;
    let code = authorization_code(&service).await;
    let token = exchange_code(&service, &code).await;
    let refresh = token["refresh_token"].as_str().unwrap();
    let access_signature = token["access_token"].as_str().unwrap().rsplit_once('.').unwrap().1;
    sqlx::query(
        "CREATE TRIGGER fail_refresh_insert BEFORE INSERT ON oauth_refresh_tokens BEGIN SELECT RAISE(FAIL, 'refresh insert failed'); END",
    )
    .execute(&pool)
    .await
    .unwrap();
    let failed = router(Arc::clone(&service))
        .oneshot(form_request(
            "/token",
            &[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh),
                ("client_id", "tallyo-web"),
            ],
        ))
        .await
        .unwrap();
    assert_eq!(failed.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert!(
        service
            .store()
            .refresh_token(&token_signature(refresh), Utc::now(), true)
            .await
            .unwrap()
            .is_some_and(|token| token.active)
    );
    assert!(
        service
            .store()
            .access_token(access_signature, Utc::now())
            .await
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn authorization_errors_redirect_only_after_client_and_redirect_validation() {
    let (service, _) = setup().await;
    let bad_pkce = router(Arc::clone(&service))
        .oneshot(request(
            "GET",
            "/authorize?response_type=code&client_id=tallyo-web&redirect_uri=https%3A%2F%2Fweb.test%2Fauth%2Fcallback&code_challenge=challenge&code_challenge_method=plain&state=state",
        ))
        .await
        .unwrap();
    assert_eq!(bad_pkce.status(), StatusCode::FOUND);
    assert_eq!(
        location(&bad_pkce)
            .query_pairs()
            .find_map(|(key, value)| (key == "error").then_some(value.into_owned())),
        Some("invalid_request".to_owned())
    );

    let unknown_client = router(service)
        .oneshot(request(
            "GET",
            "/authorize?response_type=code&client_id=unknown&redirect_uri=https%3A%2F%2Fweb.test%2Fauth%2Fcallback&code_challenge=challenge&code_challenge_method=S256",
        ))
        .await
        .unwrap();
    assert_eq!(unknown_client.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(json(unknown_client).await["error"], "invalid_client");
}

#[tokio::test]
async fn exchanges_google_callbacks_against_the_overridden_wiremock_endpoints() {
    let (service, _) = setup().await;
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"access_token":"token"})))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/userinfo"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"email":"ADMIN@example.com"})))
        .mount(&server)
        .await;
    service
        .update_google_settings(GoogleSettings {
            enabled: true,
            client_id: "google-client".to_owned(),
            client_secret: "google-secret".to_owned(),
            endpoints: GoogleEndpoints {
                auth: format!("{}/auth", server.uri()),
                token: format!("{}/token", server.uri()),
                userinfo: format!("{}/userinfo", server.uri()),
            },
        })
        .unwrap();
    let session = login_session("google-session", "tallyo-web", REDIRECT_URI, "read write");
    service.store().create_login_session(&session).await.unwrap();
    let app = router(Arc::clone(&service));
    let begin = app
        .clone()
        .oneshot(request("GET", "/auth/google?login_session=google-session"))
        .await
        .unwrap();
    assert_eq!(begin.status(), StatusCode::FOUND);
    assert_eq!(
        location(&begin)
            .query_pairs()
            .find_map(|(key, value)| (key == "state").then_some(value.into_owned())),
        Some("google-session-callback".to_owned())
    );
    let callback = app
        .oneshot(request(
            "GET",
            "/auth/google/callback?state=google-session-callback&code=code",
        ))
        .await
        .unwrap();
    assert_eq!(callback.status(), StatusCode::FOUND);
    assert_eq!(location(&callback).path(), "/authorize");
    assert!(
        service
            .store()
            .login_session_by_id("google-session")
            .await
            .unwrap()
            .is_some_and(|session| session.authenticated && session.subject == "admin@example.com")
    );
}

#[tokio::test]
async fn google_callback_rejects_disallowed_emails_without_authenticating_the_session() {
    let (service, _) = setup().await;
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"access_token":"token"})))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/userinfo"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"email":"unknown@example.com"})))
        .mount(&server)
        .await;
    service
        .update_google_settings(GoogleSettings {
            enabled: true,
            client_id: "google-client".to_owned(),
            client_secret: "google-secret".to_owned(),
            endpoints: GoogleEndpoints {
                auth: format!("{}/auth", server.uri()),
                token: format!("{}/token", server.uri()),
                userinfo: format!("{}/userinfo", server.uri()),
            },
        })
        .unwrap();
    let session = login_session("denied-google", "tallyo-web", REDIRECT_URI, "read write");
    service.store().create_login_session(&session).await.unwrap();
    let response = router(Arc::clone(&service))
        .oneshot(request(
            "GET",
            "/auth/google/callback?state=denied-google-callback&code=code",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        to_bytes(response.into_body(), usize::MAX).await.unwrap().as_ref(),
        b"google authentication failed"
    );
    assert!(
        service
            .store()
            .login_session_by_id("denied-google")
            .await
            .unwrap()
            .is_some_and(|session| !session.authenticated)
    );
}

fn login_session(id: &str, client_id: &str, redirect_uri: &str, scopes: &str) -> LoginSession {
    LoginSession {
        id: id.to_owned(),
        client_id: client_id.to_owned(),
        redirect_uri: redirect_uri.to_owned(),
        state: "state".to_owned(),
        code_challenge: code_challenge(VERIFIER),
        code_challenge_method: "S256".to_owned(),
        scopes: scopes.to_owned(),
        callback_state: format!("{id}-callback"),
        subject: String::new(),
        authenticated: false,
        expires_at: (Utc::now() + Duration::minutes(10)).into(),
        email: String::new(),
        email_otp: String::new(),
        email_otp_expires_at: None,
        email_otp_attempts: 0,
        email_magic_token: String::new(),
        pkce_verifier: String::new(),
        webauthn_session: String::new(),
        purpose: String::new(),
    }
}

mod webauthn;
