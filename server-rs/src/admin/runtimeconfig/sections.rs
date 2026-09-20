use std::time::Duration;

use serde::{Deserialize, Serialize};
use strum_macros::{EnumString, IntoStaticStr};

use super::LlmConfig;

#[derive(Clone, Copy, Debug, EnumString, IntoStaticStr, Eq, PartialEq)]
#[strum(serialize_all = "SCREAMING_SNAKE_CASE")]
pub enum SectionId {
    #[strum(serialize = "AUTHORIZATION")]
    Auth,
    Email,
    General,
    Google,
    Llm,
    Locale,
    Mcp,
    Security,
    SetupComplete,
    #[strum(serialize = "WEBAUTHN")]
    WebAuthn,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Section<T> {
    pub stored: bool,
    pub enabled: bool,
    pub fields: T,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Sections {
    pub auth: Section<AuthConfig>,
    pub email: Section<EmailConfig>,
    pub general: Section<GeneralConfig>,
    pub google: Section<GoogleConfig>,
    pub llm: Section<LlmConfig>,
    pub locale: Section<LocaleConfig>,
    pub mcp: Section<McpConfig>,
    pub security: Section<SecurityConfig>,
    pub setup_complete: Section<SetupCompleteConfig>,
    pub webauthn: Section<WebAuthnConfig>,
}

impl Sections {
    pub fn oauth_enabled(&self) -> bool {
        self.google.enabled || self.email.enabled || self.webauthn.enabled
    }

    pub fn disable_all_auth(&self) -> bool {
        (self.auth.stored && !self.auth.enabled)
            || (!self.setup_complete.enabled && !self.auth.fields.has_master_password())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SectionPatch<T> {
    pub enabled: bool,
    pub fields: T,
}

impl<T: Default> Default for SectionPatch<T> {
    fn default() -> Self {
        Self {
            enabled: false,
            fields: T::default(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Patch {
    pub auth: Option<SectionPatch<AuthConfig>>,
    pub email: Option<SectionPatch<EmailConfig>>,
    pub general: Option<SectionPatch<GeneralConfig>>,
    pub google: Option<SectionPatch<GoogleConfig>>,
    pub llm: Option<SectionPatch<LlmConfig>>,
    pub locale: Option<SectionPatch<LocaleConfig>>,
    pub mcp: Option<SectionPatch<McpConfig>>,
    pub security: Option<SectionPatch<SecurityConfig>>,
    pub setup_complete: Option<SectionPatch<SetupCompleteConfig>>,
    pub webauthn: Option<SectionPatch<WebAuthnConfig>>,
}

impl Patch {
    pub(crate) fn section_ids(&self) -> Vec<SectionId> {
        [
            self.auth.as_ref().map(|_| SectionId::Auth),
            self.email.as_ref().map(|_| SectionId::Email),
            self.general.as_ref().map(|_| SectionId::General),
            self.google.as_ref().map(|_| SectionId::Google),
            self.llm.as_ref().map(|_| SectionId::Llm),
            self.locale.as_ref().map(|_| SectionId::Locale),
            self.mcp.as_ref().map(|_| SectionId::Mcp),
            self.security.as_ref().map(|_| SectionId::Security),
            self.setup_complete.as_ref().map(|_| SectionId::SetupComplete),
            self.webauthn.as_ref().map(|_| SectionId::WebAuthn),
        ]
        .into_iter()
        .flatten()
        .collect()
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct AuthConfig {
    pub access_token_lifetime: String,
    pub dev_cors_allowed_origins: Vec<String>,
    pub frontend_redirect_uris: Vec<String>,
    pub master_password: Option<String>,
    pub oauth_issuer_url: String,
    pub refresh_token_lifetime: String,
}

impl AuthConfig {
    pub(super) fn has_master_password(&self) -> bool {
        self.master_password
            .as_deref()
            .is_some_and(|password| !password.is_empty())
    }

    pub fn access_token_lifetime(&self) -> Duration {
        parse_duration(&self.access_token_lifetime).unwrap_or_default()
    }

    pub fn refresh_token_lifetime(&self) -> Duration {
        parse_duration(&self.refresh_token_lifetime).unwrap_or_default()
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct EmailConfig {
    pub smtp_from: Option<String>,
    pub smtp_host: Option<String>,
    pub smtp_password: Option<String>,
    pub smtp_port: String,
    pub smtp_username: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct GoogleConfig {
    pub google_client_id: Option<String>,
    pub google_client_secret: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct WebAuthnConfig {
    pub webauthn_rp_id: Option<String>,
    pub webauthn_rp_name: String,
    pub webauthn_rp_origins: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct SecurityConfig {
    pub trusted_proxy_cidrs: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct GeneralConfig {
    pub disable_transaction_tracking: bool,
    pub disable_wealth_tracking: bool,
    pub hide_owners: bool,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct McpConfig {
    pub dynamic_redirect_hosts: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(default)]
pub struct LocaleConfig {
    pub timezone: String,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
pub struct SetupCompleteConfig {}

fn parse_duration(value: &str) -> Option<Duration> {
    if value == "0" {
        return Some(Duration::ZERO);
    }
    let value = value.strip_prefix('+').unwrap_or(value);
    if value.starts_with('-') || value.is_empty() {
        return None;
    }

    let mut total = 0_f64;
    let mut remaining = value;
    while !remaining.is_empty() {
        let number_end = remaining
            .char_indices()
            .take_while(|(_, character)| character.is_ascii_digit() || *character == '.')
            .map(|(index, character)| index + character.len_utf8())
            .last()?;
        let number = remaining[..number_end].parse::<f64>().ok()?;
        remaining = &remaining[number_end..];
        let (unit, seconds) = [
            ("ns", 1e-9),
            ("us", 1e-6),
            ("µs", 1e-6),
            ("ms", 1e-3),
            ("s", 1.0),
            ("m", 60.0),
            ("h", 3600.0),
        ]
        .into_iter()
        .find(|(unit, _)| remaining.starts_with(unit))?;
        total += number * seconds;
        remaining = &remaining[unit.len()..];
    }
    Duration::try_from_secs_f64(total).ok()
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{AuthConfig, McpConfig, Patch, Section, SectionId, SectionPatch, Sections};

    #[test]
    fn lists_patched_sections_in_storage_order() {
        let patch = Patch {
            auth: Some(SectionPatch::default()),
            mcp: Some(SectionPatch::<McpConfig>::default()),
            ..Default::default()
        };

        assert_eq!(patch.section_ids(), [SectionId::Auth, SectionId::Mcp]);
        assert_eq!(<&str>::from(SectionId::WebAuthn), "WEBAUTHN");
        assert_eq!("LOCALE".parse(), Ok(SectionId::Locale));
        assert!("UNKNOWN".parse::<SectionId>().is_err());
    }

    #[test]
    fn resolves_authentication_state_and_go_durations() {
        let no_auth = Sections::default();
        assert!(no_auth.disable_all_auth());
        let empty_password = Sections {
            auth: Section {
                fields: AuthConfig {
                    master_password: Some(String::new()),
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        };
        assert!(empty_password.disable_all_auth());

        let sections = Sections {
            auth: Section {
                stored: true,
                enabled: true,
                fields: AuthConfig {
                    master_password: Some("secret".to_owned()),
                    access_token_lifetime: "1.5h".to_owned(),
                    refresh_token_lifetime: "168h".to_owned(),
                    ..Default::default()
                },
            },
            email: Section {
                enabled: true,
                ..Default::default()
            },
            ..Default::default()
        };

        assert!(sections.oauth_enabled());
        assert!(!sections.disable_all_auth());
        assert_eq!(
            sections.auth.fields.access_token_lifetime(),
            Duration::from_secs(90 * 60)
        );
        assert_eq!(
            sections.auth.fields.refresh_token_lifetime(),
            Duration::from_secs(168 * 60 * 60)
        );
        assert_eq!(AuthConfig::default().access_token_lifetime(), Duration::ZERO);
    }
}
