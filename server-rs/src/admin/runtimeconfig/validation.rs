use std::{net::IpAddr, str::FromStr};

use anyhow::{Result, anyhow, bail, ensure};
use chrono_tz::Tz;
use url::Url;

use crate::{apierror::ApiError, middleware::client_ip::parse_trusted_proxy_cidrs};

use super::{LlmConfig, LocaleConfig, McpConfig, Provider, Sections, SecurityConfig, WebAuthnConfig};

const AUTH_METHOD_REQUIRED: &str =
    "at least one auth method required: configure MASTER_PASSWORD or enable google, email, or passkey";
const DISABLE_ALL_AUTH_ISSUER: &str = "DISABLE_ALL_AUTH is only allowed with a localhost http oauth_issuer_url";
const OAUTH_ISSUER_REQUIRED: &str = "oauth auth methods require oauth_issuer_url to be configured";
const OAUTH_REDIRECT_REQUIRED: &str = "oauth auth methods require at least one frontend_redirect_uris value";
const OAUTH_LIFETIME_REQUIRED: &str = "access_token_lifetime and refresh_token_lifetime must be greater than zero";
const TIMEZONE_REQUIRED: &str = "timezone is required";
const OLLAMA_URL_REQUIRED: &str = "ollama url is required when the ollama provider is enabled";

pub(super) fn validate_runtime_config(config: &Sections) -> Result<()> {
    let auth = &config.auth.fields;
    if config.auth.stored && !config.auth.enabled {
        validate_disable_all_auth_issuer(&auth.oauth_issuer_url)?;
    }
    if !config.setup_complete.enabled {
        return Ok(());
    }
    if auth.master_password.is_none() && !config.oauth_enabled() {
        return Err(ApiError::bad_input(AUTH_METHOD_REQUIRED).into());
    }
    if !config.oauth_enabled() {
        return Ok(());
    }
    ensure!(
        !auth.oauth_issuer_url.is_empty(),
        ApiError::bad_input(OAUTH_ISSUER_REQUIRED)
    );
    ensure!(
        !auth.frontend_redirect_uris.is_empty(),
        ApiError::bad_input(OAUTH_REDIRECT_REQUIRED)
    );
    ensure!(
        !auth.access_token_lifetime().is_zero() && !auth.refresh_token_lifetime().is_zero(),
        ApiError::bad_input(OAUTH_LIFETIME_REQUIRED)
    );
    Ok(())
}

pub(super) fn validate_disable_all_auth_issuer(issuer: &str) -> Result<()> {
    if issuer.is_empty() {
        return Ok(());
    }
    let parsed = Url::parse(issuer).map_err(|error| anyhow!("parse oauth_issuer_url: {error}"))?;
    ensure!(
        parsed.scheme() == "http" && is_localhost(parsed.host_str().unwrap_or_default()),
        ApiError::bad_input(DISABLE_ALL_AUTH_ISSUER)
    );
    Ok(())
}

fn is_localhost(host: &str) -> bool {
    host == "localhost" || IpAddr::from_str(host).is_ok_and(|address| address.is_loopback())
}

impl LocaleConfig {
    pub(crate) fn validate(&self, _: bool) -> Result<()> {
        let timezone = self.timezone.trim();
        ensure!(!timezone.is_empty(), ApiError::bad_input(TIMEZONE_REQUIRED));
        Tz::from_str(timezone)
            .map_err(|_| ApiError::public(anyhow!("load locale timezone: unknown time zone {timezone}")))?;
        Ok(())
    }
}

impl SecurityConfig {
    pub(crate) fn validate(&self, _: bool) -> Result<()> {
        parse_trusted_proxy_cidrs(&self.trusted_proxy_cidrs).map_err(ApiError::public)?;
        Ok(())
    }
}

impl WebAuthnConfig {
    pub(crate) fn validate(&self, enabled: bool) -> Result<()> {
        if !enabled {
            return Ok(());
        }
        if let Some(rp_id) = self.webauthn_rp_id.as_deref()
            && (!rp_id.is_empty()
                && Url::parse(&format!("https://{rp_id}"))
                    .ok()
                    .and_then(|parsed| parsed.host_str().map(str::to_owned))
                    .as_deref()
                    != Some(rp_id))
        {
            return Err(ApiError::bad_input(format!(
                "invalid webauthn_rp_id {rp_id:?}: use a valid bare hostname without scheme or port"
            ))
            .into());
        }
        for origin in &self.webauthn_rp_origins {
            let valid =
                Url::parse(origin).is_ok_and(|parsed| !parsed.scheme().is_empty() && parsed.host_str().is_some());
            ensure!(
                valid,
                ApiError::bad_input(format!(
                    "invalid webauthn_rp_origins entry {origin:?}: must be an absolute URL"
                ))
            );
        }
        Ok(())
    }
}

impl LlmConfig {
    pub(crate) fn validate(&self, enabled: bool) -> Result<()> {
        if !enabled {
            return Ok(());
        }
        if let Some(Provider::Unknown(provider)) = &self.provider {
            bail!("unknown llm provider {provider:?}");
        }
        let url = self.ollama.url.as_deref().unwrap_or_default();
        let trimmed = url.trim();
        ensure!(!trimmed.is_empty(), ApiError::bad_input(OLLAMA_URL_REQUIRED));
        let valid = Url::parse(trimmed)
            .is_ok_and(|parsed| parsed.host_str().is_some() && matches!(parsed.scheme(), "http" | "https"));
        ensure!(
            valid,
            ApiError::bad_input(format!("invalid ollama url {url:?}: must be an absolute URL"))
        );
        Ok(())
    }
}

impl McpConfig {
    pub(crate) fn normalize(&self) -> Result<Self> {
        let dynamic_redirect_hosts = self
            .dynamic_redirect_hosts
            .iter()
            .map(|host| host.trim().to_lowercase())
            .filter(|host| !host.is_empty())
            .map(|host| {
                ensure!(
                    !host.contains(['/', ':']),
                    ApiError::bad_input(format!(
                        "invalid dynamic redirect host {host:?}: use a bare hostname without scheme, path, or port"
                    ))
                );
                Ok(host)
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Self { dynamic_redirect_hosts })
    }
}

#[cfg(test)]
mod tests {
    use super::{McpConfig, Sections, WebAuthnConfig, validate_disable_all_auth_issuer, validate_runtime_config};
    use crate::admin::{LlmConfig, LocaleConfig, Provider, Section, SecurityConfig};

    #[test]
    fn validates_runtime_configuration_requirements() {
        let complete = Sections {
            setup_complete: Section {
                enabled: true,
                ..Default::default()
            },
            ..Default::default()
        };
        assert_eq!(
            validate_runtime_config(&complete).unwrap_err().to_string(),
            super::AUTH_METHOD_REQUIRED
        );
        assert!(validate_runtime_config(&Sections::default()).is_ok());
    }

    #[test]
    fn validates_each_config_section() {
        assert_eq!(
            LocaleConfig::default().validate(false).unwrap_err().to_string(),
            super::TIMEZONE_REQUIRED
        );
        assert_eq!(
            LocaleConfig {
                timezone: "Not/AZone".to_owned(),
            }
            .validate(false)
            .unwrap_err()
            .to_string(),
            "load locale timezone: unknown time zone Not/AZone"
        );
        assert!(
            LocaleConfig {
                timezone: "America/Los_Angeles".to_owned(),
            }
            .validate(false)
            .is_ok()
        );

        assert!(
            WebAuthnConfig {
                webauthn_rp_id: Some("example.com:8080".to_owned()),
                ..Default::default()
            }
            .validate(false)
            .is_ok()
        );
        assert_eq!(
            WebAuthnConfig {
                webauthn_rp_id: Some("example.com:8080".to_owned()),
                ..Default::default()
            }
            .validate(true)
            .unwrap_err()
            .to_string(),
            "invalid webauthn_rp_id \"example.com:8080\": use a valid bare hostname without scheme or port"
        );
        assert_eq!(
            LlmConfig::default().validate(true).unwrap_err().to_string(),
            super::OLLAMA_URL_REQUIRED
        );
        assert!(LlmConfig::default().validate(false).is_ok());
        assert_eq!(
            LlmConfig {
                provider: Some(Provider::Unknown("future-provider".to_owned())),
                ..Default::default()
            }
            .validate(true)
            .unwrap_err()
            .to_string(),
            "unknown llm provider \"future-provider\""
        );
        assert!(
            SecurityConfig {
                trusted_proxy_cidrs: vec!["10.0.0.0/8".to_owned()],
            }
            .validate(false)
            .is_ok()
        );
    }

    #[test]
    fn normalizes_mcp_hosts_and_rejects_unsafe_values() {
        assert_eq!(
            McpConfig {
                dynamic_redirect_hosts: vec![" EXAMPLE.COM ".to_owned(), String::new(), "api.example.com".to_owned()],
            }
            .normalize()
            .unwrap()
            .dynamic_redirect_hosts,
            ["example.com", "api.example.com"]
        );
        assert_eq!(
            McpConfig {
                dynamic_redirect_hosts: vec!["example.com:8443".to_owned()],
            }
            .normalize()
            .unwrap_err()
            .to_string(),
            "invalid dynamic redirect host \"example.com:8443\": use a bare hostname without scheme, path, or port"
        );
        assert!(validate_disable_all_auth_issuer("http://localhost:8080").is_ok());
        assert_eq!(
            validate_disable_all_auth_issuer("https://tallyo.test")
                .unwrap_err()
                .to_string(),
            super::DISABLE_ALL_AUTH_ISSUER
        );
    }
}
