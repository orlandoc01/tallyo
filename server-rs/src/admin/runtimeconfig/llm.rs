use serde::{Deserialize, Serialize};

use crate::schema::LlmProvider;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct OllamaConfig {
    pub url: Option<String>,
    pub model: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct LlmConfig {
    #[serde(default, skip_serializing_if = "Option::is_none", with = "provider_serde")]
    pub provider: Option<Provider>,
    pub ollama: OllamaConfig,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Provider {
    Known(LlmProvider),
    Unknown(String),
}

mod provider_serde {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    use super::Provider;

    pub(super) fn serialize<S>(provider: &Option<Provider>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        provider
            .as_ref()
            .map(|provider| match provider {
                Provider::Known(provider) => provider.to_string().to_lowercase(),
                Provider::Unknown(provider) => provider.clone(),
            })
            .serialize(serializer)
    }

    pub(super) fn deserialize<'de, D>(deserializer: D) -> Result<Option<Provider>, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(Option::<String>::deserialize(deserializer)?.map(|value| {
            value
                .to_uppercase()
                .parse()
                .map(Provider::Known)
                .unwrap_or(Provider::Unknown(value))
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::{LlmConfig, OllamaConfig, Provider};
    use crate::schema::LlmProvider;

    #[test]
    fn round_trips_ollama_configuration() {
        let config: LlmConfig =
            serde_json::from_str(r#"{"provider":"ollama","ollama":{"url":"http://localhost:11434","model":"llama3"}}"#)
                .unwrap();

        assert_eq!(
            config,
            LlmConfig {
                provider: Some(Provider::Known(LlmProvider::Ollama)),
                ollama: OllamaConfig {
                    url: Some("http://localhost:11434".to_owned()),
                    model: "llama3".to_owned(),
                },
            }
        );
    }

    #[test]
    fn serializes_database_provider_names_and_preserves_unknown_providers() {
        let config = LlmConfig {
            provider: Some(Provider::Known(LlmProvider::Ollama)),
            ollama: OllamaConfig::default(),
        };
        assert_eq!(
            serde_json::to_string(&config).unwrap(),
            r#"{"provider":"ollama","ollama":{"url":null,"model":""}}"#
        );
        assert_eq!(
            serde_json::from_str::<LlmConfig>(r#"{"provider":"unknown"}"#)
                .unwrap()
                .provider,
            Some(Provider::Unknown("unknown".to_owned()))
        );
        assert_eq!(
            serde_json::from_str::<LlmConfig>(r#"{"provider":null}"#)
                .unwrap()
                .provider,
            None
        );
    }
}
