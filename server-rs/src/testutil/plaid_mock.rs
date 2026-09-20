use serde_json::json;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_json, body_partial_json, method, path},
};

pub async fn mount_link_flow(server: &MockServer) {
    mount(
        server,
        "/link/token/create",
        json!({"link_token":"link","expiration":"2026-01-01T00:00:00Z"}),
    )
    .await;
    mount(
        server,
        "/item/public_token/exchange",
        json!({"access_token":"access","item_id":"item"}),
    )
    .await;
    mount(
        server,
        "/item/get",
        json!({"item":{"available_products":["investments"]}}),
    )
    .await;
    mount(
        server,
        "/institutions/get_by_id",
        json!({"institution":{"name":"Institution","url":"https://institution.example"}}),
    )
    .await;
    mount_accounts(server).await;
}

pub async fn mount_accounts(server: &MockServer) {
    mount(
        server,
        "/accounts/get",
        json!({"accounts":[{"account_id":"acc","name":"Checking","type":"depository","subtype":"checking","mask":"0000"}]}),
    )
    .await;
}

pub async fn mount_transactions_sync(server: &MockServer, cursor: &str, response: serde_json::Value) {
    mount_transactions_sync_response(server, cursor, ResponseTemplate::new(200).set_body_json(response), None).await;
}

pub async fn mount_transactions_sync_error(server: &MockServer, cursor: &str, error_code: &str) {
    mount_transactions_sync_response(
        server,
        cursor,
        ResponseTemplate::new(400).set_body_json(json!({"error_code":error_code})),
        Some(1),
    )
    .await;
}

pub async fn mount_recurring_streams(server: &MockServer, account_ids: &[&str], response: serde_json::Value) {
    Mock::given(method("POST"))
        .and(path("/transactions/recurring/get"))
        .and(body_json(json!({
            "access_token": "token",
            "account_ids": account_ids,
            "client_id": "client",
            "secret": "secret",
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(response))
        .mount(server)
        .await;
}

async fn mount_transactions_sync_response(
    server: &MockServer,
    cursor: &str,
    response: ResponseTemplate,
    max_matches: Option<u64>,
) {
    let mut request = json!({
        "access_token": "token",
        "count": 500,
        "options": {
            "include_original_description": true,
            "include_personal_finance_category": false,
            "include_logo_and_counterparty_beta": false,
            "days_requested": 90,
        },
        "client_id": "client",
        "secret": "secret",
    });
    if !cursor.is_empty() {
        request["cursor"] = json!(cursor);
    }
    let mock = Mock::given(method("POST"))
        .and(path("/transactions/sync"))
        .and(body_json(request))
        .respond_with(response);
    let mock = if let Some(max_matches) = max_matches { mock.up_to_n_times(max_matches) } else { mock };
    mock.mount(server).await;
}

pub async fn mount_balance(server: &MockServer, response: serde_json::Value) {
    mount(server, "/accounts/balance/get", response).await;
}

pub async fn mount_holdings(server: &MockServer, response: serde_json::Value) {
    mount(server, "/investments/holdings/get", response).await;
}

pub async fn mount_investments_transactions(server: &MockServer, response: serde_json::Value) {
    mount(server, "/investments/transactions/get", response).await;
}

pub async fn mount_investments_transactions_page(server: &MockServer, offset: usize, response: serde_json::Value) {
    Mock::given(method("POST"))
        .and(path("/investments/transactions/get"))
        .and(body_partial_json(json!({"options": {"offset": offset}})))
        .respond_with(ResponseTemplate::new(200).set_body_json(response))
        .mount(server)
        .await;
}

pub async fn mount(server: &MockServer, endpoint: &str, response: serde_json::Value) {
    Mock::given(method("POST"))
        .and(path(endpoint))
        .respond_with(ResponseTemplate::new(200).set_body_json(response))
        .mount(server)
        .await;
}
