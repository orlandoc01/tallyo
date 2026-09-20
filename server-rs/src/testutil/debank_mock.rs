use serde_json::json;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

pub async fn mount_wallet(server: &MockServer, tokens: serde_json::Value, projects: serde_json::Value) {
    mount(server, "/token/balance_list", tokens).await;
    mount(server, "/portfolio/project_list", projects).await;
}

pub async fn mount(server: &MockServer, endpoint: &str, data: serde_json::Value) {
    mount_with_delay(server, endpoint, data, std::time::Duration::default()).await;
}

pub async fn mount_delayed(server: &MockServer, endpoint: &str, data: serde_json::Value, delay: std::time::Duration) {
    mount_with_delay(server, endpoint, data, delay).await;
}

async fn mount_with_delay(server: &MockServer, endpoint: &str, data: serde_json::Value, delay: std::time::Duration) {
    Mock::given(method("GET"))
        .and(path(endpoint))
        .respond_with(
            ResponseTemplate::new(200)
                .set_delay(delay)
                .set_body_json(json!({"data": data, "error_code": 0})),
        )
        .mount(server)
        .await;
}
