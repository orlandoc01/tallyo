use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::json;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

pub fn setup_token(server: &MockServer) -> String {
    STANDARD.encode(format!("{}/claim", server.uri()))
}

pub fn access_url(server: &MockServer) -> String {
    let uri = server.uri();
    let scheme = uri.split_once("://").map_or("http", |(scheme, _)| scheme);
    format!("{scheme}://user:pass@{}/simplefin", server.address())
}

pub async fn mount_claim(server: &MockServer, access_url: &str) {
    Mock::given(method("POST"))
        .and(path("/claim"))
        .respond_with(ResponseTemplate::new(200).set_body_string(access_url))
        .mount(server)
        .await;
}

pub async fn mount_accounts(server: &MockServer, response: serde_json::Value) {
    Mock::given(method("GET"))
        .and(path("/simplefin/accounts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(response))
        .mount(server)
        .await;
}

pub fn full_accounts_response() -> serde_json::Value {
    json!({
        "connections": [{"conn_id":"connection","name":"Bank","org_id":"org","org_name":"Bank","org_url":"https://bank.example"}],
        "accounts": [{
            "id":"account",
            "conn_id":"connection",
            "name":"Checking",
            "currency":"USD",
            "balance":"100.00",
            "available-balance":"90.00",
            "balance-date":1770000000,
            "transactions":[{
                "id":"posted",
                "posted":1770000000,
                "transacted_at":1770000000,
                "amount":"12.34",
                "description":"Coffee",
                "payee":"Coffee Shop"
            },{
                "id":"pending",
                "transacted_at":1770000000,
                "amount":"5.00",
                "description":"Lunch",
                "pending":true
            }]
        }],
        "errlist":[{"conn_id":"failed-connection","message":"provider temporarily unavailable"}]
    })
}
