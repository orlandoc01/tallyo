use std::{
    collections::HashSet,
    sync::{Arc, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard},
    time::Duration,
};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use tokio::sync::{Mutex, MutexGuard};
use url::Url;
use webauthn_rs_core::WebauthnCore;

use crate::{middleware::client_ip::ClientIpResolver, schema::Role, utils::timezone::normalize_timezone};

use super::{
    AuthSettings, Config, DcrSettings, EmailSender, EmailSettings, GoogleClient, GoogleSettings, MasterPasswordStatus,
    SigningKey, Store, WebAuthnRpConfig, WebAuthnSettings, code_challenge, random_token, scopes_for_role,
    token_signature,
};

struct Runtime {
    dcr_settings: DcrSettings,
    setup_complete: bool,
    auth: AuthSettings,
    email: EmailSettings,
    google_settings: GoogleSettings,
    google: Option<GoogleClient>,
    webauthn: WebAuthnSettings,
    webauthn_rp: Option<WebAuthnRpConfig>,
    webauthn_core: Option<WebauthnCore>,
    dev_origins: HashSet<String>,
    sender: Arc<EmailSender>,
}

pub struct Service {
    store: Store,
    signing_key: SigningKey,
    runtime: RwLock<Runtime>,
    timezone: TimezoneCache,
    http: reqwest::Client,
    client_ip_resolver: ClientIpResolver,
    token_mu: Mutex<()>,
}

#[derive(Clone)]
pub struct TimezoneCache(Arc<RwLock<String>>);

impl TimezoneCache {
    pub fn new(timezone: &str) -> Self {
        Self(Arc::new(RwLock::new(normalize_timezone(timezone))))
    }
    pub fn timezone(&self) -> String {
        self.value().clone()
    }
    pub fn set_timezone(&self, timezone: &str) {
        *self.value_mut() = normalize_timezone(timezone);
    }
    fn value(&self) -> RwLockReadGuard<'_, String> {
        self.0.read().unwrap_or_else(PoisonError::into_inner)
    }
    fn value_mut(&self) -> RwLockWriteGuard<'_, String> {
        self.0.write().unwrap_or_else(PoisonError::into_inner)
    }
}

impl Service {
    pub async fn new(mut config: Config, pool: sqlx::SqlitePool) -> Result<Self> {
        super::config::normalize_auth_settings(&mut config.auth)?;
        let webauthn_rp = validate_webauthn(&config.auth.issuer_url, &mut config.webauthn)?;
        let webauthn_core = webauthn_rp.as_ref().map(super::webauthn::new_core).transpose()?;
        if config.auth.disable_all_auth {
            tracing::warn!(
                issuer = config.auth.issuer_url,
                "all authentication is disabled; do not expose this server outside a trusted network"
            );
        }
        let store = Store::new(pool);
        let signing_key = store.load_or_create_signing_key().await?;
        store
            .upsert_frontend_client(&config.auth.frontend_redirect_uris)
            .await?;
        let sender = super::email::new_sender(&config.email);
        let dev_origins = normalize_origins(&config.auth.dev_cors_allowed_origins);
        let timezone = TimezoneCache::new(&config.timezone);
        let http = reqwest::Client::new();
        let google = google_client(&http, &config.google, &config.auth.issuer_url)?;
        Ok(Self {
            store,
            signing_key,
            runtime: RwLock::new(Runtime {
                dcr_settings: config.dcr_settings,
                setup_complete: config.setup_complete,
                auth: config.auth,
                email: config.email,
                google_settings: config.google,
                google,
                webauthn: config.webauthn,
                webauthn_rp,
                webauthn_core,
                dev_origins,
                sender,
            }),
            timezone,
            http,
            client_ip_resolver: config.client_ip_resolver,
            token_mu: Mutex::new(()),
        })
    }

    pub fn store(&self) -> &Store {
        &self.store
    }
    pub fn issuer_url(&self) -> String {
        self.runtime().auth.issuer_url.clone()
    }
    pub fn oauth_enabled(&self) -> bool {
        self.runtime().auth.oauth_enabled
    }
    pub fn email_enabled(&self) -> bool {
        self.runtime().email.enabled
    }
    pub fn google_enabled(&self) -> bool {
        self.runtime().google.is_some()
    }
    pub fn passkey_enabled(&self) -> bool {
        self.runtime().webauthn.enabled
    }
    pub fn disable_all_auth(&self) -> bool {
        self.runtime().auth.disable_all_auth
    }
    pub fn timezone(&self) -> String {
        self.timezone.timezone()
    }
    pub fn timezone_cache(&self) -> TimezoneCache {
        self.timezone.clone()
    }
    pub fn setup_complete(&self) -> bool {
        self.runtime().setup_complete
    }
    pub fn dcr_settings(&self) -> DcrSettings {
        self.runtime().dcr_settings.clone()
    }
    pub fn update_setup_complete(&self, complete: bool) {
        self.runtime_mut().setup_complete = complete;
    }
    pub fn update_dcr_settings(&self, settings: DcrSettings) {
        self.runtime_mut().dcr_settings = settings;
    }
    pub fn client_ip_resolver(&self) -> ClientIpResolver {
        self.client_ip_resolver.clone()
    }
    pub fn dev_origin_allowed(&self, origin: &str) -> bool {
        self.runtime().dev_origins.contains(origin)
    }
    pub fn email_sender(&self) -> Arc<EmailSender> {
        Arc::clone(&self.runtime().sender)
    }
    pub fn google_settings(&self) -> GoogleSettings {
        self.runtime().google_settings.clone()
    }
    pub fn google_client(&self) -> Option<GoogleClient> {
        self.runtime().google.clone()
    }
    pub fn webauthn_rp(&self) -> Option<WebAuthnRpConfig> {
        self.runtime().webauthn_rp.clone()
    }
    pub(super) fn webauthn_core(&self) -> Option<WebauthnCore> {
        self.runtime().webauthn_core.clone()
    }
    pub fn master_password(&self) -> Option<crate::config::MasterPassword> {
        self.runtime().auth.master_password.clone()
    }
    pub fn master_password_status(&self) -> MasterPasswordStatus {
        let runtime = self.runtime();
        match (&runtime.auth.master_password, runtime.auth.master_password_from_env) {
            (None, _) => MasterPasswordStatus::Disabled,
            (Some(_), true) => MasterPasswordStatus::EnvVarOverride,
            (Some(_), false) => MasterPasswordStatus::Enabled,
        }
    }

    pub(super) fn access_token_lifetime(&self) -> Duration {
        self.runtime().auth.access_token_lifetime
    }

    pub(super) fn refresh_token_lifetime(&self) -> Duration {
        self.runtime().auth.refresh_token_lifetime
    }

    pub(super) async fn token_lock(&self) -> MutexGuard<'_, ()> {
        self.token_mu.lock().await
    }

    pub async fn prepare_auth_settings(&self, mut next: AuthSettings) -> Result<impl FnOnce() + Send + '_> {
        super::config::normalize_auth_settings(&mut next)?;
        self.store.upsert_frontend_client(&next.frontend_redirect_uris).await?;
        let origins = normalize_origins(&next.dev_cors_allowed_origins);
        let google = google_client(&self.http, &self.google_settings(), &next.issuer_url)?;
        let service = self;
        Ok(move || {
            let mut current = service.runtime_mut();
            if next.master_password_from_env {
                next.master_password = current.auth.master_password.take();
            }
            current.auth = next;
            current.dev_origins = origins;
            current.google = google;
        })
    }

    pub fn update_email_settings(&self, settings: EmailSettings) {
        let sender = super::email::new_sender(&settings);
        let mut runtime = self.runtime_mut();
        runtime.email = settings;
        runtime.sender = sender;
    }

    pub fn update_google_settings(&self, settings: GoogleSettings) -> Result<()> {
        let google = google_client(&self.http, &settings, &self.issuer_url())?;
        let mut runtime = self.runtime_mut();
        runtime.google_settings = settings;
        runtime.google = google;
        Ok(())
    }

    pub fn prepare_webauthn_settings(
        &self,
        issuer_url: String,
        mut settings: WebAuthnSettings,
    ) -> Result<impl FnOnce() + Send + '_> {
        let rp = validate_webauthn(&issuer_url, &mut settings)?;
        let webauthn_core = rp.as_ref().map(super::webauthn::new_core).transpose()?;
        let google = google_client(&self.http, &self.google_settings(), &issuer_url)?;
        let service = self;
        Ok(move || {
            let mut current = service.runtime_mut();
            current.auth.issuer_url = issuer_url;
            current.webauthn = settings;
            current.webauthn_rp = rp;
            current.webauthn_core = webauthn_core;
            current.google = google;
        })
    }

    pub fn mint_access_token(&self, subject: &str, scopes: &[super::Scope], timezone: &str) -> Result<String> {
        let runtime = self.runtime();
        self.signing_key.mint(
            &runtime.auth.issuer_url,
            subject,
            scopes,
            timezone,
            runtime.auth.access_token_lifetime,
        )
    }

    pub fn verify_access_token(&self, token: &str) -> Result<super::AccessTokenClaims> {
        self.signing_key.verify(token, &self.issuer_url())
    }

    pub async fn build_invite_session(
        &self,
        email: &str,
        role: Role,
        ttl: Duration,
        purpose: &str,
    ) -> Result<(String, DateTime<Utc>)> {
        let verifier = random_token(32);
        let session_id = random_token(16);
        let callback_state = random_token(24);
        let expires_at = Utc::now() + chrono::Duration::from_std(ttl)?;
        let auth = self.runtime().auth.clone();
        let redirect_uri = auth
            .frontend_redirect_uris
            .first()
            .context("frontend redirect uri is required")?
            .clone();
        self.store
            .create_login_session(&super::LoginSession {
                id: session_id.clone(),
                client_id: super::FRONTEND_CLIENT_ID.to_owned(),
                redirect_uri,
                state: String::new(),
                code_challenge: code_challenge(&verifier),
                code_challenge_method: "S256".to_owned(),
                scopes: scopes_for_role(role)
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(" "),
                callback_state,
                subject: String::new(),
                authenticated: false,
                expires_at: expires_at.into(),
                email: String::new(),
                email_otp: String::new(),
                email_otp_expires_at: None,
                email_otp_attempts: 0,
                email_magic_token: String::new(),
                pkce_verifier: String::new(),
                webauthn_session: String::new(),
                purpose: purpose.to_owned(),
            })
            .await?;
        let token = random_token(32);
        self.store
            .save_email_otp(&super::EmailOtpUpdate {
                session_id: session_id.clone(),
                email: email.to_owned(),
                hashed_otp: String::new(),
                hashed_magic_token: token_signature(&token),
                pkce_verifier: verifier,
                expires_at,
            })
            .await?;
        Ok((
            super::email::magic_link_url(&auth.issuer_url, &token, &session_id, email, purpose == "passkey"),
            expires_at,
        ))
    }

    fn runtime(&self) -> RwLockReadGuard<'_, Runtime> {
        self.runtime.read().unwrap_or_else(PoisonError::into_inner)
    }

    fn runtime_mut(&self) -> RwLockWriteGuard<'_, Runtime> {
        self.runtime.write().unwrap_or_else(PoisonError::into_inner)
    }
}

fn google_client(http: &reqwest::Client, settings: &GoogleSettings, issuer_url: &str) -> Result<Option<GoogleClient>> {
    settings
        .enabled
        .then(|| GoogleClient::new(http.clone(), settings.clone(), issuer_url.to_owned()))
        .transpose()
}

fn normalize_origins(origins: &[String]) -> HashSet<String> {
    origins
        .iter()
        .map(|origin| origin.trim().trim_end_matches('/'))
        .filter(|origin| !origin.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn validate_webauthn(issuer_url: &str, settings: &mut WebAuthnSettings) -> Result<Option<WebAuthnRpConfig>> {
    if !settings.enabled {
        return Ok(None);
    }
    let issuer = Url::parse(issuer_url).context("parse issuer url")?;
    if settings.rp_id.is_empty() {
        settings.rp_id = issuer.host_str().unwrap_or_default().to_owned();
    }
    if settings.rp_origins.is_empty() {
        settings.rp_origins.push(format!(
            "{}://{}",
            issuer.scheme(),
            issuer.host_str().context("issuer host is required")?
        ));
    }
    if settings.rp_display_name.is_empty() {
        settings.rp_display_name = "Tallyo".to_owned();
    }
    let rp_origins = settings
        .rp_origins
        .iter()
        .map(|origin| {
            let parsed = Url::parse(origin).with_context(|| format!("invalid webauthn origin {origin:?}"))?;
            anyhow::ensure!(
                matches!(parsed.scheme(), "http" | "https")
                    && parsed.host_str().is_some()
                    && parsed.username().is_empty()
                    && parsed.password().is_none()
                    && matches!(parsed.path(), "" | "/")
                    && parsed.query().is_none()
                    && parsed.fragment().is_none(),
                "invalid webauthn origin {origin:?}"
            );
            let host = parsed.host_str().unwrap();
            anyhow::ensure!(
                host == settings.rp_id || host.ends_with(&format!(".{}", settings.rp_id)),
                "webauthn origin {origin:?} is outside RP ID {:?}",
                settings.rp_id
            );
            Ok(format!("{}://{}", parsed.scheme(), parsed.host_str().unwrap()))
        })
        .collect::<Result<Vec<_>>>()?;
    settings.rp_origins = rp_origins.clone();
    Ok(Some(WebAuthnRpConfig {
        rp_id: settings.rp_id.clone(),
        rp_display_name: settings.rp_display_name.clone(),
        rp_origins,
    }))
}

#[cfg(test)]
mod tests {
    use super::{
        AuthSettings, Config, DcrSettings, MasterPasswordStatus, Service, WebAuthnSettings, validate_webauthn,
    };
    use crate::{config::MasterPassword, database::dbtest, middleware::client_ip::ClientIpResolver};

    async fn service(auth: AuthSettings) -> Service {
        Service::new(
            Config::new(auth, ClientIpResolver::new(&[]).unwrap()),
            dbtest::open().await.unwrap(),
        )
        .await
        .unwrap()
    }

    fn auth_settings() -> AuthSettings {
        AuthSettings {
            issuer_url: "https://tallyo.test".to_owned(),
            oauth_enabled: true,
            frontend_redirect_uris: vec!["https://web.test/callback".to_owned()],
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn initializes_plain_config_values_and_applies_live_updates() {
        let settings = DcrSettings {
            enabled: true,
            dynamic_redirect_hosts: vec!["client.test".to_owned()],
        };
        let service = Service::new(
            Config {
                dcr_settings: settings.clone(),
                setup_complete: false,
                timezone: " America/Los_Angeles ".to_owned(),
                ..Config::new(auth_settings(), ClientIpResolver::new(&[]).unwrap())
            },
            dbtest::open().await.unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(service.dcr_settings(), settings);
        assert!(!service.setup_complete());
        assert_eq!(service.timezone(), "America/Los_Angeles");

        service.update_dcr_settings(DcrSettings::default());
        service.update_setup_complete(true);
        let timezone = service.timezone_cache();
        timezone.set_timezone("Europe/London");
        assert_eq!(service.dcr_settings(), DcrSettings::default());
        assert!(service.setup_complete());
        assert_eq!(service.timezone(), "Europe/London");
    }

    #[tokio::test]
    async fn stages_auth_settings_until_the_commit_closure_runs() {
        let service = service(auth_settings()).await;
        let mut next = auth_settings();
        next.issuer_url = "https://next.test".to_owned();
        let apply = service.prepare_auth_settings(next).await.unwrap();
        assert_eq!(service.issuer_url(), "https://tallyo.test");
        apply();
        assert_eq!(service.issuer_url(), "https://next.test");

        assert!(
            service
                .prepare_auth_settings(AuthSettings {
                    oauth_enabled: true,
                    ..Default::default()
                })
                .await
                .is_err()
        );
        assert_eq!(service.issuer_url(), "https://next.test");
    }

    #[tokio::test]
    async fn keeps_the_environment_master_password_across_auth_updates() {
        let env_password = MasterPassword::try_from("env-password".to_owned()).unwrap();
        let service = service(AuthSettings {
            master_password: Some(env_password.clone()),
            master_password_from_env: true,
            ..auth_settings()
        })
        .await;
        let apply = service
            .prepare_auth_settings(AuthSettings {
                master_password: Some(MasterPassword::try_from("configured".to_owned()).unwrap()),
                master_password_from_env: true,
                ..auth_settings()
            })
            .await
            .unwrap();
        apply();
        assert_eq!(service.master_password(), Some(env_password));
        assert_eq!(service.master_password_status(), MasterPasswordStatus::EnvVarOverride);
    }

    #[tokio::test]
    async fn reports_each_master_password_state() {
        for (password, from_env, expected) in [
            (None, false, MasterPasswordStatus::Disabled),
            (
                Some(MasterPassword::try_from("password".to_owned()).unwrap()),
                false,
                MasterPasswordStatus::Enabled,
            ),
            (
                Some(MasterPassword::try_from("password".to_owned()).unwrap()),
                true,
                MasterPasswordStatus::EnvVarOverride,
            ),
        ] {
            let service = service(AuthSettings {
                master_password: password,
                master_password_from_env: from_env,
                ..auth_settings()
            })
            .await;
            assert_eq!(service.master_password_status(), expected);
        }
    }

    #[test]
    fn validates_webauthn_origins_against_the_rp_id() {
        let mut defaults = WebAuthnSettings {
            enabled: true,
            ..Default::default()
        };
        let rp = validate_webauthn("https://auth.tallyo.test", &mut defaults)
            .unwrap()
            .unwrap();
        assert_eq!(rp.rp_id, "auth.tallyo.test");
        assert_eq!(rp.rp_origins, ["https://auth.tallyo.test"]);

        let mut outside = WebAuthnSettings {
            enabled: true,
            rp_id: "tallyo.test".to_owned(),
            rp_origins: vec!["https://other.test".to_owned()],
            ..Default::default()
        };
        assert!(validate_webauthn("https://auth.tallyo.test", &mut outside).is_err());

        for origin in [
            "https://auth.tallyo.test/path",
            "https://auth.tallyo.test?query=value",
            "https://person@auth.tallyo.test",
        ] {
            let mut invalid = WebAuthnSettings {
                enabled: true,
                rp_id: "tallyo.test".to_owned(),
                rp_origins: vec![origin.to_owned()],
                ..Default::default()
            };
            assert!(validate_webauthn("https://auth.tallyo.test", &mut invalid).is_err());
        }
    }
}
