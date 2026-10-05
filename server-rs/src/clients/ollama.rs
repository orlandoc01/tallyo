use std::time::Duration;

use anyhow::{Context, Result, ensure};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use url::Url;

pub(crate) const BATCH_SIZE_RANGE: &str = "batch size must be between 1 and 200";
const TEMPERATURE_RANGE: &str = "temperature must be between 0.0 and 2.0";
const MAX_OUTPUT_TOKENS_RANGE: &str = "max output tokens must be between 64 and 65535";
const REQUEST_TIMEOUT_RANGE: &str = "request timeout must be between 10 and 3600 seconds";
const OUTPUT_BUDGET_TOO_SMALL: &str = "max output tokens must be at least 20 per transaction in a batch";

const OUTPUT_TOKENS_PER_TRANSACTION: usize = 20;
const LIST_MODELS_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(default)]
pub struct GenerationOptions {
    pub batch_size: usize,
    pub think: bool,
    pub temperature: f64,
    pub max_output_tokens: u32,
    pub request_timeout_seconds: u64,
}

impl Default for GenerationOptions {
    fn default() -> Self {
        Self {
            batch_size: 5,
            think: false,
            temperature: 0.1,
            max_output_tokens: 2048,
            request_timeout_seconds: 300,
        }
    }
}

impl GenerationOptions {
    pub(crate) fn validate(&self) -> Result<()> {
        ensure!((1..=200).contains(&self.batch_size), BATCH_SIZE_RANGE);
        ensure!((0.0..=2.0).contains(&self.temperature), TEMPERATURE_RANGE);
        ensure!((64..=65535).contains(&self.max_output_tokens), MAX_OUTPUT_TOKENS_RANGE);
        ensure!(
            (10..=3600).contains(&self.request_timeout_seconds),
            REQUEST_TIMEOUT_RANGE
        );
        ensure!(
            self.max_output_tokens as usize >= self.batch_size * OUTPUT_TOKENS_PER_TRANSACTION,
            OUTPUT_BUDGET_TOO_SMALL
        );
        Ok(())
    }
}

pub(crate) fn validate_base_url(url: &str) -> Result<()> {
    let valid = Url::parse(url).is_ok_and(|parsed| {
        parsed.host_str().is_some()
            && matches!(parsed.scheme(), "http" | "https")
            && parsed.query().is_none()
            && parsed.fragment().is_none()
    });
    ensure!(
        valid,
        "invalid ollama url {url:?}: must be an absolute http(s) URL without query or fragment"
    );
    Ok(())
}

fn http_client(timeout: Duration) -> Result<Client> {
    Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .context("build Ollama HTTP client")
}

async fn read_ok(response: reqwest::Response) -> Result<String> {
    let status = response.status();
    let body = response.text().await.context("read Ollama response")?;
    if !status.is_success() {
        tracing::warn!(status = status.as_u16(), body, "ollama error response");
    }
    ensure!(status.is_success(), "ollama returned {}", status.as_u16());
    Ok(body)
}

pub(crate) async fn list_models(base_url: &str) -> Result<Vec<String>> {
    let base_url = base_url.trim();
    validate_base_url(base_url)?;
    let response = http_client(LIST_MODELS_TIMEOUT)?
        .get(format!("{}/api/tags", base_url.trim_end_matches('/')))
        .send()
        .await
        .context("ollama http")?;
    let body = read_ok(response).await?;
    Ok(serde_json::from_str::<TagsResponse>(&body)
        .context("decode Ollama tags response")?
        .models
        .into_iter()
        .map(|model| model.name)
        .collect())
}

#[derive(Clone)]
pub struct OllamaClient {
    base_url: String,
    model: String,
    pub(crate) options: GenerationOptions,
    http: Client,
}

impl OllamaClient {
    pub(crate) fn new(
        base_url: impl Into<String>,
        model: impl Into<String>,
        options: GenerationOptions,
    ) -> Result<Self> {
        Ok(Self {
            base_url: base_url.into().trim_end_matches('/').to_owned(),
            model: model.into(),
            http: http_client(Duration::from_secs(options.request_timeout_seconds))?,
            options,
        })
    }

    pub(crate) async fn generate(&self, system: &str, prompt: &str, schema: &serde_json::Value) -> Result<String> {
        let response = self
            .http
            .post(format!("{}/api/generate", self.base_url))
            .json(&GenerateRequest {
                model: &self.model,
                system,
                prompt,
                stream: false,
                format: schema,
                think: self.options.think,
                options: GenerateOptions {
                    temperature: self.options.temperature,
                    num_predict: self.options.max_output_tokens,
                },
            })
            .send()
            .await
            .context("ollama http")?;
        let body = read_ok(response).await?;
        Ok(serde_json::from_str::<GenerateResponse>(&body)
            .context("decode Ollama response")?
            .response)
    }
}

#[derive(Serialize)]
struct GenerateRequest<'a> {
    model: &'a str,
    system: &'a str,
    prompt: &'a str,
    stream: bool,
    format: &'a serde_json::Value,
    think: bool,
    options: GenerateOptions,
}

#[derive(Serialize)]
struct GenerateOptions {
    temperature: f64,
    num_predict: u32,
}

#[derive(Deserialize)]
struct GenerateResponse {
    response: String,
}

#[derive(Deserialize)]
struct TagsResponse {
    models: Vec<TagModel>,
}

#[derive(Deserialize)]
struct TagModel {
    name: String,
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{body_json, method, path},
    };

    use super::{GenerationOptions, OllamaClient, list_models, validate_base_url};

    #[tokio::test]
    async fn sends_configured_generation_options() {
        let server = MockServer::start().await;
        let schema = json!({"type": "object", "properties": {"classifications": {"type": "array"}}});
        Mock::given(method("POST"))
            .and(path("/api/generate"))
            .and(body_json(json!({
                "model": "qwen",
                "system": "you categorize",
                "prompt": "categorize this",
                "stream": false,
                "format": schema,
                "think": false,
                "options": {"temperature": 0.1, "num_predict": 2048}
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"response": "{}", "done": true})))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/generate"))
            .and(body_json(json!({
                "model": "claude",
                "system": "you categorize",
                "prompt": "categorize this",
                "stream": false,
                "format": schema,
                "think": true,
                "options": {"temperature": 0.7, "num_predict": 4096}
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"response": "{\"classifications\":[]}"})))
            .mount(&server)
            .await;

        assert_eq!(
            OllamaClient::new(format!("{}/", server.uri()), "qwen", GenerationOptions::default())
                .unwrap()
                .generate("you categorize", "categorize this", &schema)
                .await
                .unwrap(),
            "{}"
        );
        let options = GenerationOptions {
            batch_size: 50,
            think: true,
            temperature: 0.7,
            max_output_tokens: 4096,
            request_timeout_seconds: 900,
        };
        assert_eq!(
            OllamaClient::new(server.uri(), "claude", options)
                .unwrap()
                .generate("you categorize", "categorize this", &schema)
                .await
                .unwrap(),
            "{\"classifications\":[]}"
        );
    }

    #[tokio::test]
    async fn lists_model_names_and_surfaces_server_errors() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/tags"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "models": [{"name": "llama3:latest", "size": 1}, {"name": "qwen2.5:7b-instruct"}]
            })))
            .mount(&server)
            .await;
        assert_eq!(
            list_models(&format!(" {}/ ", server.uri())).await.unwrap(),
            ["llama3:latest", "qwen2.5:7b-instruct"]
        );

        let failing = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/tags"))
            .respond_with(ResponseTemplate::new(503).set_body_string("overloaded"))
            .mount(&failing)
            .await;
        assert_eq!(
            list_models(&failing.uri()).await.unwrap_err().to_string(),
            "ollama returned 503"
        );
        assert_eq!(
            list_models("ollama:11434").await.unwrap_err().to_string(),
            "invalid ollama url \"ollama:11434\": must be an absolute http(s) URL without query or fragment"
        );
        let unreachable = format!("{:#}", list_models("http://127.0.0.1:1").await.unwrap_err());
        assert!(unreachable.starts_with("ollama http: "), "{unreachable}");
        assert!(unreachable.contains("127.0.0.1:1"), "{unreachable}");

        let malformed = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/tags"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"version": "0.5.0"})))
            .mount(&malformed)
            .await;
        assert_eq!(
            list_models(&malformed.uri()).await.unwrap_err().to_string(),
            "decode Ollama tags response"
        );
    }

    #[test]
    fn rejects_base_urls_with_query_or_fragment() {
        assert!(validate_base_url("http://ollama:11434").is_ok());
        assert!(validate_base_url("http://ollama:11434/admin?").is_err());
        assert!(validate_base_url("http://ollama:11434/#frag").is_err());
        assert!(validate_base_url("ftp://ollama:11434").is_err());
    }

    #[test]
    fn validates_generation_option_ranges() {
        assert!(GenerationOptions::default().validate().is_ok());
        let cases = [
            (
                GenerationOptions {
                    batch_size: 0,
                    ..Default::default()
                },
                super::BATCH_SIZE_RANGE,
            ),
            (
                GenerationOptions {
                    temperature: 3.0,
                    ..Default::default()
                },
                super::TEMPERATURE_RANGE,
            ),
            (
                GenerationOptions {
                    max_output_tokens: 10,
                    ..Default::default()
                },
                super::MAX_OUTPUT_TOKENS_RANGE,
            ),
            (
                GenerationOptions {
                    request_timeout_seconds: 5,
                    ..Default::default()
                },
                super::REQUEST_TIMEOUT_RANGE,
            ),
            (
                GenerationOptions {
                    batch_size: 100,
                    max_output_tokens: 1000,
                    ..Default::default()
                },
                super::OUTPUT_BUDGET_TOO_SMALL,
            ),
        ];
        for (options, message) in cases {
            assert_eq!(options.validate().unwrap_err().to_string(), message);
        }
    }
}
