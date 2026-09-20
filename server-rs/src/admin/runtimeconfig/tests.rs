use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use axum::http::{HeaderMap, HeaderValue};

use super::{
    AuthConfig, EmailConfig, GeneralConfig, GoogleConfig, LlmConfig, LocaleConfig, Manager, McpConfig, OllamaConfig,
    Patch, Provider, RuntimeTargets, SectionPatch, SecurityConfig, SetupCompleteConfig, WebAuthnConfig,
};
use crate::{
    accounts::SourceTable,
    admin::store,
    auth::{AuthSettings, Config as AuthConfigSettings, Service},
    config::MasterPassword,
    database::{dbtest, queries},
    middleware::client_ip::ClientIpResolver,
    schema::{LlmProvider, Role},
    transactions::{ItemReport, Persister, SyncAdapter, SyncReport, Syncer},
    utils::future::BoxFuture,
    wealth::balancesync::{PortfolioSyncer, Syncer as BalanceSyncer},
};

#[derive(Default)]
struct CountingAdapter(Arc<AtomicUsize>);

impl SyncAdapter for CountingAdapter {
    fn handles(&self, _: SourceTable) -> bool {
        false
    }

    fn sync_due<'a>(&'a self, _: &'a Persister) -> BoxFuture<'a, SyncReport> {
        self.0.fetch_add(1, Ordering::Relaxed);
        Box::pin(async { SyncReport::default() })
    }

    fn sync_connection_into<'a>(&'a self, _: i64, _: &'a Persister) -> BoxFuture<'a, ItemReport> {
        unreachable!("tracking tests never sync a single connection")
    }
}

#[derive(Default)]
struct CountingPortfolio(AtomicUsize);

impl PortfolioSyncer for CountingPortfolio {
    fn sync<'a>(&'a self) -> BoxFuture<'a, anyhow::Result<()>> {
        self.0.fetch_add(1, Ordering::Relaxed);
        Box::pin(async { Ok(()) })
    }
}

async fn manager_with_targets() -> (
    sqlx::SqlitePool,
    Manager,
    Arc<Service>,
    Arc<super::wiring::RecordingTargets>,
) {
    let pool = dbtest::open().await.unwrap();
    let manager = Manager::new(pool.clone());
    manager.load(true, false).await.unwrap();
    let client_ip = ClientIpResolver::new(&[]).unwrap();
    let auth = Arc::new(
        Service::new(
            AuthConfigSettings::new(
                AuthSettings {
                    master_password: Some(MasterPassword::try_from("password".to_owned()).unwrap()),
                    ..Default::default()
                },
                client_ip.clone(),
            ),
            pool.clone(),
        )
        .await
        .unwrap(),
    );
    let recorder = Arc::new(super::wiring::RecordingTargets::default());
    manager.set_recorder(Arc::clone(&recorder));
    manager.set_runtime_targets(RuntimeTargets {
        auth: Some(Arc::clone(&auth)),
        client_ip: Some(client_ip),
        ..Default::default()
    });
    (pool, manager, auth, recorder)
}

async fn manager_with_syncer() -> (Manager, Arc<Syncer>, Arc<super::wiring::RecordingTargets>) {
    let (pool, manager, _, recorder) = manager_with_targets().await;
    let syncer = Arc::new(Syncer::new(pool, vec![]));
    manager.set_runtime_targets(RuntimeTargets {
        syncer: Some(Arc::clone(&syncer)),
        ..Default::default()
    });
    (manager, syncer, recorder)
}

#[tokio::test]
async fn resolves_environment_overrides_and_applies_live_targets_after_persistence() {
    let (_, manager, auth, recorder) = manager_with_targets().await;
    manager
        .update_sections(Patch {
            auth: Some(SectionPatch {
                enabled: true,
                fields: AuthConfig {
                    master_password: Some("database-password".to_owned()),
                    ..Default::default()
                },
            }),
            security: Some(SectionPatch {
                enabled: true,
                fields: SecurityConfig {
                    trusted_proxy_cidrs: vec!["10.0.0.0/24".to_owned()],
                },
            }),
            ..Default::default()
        })
        .await
        .unwrap();

    assert_eq!(recorder.events(), ["prepare", "prepare", "save", "commit", "callback"]);
    assert_eq!(
        auth.master_password_status(),
        crate::auth::MasterPasswordStatus::EnvVarOverride
    );
    assert_eq!(
        manager
            .resolve_runtime_config(Some("env-password"), false)
            .unwrap()
            .auth
            .fields
            .master_password
            .as_deref(),
        Some("env-password")
    );
    assert!(!manager.resolve_runtime_config(None, true).unwrap().auth.enabled);

    let mut headers = HeaderMap::new();
    headers.insert("X-Real-IP", HeaderValue::from_static("198.51.100.25"));
    assert_eq!(
        auth.client_ip_resolver()
            .client_ip("10.0.0.2".parse().unwrap(), &headers),
        "198.51.100.25".parse::<std::net::IpAddr>().unwrap()
    );
}

#[tokio::test]
async fn rejects_preparer_and_save_failures_without_swapping_the_cache_or_firing_changes() {
    let (pool, manager, auth, recorder) = manager_with_targets().await;
    let initial = manager.sections();
    manager
        .update_sections(Patch {
            webauthn: Some(SectionPatch {
                enabled: true,
                fields: WebAuthnConfig {
                    webauthn_rp_id: Some("tallyo.test".to_owned()),
                    webauthn_rp_origins: vec!["https://other.test".to_owned()],
                    ..Default::default()
                },
            }),
            ..Default::default()
        })
        .await
        .unwrap_err();
    assert_eq!(manager.sections(), initial);
    assert_eq!(recorder.events(), ["prepare"]);

    queries::upsert_configuration_section(
        &pool,
        queries::UpsertConfigurationSectionParams {
            section: "UNKNOWN",
            enabled: false,
            fields: "{}",
        },
    )
    .await
    .unwrap();
    manager
        .update_sections(Patch {
            general: Some(SectionPatch {
                enabled: true,
                fields: GeneralConfig {
                    hide_owners: true,
                    ..Default::default()
                },
            }),
            ..Default::default()
        })
        .await
        .unwrap_err();
    assert_eq!(manager.sections(), initial);
    assert_eq!(recorder.events(), ["prepare", "save"]);
    assert!(auth.setup_complete());
}

#[tokio::test]
async fn normalizes_mcp_hosts_before_persisting_and_updates_dcr_settings() {
    let (_, manager, auth, _) = manager_with_targets().await;
    manager
        .update_sections(Patch {
            mcp: Some(SectionPatch {
                enabled: true,
                fields: McpConfig {
                    dynamic_redirect_hosts: vec![" Claude.AI ".to_owned()],
                },
            }),
            ..Default::default()
        })
        .await
        .unwrap();

    assert_eq!(manager.sections().mcp.fields.dynamic_redirect_hosts, ["claude.ai"]);
    assert_eq!(auth.dcr_settings().dynamic_redirect_hosts, ["claude.ai"]);
}

#[tokio::test]
async fn applies_email_google_locale_and_setup_updates_to_auth() {
    let (_, manager, auth, _) = manager_with_targets().await;
    manager
        .update_sections(Patch {
            auth: Some(SectionPatch {
                enabled: true,
                fields: AuthConfig {
                    master_password: Some("database-password".to_owned()),
                    oauth_issuer_url: "https://tallyo.test".to_owned(),
                    frontend_redirect_uris: vec!["https://web.test/callback".to_owned()],
                    access_token_lifetime: "15m".to_owned(),
                    refresh_token_lifetime: "168h".to_owned(),
                    ..Default::default()
                },
            }),
            ..Default::default()
        })
        .await
        .unwrap();
    manager
        .update_sections(Patch {
            email: Some(SectionPatch {
                enabled: true,
                fields: EmailConfig {
                    smtp_host: Some("smtp.test".to_owned()),
                    smtp_port: "587".to_owned(),
                    smtp_from: Some("from@test".to_owned()),
                    smtp_username: Some("user".to_owned()),
                    smtp_password: Some("password".to_owned()),
                },
            }),
            google: Some(SectionPatch {
                enabled: true,
                fields: GoogleConfig {
                    google_client_id: Some("client".to_owned()),
                    google_client_secret: Some("secret".to_owned()),
                },
            }),
            locale: Some(SectionPatch {
                enabled: true,
                fields: LocaleConfig {
                    timezone: "Europe/London".to_owned(),
                },
            }),
            setup_complete: Some(SectionPatch {
                enabled: true,
                fields: SetupCompleteConfig {},
            }),
            ..Default::default()
        })
        .await
        .unwrap();

    assert!(auth.email_enabled());
    assert!(auth.google_enabled());
    assert_eq!(auth.timezone(), "Europe/London");
    assert!(auth.setup_complete());
}

#[tokio::test]
async fn prepares_commits_and_disables_llm_runtime_configuration() {
    let (manager, syncer, recorder) = manager_with_syncer().await;
    let fields = LlmConfig {
        provider: Some(Provider::Known(LlmProvider::Ollama)),
        ollama: OllamaConfig {
            url: Some("http://localhost:11434".to_owned()),
            model: "test".to_owned(),
        },
    };
    manager
        .update_sections(Patch {
            llm: Some(SectionPatch {
                enabled: true,
                fields: fields.clone(),
            }),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(recorder.events(), ["prepare", "save", "commit"]);
    assert!(syncer.reprocess_uncategorized().await.is_ok());

    assert!(
        manager
            .update_sections(Patch {
                llm: Some(SectionPatch {
                    enabled: true,
                    fields: LlmConfig {
                        ollama: OllamaConfig {
                            model: "test".to_owned(),
                            ..Default::default()
                        },
                        ..Default::default()
                    },
                }),
                ..Default::default()
            })
            .await
            .is_err()
    );
    assert_eq!(recorder.events(), ["prepare", "save", "commit"]);
    assert!(syncer.reprocess_uncategorized().await.is_ok());

    manager
        .update_sections(Patch {
            llm: Some(SectionPatch { enabled: false, fields }),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(
        recorder.events(),
        ["prepare", "save", "commit", "prepare", "save", "commit"]
    );
    assert!(syncer.reprocess_uncategorized().await.is_err());
}

fn passkey_only_patch() -> Patch {
    Patch {
        auth: Some(SectionPatch {
            enabled: true,
            fields: AuthConfig {
                oauth_issuer_url: "https://tallyo.test".to_owned(),
                frontend_redirect_uris: vec!["https://web.test/callback".to_owned()],
                access_token_lifetime: "15m".to_owned(),
                refresh_token_lifetime: "168h".to_owned(),
                ..Default::default()
            },
        }),
        setup_complete: Some(SectionPatch {
            enabled: true,
            fields: SetupCompleteConfig {},
        }),
        webauthn: Some(SectionPatch {
            enabled: true,
            fields: WebAuthnConfig::default(),
        }),
        ..Default::default()
    }
}

#[tokio::test]
async fn validates_auth_transitions_through_section_updates() {
    let pool = dbtest::open().await.unwrap();
    let manager = Manager::new(pool.clone());
    manager.load(false, false).await.unwrap();
    assert_eq!(
        manager
            .update_sections(Patch {
                setup_complete: Some(SectionPatch {
                    enabled: true,
                    fields: SetupCompleteConfig {},
                }),
                ..Default::default()
            })
            .await
            .unwrap_err()
            .to_string(),
        "setup completion requires at least one auth method: configure MASTER_PASSWORD or enable google_authn, email_code_authn, or passkey_authn"
    );
    assert!(!manager.sections().setup_complete.stored);

    assert_eq!(
        manager
            .update_sections(Patch {
                general: Some(SectionPatch {
                    enabled: true,
                    fields: GeneralConfig::default(),
                }),
                ..Default::default()
            })
            .await
            .unwrap_err()
            .to_string(),
        "at least one auth method required: enable google_authn, email_code_authn, passkey_authn, or configure MASTER_PASSWORD"
    );
    assert!(!manager.sections().general.stored);

    assert_eq!(
        manager
            .update_sections(Patch {
                auth: Some(SectionPatch {
                    enabled: false,
                    fields: AuthConfig {
                        oauth_issuer_url: "https://tallyo.test".to_owned(),
                        ..Default::default()
                    },
                }),
                ..Default::default()
            })
            .await
            .unwrap_err()
            .to_string(),
        "DISABLE_ALL_AUTH is only allowed with a localhost http oauth_issuer_url"
    );
    assert!(!manager.sections().auth.stored);
}

#[tokio::test]
async fn requires_an_admin_passkey_for_passkey_only_sign_in() {
    let pool = dbtest::open().await.unwrap();
    let manager = Manager::new(pool.clone());
    manager.load(false, false).await.unwrap();
    assert_eq!(
        manager
            .update_sections(passkey_only_patch())
            .await
            .unwrap_err()
            .to_string(),
        "passkey-only sign-in requires at least one admin passkey before disabling other sign-in methods"
    );
    assert!(!manager.sections().setup_complete.stored);

    let admin = store::insert_user(&pool, "admin@example.com", None, Role::Admin)
        .await
        .unwrap();
    queries::create_web_authn_credential(
        &pool,
        queries::CreateWebAuthnCredentialParams {
            id: "credential",
            user_id: admin.id,
            name: "Passkey",
            credential: "{}",
        },
    )
    .await
    .unwrap();

    manager.update_sections(passkey_only_patch()).await.unwrap();
    assert!(manager.sections().setup_complete.enabled);
    assert!(manager.sections().webauthn.enabled);
}

#[tokio::test]
async fn applies_general_tracking_flags_to_the_sync_loops() {
    let (pool, manager, _, recorder) = manager_with_targets().await;
    let adapter_calls = Arc::new(AtomicUsize::new(0));
    let syncer = Arc::new(Syncer::new(
        pool.clone(),
        vec![Box::new(CountingAdapter(Arc::clone(&adapter_calls)))],
    ));
    let portfolio = Arc::new(CountingPortfolio::default());
    let balances = Arc::new(BalanceSyncer::new(
        pool,
        Vec::new(),
        Some(Arc::clone(&portfolio) as Arc<dyn PortfolioSyncer>),
    ));
    manager.set_runtime_targets(RuntimeTargets {
        syncer: Some(Arc::clone(&syncer)),
        balances: Some(Arc::clone(&balances)),
        ..Default::default()
    });

    for (disabled, expected_calls) in [(true, 0), (false, 1)] {
        manager
            .update_sections(Patch {
                general: Some(SectionPatch {
                    enabled: true,
                    fields: GeneralConfig {
                        disable_transaction_tracking: disabled,
                        disable_wealth_tracking: disabled,
                        hide_owners: false,
                    },
                }),
                ..Default::default()
            })
            .await
            .unwrap();
        syncer.sync_due().await;
        balances.sync_due().await;
        assert_eq!(adapter_calls.load(Ordering::Relaxed), expected_calls);
        assert_eq!(portfolio.0.load(Ordering::Relaxed), expected_calls);
    }
    assert_eq!(
        recorder.events(),
        ["save", "commit", "callback", "save", "commit", "callback"]
    );
}
