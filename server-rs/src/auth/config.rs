use std::time::Duration;

use anyhow::Result;
use strum_macros::Display;

use crate::{config::MasterPassword, middleware::client_ip::ClientIpResolver, utils::timezone::FALLBACK_TIMEZONE};

pub const FRONTEND_CLIENT_ID: &str = "tallyo-web";
const ACCESS_TOKEN_LIFETIME: Duration = Duration::from_secs(15 * 60);
const REFRESH_TOKEN_LIFETIME: Duration = Duration::from_secs(168 * 60 * 60);

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DcrSettings {
    pub enabled: bool,
    pub dynamic_redirect_hosts: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthSettings {
    pub issuer_url: String,
    pub oauth_enabled: bool,
    pub disable_all_auth: bool,
    pub master_password: Option<MasterPassword>,
    pub master_password_from_env: bool,
    pub frontend_redirect_uris: Vec<String>,
    pub access_token_lifetime: Duration,
    pub refresh_token_lifetime: Duration,
    pub dev_cors_allowed_origins: Vec<String>,
}

impl Default for AuthSettings {
    fn default() -> Self {
        Self {
            issuer_url: String::new(),
            oauth_enabled: false,
            disable_all_auth: false,
            master_password: None,
            master_password_from_env: false,
            frontend_redirect_uris: Vec::new(),
            access_token_lifetime: ACCESS_TOKEN_LIFETIME,
            refresh_token_lifetime: REFRESH_TOKEN_LIFETIME,
            dev_cors_allowed_origins: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EmailSettings {
    pub enabled: bool,
    pub smtp: Option<SmtpConfig>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub from: String,
    pub credentials: Option<SmtpCredentials>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SmtpCredentials {
    pub username: String,
    pub password: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GoogleSettings {
    pub enabled: bool,
    pub client_id: String,
    pub client_secret: String,
    pub endpoints: GoogleEndpoints,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GoogleEndpoints {
    pub auth: String,
    pub token: String,
    pub userinfo: String,
}

impl Default for GoogleEndpoints {
    fn default() -> Self {
        Self {
            auth: "https://accounts.google.com/o/oauth2/auth".to_owned(),
            token: "https://oauth2.googleapis.com/token".to_owned(),
            userinfo: "https://www.googleapis.com/oauth2/v2/userinfo".to_owned(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WebAuthnSettings {
    pub enabled: bool,
    pub rp_id: String,
    pub rp_display_name: String,
    pub rp_origins: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WebAuthnRpConfig {
    pub rp_id: String,
    pub rp_display_name: String,
    pub rp_origins: Vec<String>,
}

#[derive(Clone)]
pub struct Config {
    pub auth: AuthSettings,
    pub email: EmailSettings,
    pub google: GoogleSettings,
    pub webauthn: WebAuthnSettings,
    pub dcr_settings: DcrSettings,
    pub setup_complete: bool,
    pub timezone: String,
    pub client_ip_resolver: ClientIpResolver,
}

impl Config {
    pub fn new(auth: AuthSettings, client_ip_resolver: ClientIpResolver) -> Self {
        Self {
            auth,
            email: EmailSettings::default(),
            google: GoogleSettings::default(),
            webauthn: WebAuthnSettings::default(),
            dcr_settings: DcrSettings::default(),
            setup_complete: true,
            timezone: FALLBACK_TIMEZONE.to_owned(),
            client_ip_resolver,
        }
    }
}

#[derive(Clone, Copy, Debug, Display, PartialEq, Eq)]
#[strum(serialize_all = "SCREAMING_SNAKE_CASE")]
pub enum MasterPasswordStatus {
    Disabled,
    Enabled,
    EnvVarOverride,
}

pub(super) fn normalize_auth_settings(settings: &mut AuthSettings) -> Result<()> {
    settings.issuer_url = settings.issuer_url.trim_end_matches('/').to_owned();
    anyhow::ensure!(
        !settings.oauth_enabled || !settings.issuer_url.is_empty(),
        "oauth issuer url is required"
    );
    if settings.access_token_lifetime.is_zero() {
        settings.access_token_lifetime = ACCESS_TOKEN_LIFETIME;
    }
    if settings.refresh_token_lifetime.is_zero() {
        settings.refresh_token_lifetime = REFRESH_TOKEN_LIFETIME;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ACCESS_TOKEN_LIFETIME, AuthSettings, REFRESH_TOKEN_LIFETIME, normalize_auth_settings};

    #[test]
    fn normalizes_issuer_and_default_lifetimes() {
        let mut settings = AuthSettings {
            issuer_url: "https://tallyo.test///".to_owned(),
            oauth_enabled: true,
            access_token_lifetime: Default::default(),
            refresh_token_lifetime: Default::default(),
            ..Default::default()
        };
        normalize_auth_settings(&mut settings).unwrap();
        assert_eq!(settings.issuer_url, "https://tallyo.test");
        assert_eq!(settings.access_token_lifetime, ACCESS_TOKEN_LIFETIME);
        assert_eq!(settings.refresh_token_lifetime, REFRESH_TOKEN_LIFETIME);
    }

    #[test]
    fn requires_an_issuer_when_oauth_is_enabled() {
        assert_eq!(
            normalize_auth_settings(&mut AuthSettings {
                oauth_enabled: true,
                ..Default::default()
            })
            .unwrap_err()
            .to_string(),
            "oauth issuer url is required"
        );
    }
}
