use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};

const TIMEOUT_SECONDS: u64 = 300;

#[derive(Clone)]
pub struct OllamaClient {
    base_url: String,
    model: String,
    http: Client,
}

impl OllamaClient {
    pub fn new(base_url: impl Into<String>, model: impl Into<String>) -> Result<Self> {
        Ok(Self {
            base_url: base_url.into().trim_end_matches('/').to_owned(),
            model: model.into(),
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(TIMEOUT_SECONDS))
                .build()
                .context("build Ollama HTTP client")?,
        })
    }

    pub async fn generate(&self, prompt: &str) -> Result<String> {
        let response = self
            .http
            .post(format!("{}/api/generate", self.base_url))
            .json(&GenerateRequest {
                model: &self.model,
                prompt,
                stream: false,
                format: "json",
                // Think is sent as a literal false (no omitempty) so reasoning models
                // (qwen3, deepseek-r1, …) skip their <think> block and answer directly —
                // essential for fast, structured categorization on CPU. Non-reasoning
                // models (qwen2.5, llama3.1) accept think:false as a no-op.
                think: false,
                options: GenerateOptions {
                    temperature: 0.1,
                    num_predict: 2048,
                },
            })
            .send()
            .await
            .context("ollama http")?;
        let status = response.status();
        if status != reqwest::StatusCode::OK {
            let body = response.text().await.context("read Ollama error response")?;
            anyhow::bail!("ollama returned {}: {body}", status.as_u16());
        }
        let body = response.text().await.context("read Ollama response")?;
        Ok(serde_json::from_str::<GenerateResponse>(&body)
            .context("decode Ollama response")?
            .response)
    }
}

#[derive(Serialize)]
struct GenerateRequest<'a> {
    model: &'a str,
    prompt: &'a str,
    stream: bool,
    format: &'static str,
    think: bool,
    options: GenerateOptions,
}

#[derive(Serialize)]
struct GenerateOptions {
    temperature: f64,
    num_predict: u16,
}

#[derive(Deserialize)]
struct GenerateResponse {
    response: String,
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{body_json, method, path},
    };

    use super::OllamaClient;

    #[tokio::test]
    async fn generates_json_without_reasoning() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/generate"))
            .and(body_json(json!({
                "model": "qwen",
                "prompt": "categorize this",
                "stream": false,
                "format": "json",
                "think": false,
                "options": {"temperature": 0.1, "num_predict": 2048}
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"response": "{}", "done": true})))
            .mount(&server)
            .await;

        assert_eq!(
            OllamaClient::new(format!("{}/", server.uri()), "qwen")
                .unwrap()
                .generate("categorize this")
                .await
                .unwrap(),
            "{}"
        );
    }
}
