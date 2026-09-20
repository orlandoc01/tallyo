use std::sync::Arc;

#[cfg(test)]
use std::sync::PoisonError;

use anyhow::Result;

use crate::{
    apierror::ApiError,
    auth::{
        self, AuthSettings, DcrSettings, EmailSettings, GoogleSettings, SmtpConfig, SmtpCredentials, WebAuthnSettings,
    },
    config::MasterPassword,
    middleware::client_ip::ClientIpResolver,
    transactions::{LlmSettings, Syncer},
    utils::future::BoxFuture,
    wealth::balancesync,
};

use super::{EmailConfig, GoogleConfig, Manager, McpConfig, Section, SectionId, Sections, WebAuthnConfig};

type RuntimeCommit<'a> = Box<dyn FnOnce() -> BoxFuture<'a, ()> + Send + 'a>;

#[derive(Clone, Default)]
pub struct RuntimeTargets {
    pub auth: Option<Arc<auth::Service>>,
    pub client_ip: Option<ClientIpResolver>,
    pub syncer: Option<Arc<Syncer>>,
    pub balances: Option<Arc<balancesync::Syncer>>,
}

#[cfg(test)]
#[derive(Default)]
pub(crate) struct RecordingTargets(std::sync::Mutex<Vec<&'static str>>);

#[cfg(test)]
impl RecordingTargets {
    pub(crate) fn events(&self) -> Vec<&'static str> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    fn record(&self, event: &'static str) {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).push(event);
    }
}

impl Manager {
    pub fn auth_config(&self, resolved: &Sections, client_ip_resolver: ClientIpResolver) -> Result<auth::Config> {
        Ok(auth::Config {
            auth: auth_settings(resolved, self.cache().environment.master_password_configured)?,
            email: email_settings(&resolved.email),
            google: google_settings(&resolved.google),
            webauthn: webauthn_settings(&resolved.webauthn),
            dcr_settings: dcr_settings(&resolved.mcp),
            setup_complete: resolved.setup_complete.enabled,
            timezone: self.timezone(),
            client_ip_resolver,
        })
    }

    pub async fn configure_syncer_llm(&self, syncer: &Arc<Syncer>) -> Result<()> {
        let sections = self.sections();
        if let Some(commit) = self.prepare_syncer_llm(&sections.llm, Some(syncer)).await? {
            commit().await;
        }
        Ok(())
    }

    pub(super) async fn prepare<'a>(
        &'a self,
        targets: &'a RuntimeTargets,
        changed: &[SectionId],
        prospective: &Sections,
    ) -> Result<Vec<RuntimeCommit<'a>>> {
        let mut commits: Vec<RuntimeCommit<'a>> = Vec::new();
        if let Some(auth) = targets.auth.as_ref() {
            if overlaps(changed, &[SectionId::Auth, SectionId::WebAuthn]) {
                self.record("prepare");
                let commit = auth
                    .prepare_webauthn_settings(
                        prospective.auth.fields.oauth_issuer_url.clone(),
                        webauthn_settings(&prospective.webauthn),
                    )
                    .map_err(ApiError::public)?;
                commits.push(Box::new(move || Box::pin(async move { commit() })));
            }
            if overlaps(
                changed,
                &[
                    SectionId::Auth,
                    SectionId::Google,
                    SectionId::Email,
                    SectionId::WebAuthn,
                    SectionId::SetupComplete,
                ],
            ) {
                self.record("prepare");
                let resolved = self.resolved(prospective);
                let settings = auth_settings(&resolved, self.cache().environment.master_password_configured)?;
                let commit = auth.prepare_auth_settings(settings).await.map_err(ApiError::public)?;
                commits.push(Box::new(move || Box::pin(async move { commit() })));
            }
        }
        if changed.contains(&SectionId::Llm)
            && let Some(commit) = self
                .prepare_syncer_llm(&prospective.llm, targets.syncer.as_ref())
                .await?
        {
            self.record("prepare");
            commits.push(commit);
        }
        Ok(commits)
    }

    async fn prepare_syncer_llm<'a>(
        &self,
        config: &Section<super::LlmConfig>,
        syncer: Option<&'a Arc<Syncer>>,
    ) -> Result<Option<RuntimeCommit<'a>>> {
        config.fields.validate(config.enabled)?;
        let Some(syncer) = syncer else {
            return Ok(None);
        };
        if config.enabled {
            let settings = LlmSettings {
                url: config.fields.ollama.url.clone().unwrap_or_default(),
                model: config.fields.ollama.model.clone(),
            };
            let commit = syncer.prepare_llm(settings).await?;
            return Ok(Some(Box::new(move || commit())));
        }
        let syncer = Arc::clone(syncer);
        Ok(Some(Box::new(move || {
            Box::pin(async move { syncer.disable_llm().await })
        })))
    }

    pub(super) fn on_change(&self, targets: &RuntimeTargets, changed: &[SectionId]) {
        for id in changed {
            match id {
                SectionId::Email => {
                    if let Some(auth) = targets.auth.as_ref() {
                        auth.update_email_settings(email_settings(&self.sections().email));
                    }
                }
                SectionId::General => {
                    let general = &self.sections().general.fields;
                    if let Some(syncer) = targets.syncer.as_ref() {
                        syncer.update_tracking_disabled(general.disable_transaction_tracking);
                    }
                    if let Some(balances) = targets.balances.as_ref() {
                        balances.update_tracking_disabled(general.disable_wealth_tracking);
                    }
                }
                SectionId::Google => {
                    if let Some(auth) = targets.auth.as_ref()
                        && let Err(error) = auth.update_google_settings(google_settings(&self.sections().google))
                    {
                        tracing::error!(error = %error, "update Google settings failed");
                    }
                }
                SectionId::Locale => {
                    if let Some(auth) = targets.auth.as_ref() {
                        auth.timezone_cache().set_timezone(&self.timezone());
                    }
                }
                SectionId::Mcp => {
                    if let Some(auth) = targets.auth.as_ref() {
                        auth.update_dcr_settings(dcr_settings(&self.sections().mcp));
                    }
                }
                SectionId::Security => {
                    if let Some(client_ip) = targets.client_ip.as_ref()
                        && let Err(error) =
                            client_ip.set_trusted_proxy_cidrs(&self.sections().security.fields.trusted_proxy_cidrs)
                    {
                        tracing::error!(error = %error, "update trusted proxy cidrs failed");
                    }
                }
                SectionId::SetupComplete => {
                    if let Some(auth) = targets.auth.as_ref() {
                        auth.update_setup_complete(self.sections().setup_complete.enabled);
                    }
                }
                SectionId::Auth | SectionId::Llm | SectionId::WebAuthn => continue,
            }
            self.record("callback");
        }
    }

    #[cfg(test)]
    pub(super) fn record(&self, event: &'static str) {
        if let Some(recorder) = self.recorder().as_ref() {
            recorder.record(event);
        }
    }

    #[cfg(not(test))]
    pub(super) fn record(&self, _: &'static str) {}
}

fn overlaps(changed: &[SectionId], interest: &[SectionId]) -> bool {
    changed.iter().any(|id| interest.contains(id))
}

fn auth_settings(sections: &Sections, master_password_from_env: bool) -> Result<AuthSettings> {
    let auth = &sections.auth.fields;
    Ok(AuthSettings {
        issuer_url: auth.oauth_issuer_url.clone(),
        oauth_enabled: sections.oauth_enabled(),
        disable_all_auth: sections.disable_all_auth(),
        master_password: auth
            .master_password
            .as_deref()
            .filter(|password| !password.is_empty())
            .map(|password| MasterPassword::try_from(password.to_owned()))
            .transpose()?,
        master_password_from_env,
        frontend_redirect_uris: auth.frontend_redirect_uris.clone(),
        access_token_lifetime: auth.access_token_lifetime(),
        refresh_token_lifetime: auth.refresh_token_lifetime(),
        dev_cors_allowed_origins: auth.dev_cors_allowed_origins.clone(),
    })
}

fn email_settings(section: &Section<EmailConfig>) -> EmailSettings {
    let fields = &section.fields;
    EmailSettings {
        enabled: section.enabled,
        smtp: fields.smtp_host.as_ref().map(|host| SmtpConfig {
            host: host.clone(),
            port: fields.smtp_port.parse().unwrap_or_default(),
            from: fields.smtp_from.clone().unwrap_or_default(),
            credentials: fields.smtp_username.as_ref().zip(fields.smtp_password.as_ref()).map(
                |(username, password)| SmtpCredentials {
                    username: username.clone(),
                    password: password.clone(),
                },
            ),
        }),
    }
}

fn google_settings(section: &Section<GoogleConfig>) -> GoogleSettings {
    GoogleSettings {
        enabled: section.enabled,
        client_id: section.fields.google_client_id.clone().unwrap_or_default(),
        client_secret: section.fields.google_client_secret.clone().unwrap_or_default(),
        ..Default::default()
    }
}

fn webauthn_settings(section: &Section<WebAuthnConfig>) -> WebAuthnSettings {
    WebAuthnSettings {
        enabled: section.enabled,
        rp_id: section.fields.webauthn_rp_id.clone().unwrap_or_default(),
        rp_display_name: section.fields.webauthn_rp_name.clone(),
        rp_origins: section.fields.webauthn_rp_origins.clone(),
    }
}

fn dcr_settings(section: &Section<McpConfig>) -> DcrSettings {
    DcrSettings {
        enabled: section.enabled,
        dynamic_redirect_hosts: section.fields.dynamic_redirect_hosts.clone(),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::{auth_settings, dcr_settings, email_settings, google_settings, webauthn_settings};
    use crate::{
        admin::{
            AuthConfig, EmailConfig, GoogleConfig, LlmConfig, LocaleConfig, Manager, McpConfig, OllamaConfig, Section,
            Sections,
        },
        database::dbtest,
        middleware::client_ip::ClientIpResolver,
        transactions::Syncer,
    };

    fn stored<T>(fields: T) -> Section<T> {
        Section {
            stored: true,
            enabled: true,
            fields,
        }
    }

    fn fixture() -> Sections {
        Sections {
            auth: stored(AuthConfig {
                oauth_issuer_url: "https://tallyo.test".to_owned(),
                frontend_redirect_uris: vec!["https://web.test/callback".to_owned()],
                access_token_lifetime: "1h".to_owned(),
                refresh_token_lifetime: "720h".to_owned(),
                dev_cors_allowed_origins: vec!["https://web.test".to_owned()],
                master_password: None,
            }),
            email: stored(EmailConfig {
                smtp_host: Some("smtp.test".to_owned()),
                smtp_port: "587".to_owned(),
                smtp_from: Some("no-reply@tallyo.test".to_owned()),
                smtp_username: Some("user".to_owned()),
                smtp_password: Some("secret".to_owned()),
            }),
            google: stored(GoogleConfig {
                google_client_id: Some("client".to_owned()),
                google_client_secret: Some("secret".to_owned()),
            }),
            locale: stored(LocaleConfig {
                timezone: "America/New_York".to_owned(),
            }),
            mcp: stored(McpConfig {
                dynamic_redirect_hosts: vec!["claude.ai".to_owned()],
            }),
            setup_complete: stored(Default::default()),
            ..Default::default()
        }
    }

    #[test]
    fn maps_resolved_auth_settings() {
        let sections = Sections {
            auth: Section {
                stored: true,
                enabled: true,
                fields: AuthConfig {
                    master_password: Some("password".to_owned()),
                    ..Default::default()
                },
            },
            ..Default::default()
        };
        let settings = auth_settings(&sections, false).unwrap();
        assert_eq!(settings.master_password.unwrap().as_str(), "password");
        assert!(!settings.disable_all_auth);
    }

    #[tokio::test]
    async fn auth_config_matches_the_live_update_mapping() {
        let manager = Manager::new(dbtest::open().await.unwrap());
        manager.cache_mut().sections = fixture();
        let resolved = manager.resolve_runtime_config(None, false).unwrap();
        let config = manager
            .auth_config(&resolved, ClientIpResolver::new(&[]).unwrap())
            .unwrap();

        let sections = manager.sections();
        assert_eq!(config.auth, auth_settings(&manager.resolved(&sections), false).unwrap());
        assert_eq!(config.email, email_settings(&sections.email));
        assert_eq!(config.google, google_settings(&sections.google));
        assert_eq!(config.webauthn, webauthn_settings(&sections.webauthn));
        assert_eq!(config.dcr_settings, dcr_settings(&sections.mcp));
        assert!(config.setup_complete);
        assert_eq!(config.timezone, "America/New_York");
    }

    #[tokio::test]
    async fn auth_config_carries_the_environment_master_password() {
        let manager = Manager::new(dbtest::open().await.unwrap());
        manager.load(true, false).await.unwrap();
        let resolved = manager.resolve_runtime_config(Some("env-password"), false).unwrap();
        let config = manager
            .auth_config(&resolved, ClientIpResolver::new(&[]).unwrap())
            .unwrap();
        assert_eq!(config.auth.master_password.unwrap().as_str(), "env-password");
        assert!(config.auth.master_password_from_env);
    }

    #[tokio::test]
    async fn configure_syncer_llm_follows_the_persisted_section() {
        let pool = dbtest::open().await.unwrap();
        let manager = Manager::new(pool.clone());
        let syncer = Arc::new(Syncer::new(pool, Vec::new()));
        manager.configure_syncer_llm(&syncer).await.unwrap();
        assert!(syncer.reprocess_uncategorized().await.is_err());

        manager.cache_mut().sections.llm = stored(LlmConfig {
            provider: None,
            ollama: OllamaConfig {
                url: Some("http://localhost:11434".to_owned()),
                model: "llama3".to_owned(),
            },
        });
        manager.configure_syncer_llm(&syncer).await.unwrap();
        assert!(syncer.reprocess_uncategorized().await.is_ok());
    }
}
