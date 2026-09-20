use anyhow::Result;

use super::Resolver;
use crate::{
    admin::{
        AuthConfig, EmailConfig, GeneralConfig, GoogleConfig, LlmConfig, LocaleConfig, McpConfig, OllamaConfig, Patch,
        Provider, Section, SectionPatch, SecurityConfig, SetupCompleteConfig, WebAuthnConfig,
    },
    config::Config,
    schema::{
        AuthorizationConfiguration, Configuration, EmailCodeAuthnConfiguration, GeneralConfiguration,
        GoogleAuthnConfiguration, LlmCategorizationConfiguration, LlmProvider, Locale, McpConfiguration,
        OllamaProviderConfiguration, PassKeyAuthnConfiguration, SecurityConfiguration, UpdateConfigurationInput,
        UpdateConfigurationPayload,
    },
    utils::timezone::FALLBACK_TIMEZONE,
};

pub(crate) const OBFUSCATED_SECRET: &str = "********";

impl Resolver {
    pub fn configuration(&self) -> Configuration {
        let config = &self.config;
        let sections = self.admin.manager.sections();
        Configuration {
            config_file_path: config
                .config_file_path
                .as_ref()
                .map(|path| path.display().to_string())
                .filter(|path| !path.is_empty()),
            db_path: config.db_path.display().to_string(),
            port: config.port.to_string(),
            sync_off: config.sync_off,
            locale: locale_configuration(&sections.locale),
            general: general_configuration(&sections.general),
            authorization: authorization_configuration(&sections.auth, config),
            llm_categorization: llm_categorization_configuration(&sections.llm),
            google_authn: google_configuration(&sections.google),
            pass_key_authn: webauthn_configuration(&sections.webauthn),
            email_code_authn: email_configuration(&sections.email),
            mcp: mcp_configuration(&sections.mcp),
            security: security_configuration(&sections.security),
        }
    }

    pub fn general_configuration(&self) -> GeneralConfiguration {
        general_configuration(&self.admin.manager.sections().general)
    }

    pub fn instance_timezone(&self) -> String {
        self.admin.manager.timezone()
    }

    pub async fn update_configuration(&self, input: UpdateConfigurationInput) -> Result<UpdateConfigurationPayload> {
        let current = self.admin.manager.sections();
        let patch = Patch {
            locale: input.locale.map(|locale| SectionPatch {
                enabled: false,
                fields: LocaleConfig {
                    timezone: locale.timezone,
                },
            }),
            general: input.general.map(|general| SectionPatch {
                enabled: true,
                fields: GeneralConfig {
                    disable_transaction_tracking: general.disable_transaction_tracking,
                    disable_wealth_tracking: general.disable_wealth_tracking,
                    hide_owners: general.hide_owners,
                },
            }),
            setup_complete: input.setup_complete.filter(|complete| *complete).map(|_| SectionPatch {
                enabled: true,
                fields: SetupCompleteConfig {},
            }),
            auth: input.authorization.map(|auth| SectionPatch {
                enabled: !auth.disable_all_auth,
                fields: AuthConfig {
                    access_token_lifetime: auth.access_token_lifetime,
                    dev_cors_allowed_origins: auth.dev_cors_allowed_origins.unwrap_or_default(),
                    frontend_redirect_uris: auth.frontend_redirect_uris,
                    master_password: preserve_secret(auth.master_password, &current.auth.fields.master_password),
                    oauth_issuer_url: auth.oauth_issuer_url,
                    refresh_token_lifetime: auth.refresh_token_lifetime,
                },
            }),
            llm: input.llm_categorization.map(|llm| SectionPatch {
                enabled: llm.enabled,
                fields: LlmConfig {
                    provider: Some(Provider::Known(LlmProvider::Ollama)),
                    ollama: OllamaConfig {
                        url: llm.ollama.url,
                        model: llm.ollama.model,
                    },
                },
            }),
            google: input.google_authn.map(|google| SectionPatch {
                enabled: google.enabled,
                fields: GoogleConfig {
                    google_client_id: google.google_client_id,
                    google_client_secret: preserve_secret(
                        google.google_client_secret,
                        &current.google.fields.google_client_secret,
                    ),
                },
            }),
            webauthn: input.pass_key_authn.map(|passkey| SectionPatch {
                enabled: passkey.enabled,
                fields: WebAuthnConfig {
                    webauthn_rp_id: passkey.webauthn_rp_id,
                    webauthn_rp_name: passkey.webauthn_rp_name,
                    webauthn_rp_origins: passkey.webauthn_rp_origins.unwrap_or_default(),
                },
            }),
            email: input.email_code_authn.map(|email| SectionPatch {
                enabled: email.enabled,
                fields: EmailConfig {
                    smtp_from: email.smtp_from,
                    smtp_host: email.smtp_host,
                    smtp_password: preserve_secret(email.smtp_password, &current.email.fields.smtp_password),
                    smtp_port: email.smtp_port,
                    smtp_username: email.smtp_username,
                },
            }),
            mcp: input.mcp.map(|mcp| SectionPatch {
                enabled: mcp.enabled,
                fields: McpConfig {
                    dynamic_redirect_hosts: mcp
                        .dynamic_redirect_hosts
                        .unwrap_or_else(|| current.mcp.fields.dynamic_redirect_hosts.clone()),
                },
            }),
            security: input.security.map(|security| SectionPatch {
                enabled: true,
                fields: SecurityConfig {
                    trusted_proxy_cidrs: clean_string_list(&security.trusted_proxy_cidrs),
                },
            }),
        };
        self.admin.manager.update_sections(patch).await?;
        Ok(UpdateConfigurationPayload {
            configuration: self.configuration(),
        })
    }
}

fn authorization_configuration(section: &Section<AuthConfig>, fallback: &Config) -> AuthorizationConfiguration {
    if !section.stored {
        return AuthorizationConfiguration {
            master_password: secret_value(fallback.authorization.master_password.as_ref().map(|p| p.as_str())),
            disable_all_auth: fallback.authorization.disable_all_auth,
            oauth_issuer_url: String::new(),
            frontend_redirect_uris: Vec::new(),
            access_token_lifetime: String::new(),
            refresh_token_lifetime: String::new(),
            dev_cors_allowed_origins: None,
        };
    }
    let fields = &section.fields;
    AuthorizationConfiguration {
        master_password: secret_value(fields.master_password.as_deref()),
        disable_all_auth: !section.enabled,
        oauth_issuer_url: fields.oauth_issuer_url.clone(),
        frontend_redirect_uris: fields.frontend_redirect_uris.clone(),
        access_token_lifetime: fields.access_token_lifetime.clone(),
        refresh_token_lifetime: fields.refresh_token_lifetime.clone(),
        dev_cors_allowed_origins: string_list_value(&fields.dev_cors_allowed_origins),
    }
}

fn general_configuration(section: &Section<GeneralConfig>) -> GeneralConfiguration {
    GeneralConfiguration {
        disable_transaction_tracking: section.fields.disable_transaction_tracking,
        disable_wealth_tracking: section.fields.disable_wealth_tracking,
        hide_owners: section.fields.hide_owners,
    }
}

fn llm_categorization_configuration(section: &Section<LlmConfig>) -> LlmCategorizationConfiguration {
    LlmCategorizationConfiguration {
        enabled: section.enabled,
        provider: LlmProvider::Ollama,
        allowed_providers: vec![LlmProvider::Ollama],
        ollama: OllamaProviderConfiguration {
            url: nonempty(section.fields.ollama.url.as_deref()),
            model: section.fields.ollama.model.clone(),
        },
    }
}

fn google_configuration(section: &Section<GoogleConfig>) -> GoogleAuthnConfiguration {
    GoogleAuthnConfiguration {
        enabled: section.enabled,
        google_client_id: nonempty(section.fields.google_client_id.as_deref()),
        google_client_secret: secret_value(section.fields.google_client_secret.as_deref()),
    }
}

fn webauthn_configuration(section: &Section<WebAuthnConfig>) -> PassKeyAuthnConfiguration {
    PassKeyAuthnConfiguration {
        enabled: section.enabled,
        webauthn_rp_id: nonempty(section.fields.webauthn_rp_id.as_deref()),
        webauthn_rp_name: section.fields.webauthn_rp_name.clone(),
        webauthn_rp_origins: string_list_value(&section.fields.webauthn_rp_origins),
    }
}

fn email_configuration(section: &Section<EmailConfig>) -> EmailCodeAuthnConfiguration {
    EmailCodeAuthnConfiguration {
        enabled: section.enabled,
        smtp_host: nonempty(section.fields.smtp_host.as_deref()),
        smtp_port: section.fields.smtp_port.clone(),
        smtp_from: nonempty(section.fields.smtp_from.as_deref()),
        smtp_username: nonempty(section.fields.smtp_username.as_deref()),
        smtp_password: secret_value(section.fields.smtp_password.as_deref()),
    }
}

fn mcp_configuration(section: &Section<McpConfig>) -> McpConfiguration {
    McpConfiguration {
        enabled: section.enabled,
        dynamic_redirect_hosts: string_list_value(&section.fields.dynamic_redirect_hosts),
    }
}

fn security_configuration(section: &Section<SecurityConfig>) -> SecurityConfiguration {
    SecurityConfiguration {
        trusted_proxy_cidrs: clean_string_list(&section.fields.trusted_proxy_cidrs),
    }
}

fn locale_configuration(section: &Section<LocaleConfig>) -> Locale {
    Locale {
        timezone: Some(section.fields.timezone.as_str())
            .filter(|timezone| section.stored && !timezone.is_empty())
            .unwrap_or(FALLBACK_TIMEZONE)
            .to_owned(),
    }
}

fn secret_value(value: Option<&str>) -> Option<String> {
    nonempty(value).map(|_| OBFUSCATED_SECRET.to_owned())
}

fn nonempty(value: Option<&str>) -> Option<String> {
    value.filter(|value| !value.is_empty()).map(ToOwned::to_owned)
}

fn string_list_value(values: &[String]) -> Option<Vec<String>> {
    (!values.is_empty()).then(|| values.to_vec())
}

fn clean_string_list(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn preserve_secret(value: Option<String>, current: &Option<String>) -> Option<String> {
    match value {
        Some(value) if value == OBFUSCATED_SECRET => current.clone(),
        value => value,
    }
}
