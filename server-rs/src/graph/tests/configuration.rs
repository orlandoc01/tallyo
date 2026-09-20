use anyhow::Result;
use serde_json::{Value, json};

use super::{all_scopes, seed};
use crate::{
    admin::{
        AuthConfig, EmailConfig, GoogleConfig, McpConfig, Patch, SectionPatch, SecurityConfig, store as admin_store,
    },
    auth::Scope,
    graph::configuration::OBFUSCATED_SECRET,
    schema::{
        AuthorizationConfigurationInput, EmailCodeAuthnConfigurationInput, GeneralConfigurationInput,
        GoogleAuthnConfigurationInput, LlmCategorizationConfigurationInput, LlmProvider, McpConfigurationInput,
        OllamaProviderConfigurationInput, SecurityConfigurationInput, UpdateConfigurationInput,
    },
};

fn update_input() -> UpdateConfigurationInput {
    UpdateConfigurationInput {
        locale: None,
        general: None,
        authorization: None,
        llm_categorization: None,
        google_authn: None,
        pass_key_authn: None,
        email_code_authn: None,
        mcp: None,
        security: None,
        setup_complete: None,
    }
}

fn stored<T>(enabled: bool, fields: T) -> Option<SectionPatch<T>> {
    Some(SectionPatch { enabled, fields })
}

#[tokio::test]
async fn configuration_obfuscates_secrets_and_reads_stored_sections() -> Result<()> {
    let fixture = seed().await?;
    admin_store::save_sections(
        &fixture.pool,
        &Patch {
            auth: stored(
                true,
                AuthConfig {
                    master_password: Some("master-secret".to_owned()),
                    ..AuthConfig::default()
                },
            ),
            google: stored(
                true,
                GoogleConfig {
                    google_client_id: None,
                    google_client_secret: Some("google-secret".to_owned()),
                },
            ),
            email: stored(
                true,
                EmailConfig {
                    smtp_password: Some("smtp-secret".to_owned()),
                    ..EmailConfig::default()
                },
            ),
            mcp: stored(
                true,
                McpConfig {
                    dynamic_redirect_hosts: vec!["claude.ai".to_owned()],
                },
            ),
            security: stored(
                true,
                SecurityConfig {
                    trusted_proxy_cidrs: vec!["10.0.0.0/24".to_owned()],
                },
            ),
            ..Patch::default()
        },
    )
    .await?;
    let resolver = fixture.resolver();
    resolver.admin.manager.load(true, false).await?;
    let schema = crate::graph::build_schema(resolver);
    let response = schema
        .execute(super::request(
            "{ configuration { dbPath port syncOff configFilePath locale { timezone } authorization { masterPassword disableAllAuth } googleAuthn { googleClientId googleClientSecret } emailCodeAuthn { smtpPassword smtpHost } mcp { enabled dynamicRedirectHosts } security { trustedProxyCidrs } llmCategorization { enabled provider allowedProviders ollama { url model } } passKeyAuthn { enabled webauthnRpOrigins } general { hideOwners } } generalConfiguration { disableWealthTracking } instanceTimezone }",
            all_scopes(),
        ))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json()?;
    let configuration = &data["configuration"];
    assert_eq!(configuration["dbPath"], "/tmp/tallyo.db");
    assert_eq!(configuration["port"], "8080");
    assert_eq!(configuration["syncOff"], false);
    assert_eq!(configuration["configFilePath"], Value::Null);
    assert_eq!(configuration["locale"]["timezone"], "America/New_York");
    assert_eq!(configuration["authorization"]["masterPassword"], OBFUSCATED_SECRET);
    assert_eq!(configuration["authorization"]["disableAllAuth"], false);
    assert_eq!(configuration["googleAuthn"]["googleClientSecret"], OBFUSCATED_SECRET);
    assert_eq!(configuration["googleAuthn"]["googleClientId"], Value::Null);
    assert_eq!(configuration["emailCodeAuthn"]["smtpPassword"], OBFUSCATED_SECRET);
    assert_eq!(configuration["emailCodeAuthn"]["smtpHost"], Value::Null);
    assert_eq!(
        configuration["mcp"],
        json!({"enabled": true, "dynamicRedirectHosts": ["claude.ai"]})
    );
    assert_eq!(configuration["security"]["trustedProxyCidrs"], json!(["10.0.0.0/24"]));
    assert_eq!(
        configuration["llmCategorization"],
        json!({"enabled": false, "provider": "OLLAMA", "allowedProviders": ["OLLAMA"], "ollama": {"url": Value::Null, "model": ""}})
    );
    assert_eq!(
        configuration["passKeyAuthn"],
        json!({"enabled": false, "webauthnRpOrigins": Value::Null})
    );
    assert_eq!(configuration["general"]["hideOwners"], false);
    assert_eq!(data["generalConfiguration"]["disableWealthTracking"], false);
    assert_eq!(data["instanceTimezone"], "America/New_York");

    let response = schema
        .execute(super::request("{ configuration { dbPath } }", vec![Scope::ReadOwners]))
        .await;
    assert_eq!(response.errors[0].message, "forbidden: read:settings access required");
    Ok(())
}

#[tokio::test]
async fn configuration_without_stored_auth_falls_back_to_the_static_config() -> Result<()> {
    let fixture = seed().await?;
    let mut resolver = fixture.resolver();
    resolver.config = std::sync::Arc::new(crate::config::Config {
        config_file_path: Some("/etc/tallyo/config.yaml".into()),
        db_path: "/data/tallyo.db".into(),
        db_encryption_key: None,
        port: 9090,
        sync_off: true,
        authorization: crate::config::Authorization {
            disable_all_auth: true,
            master_password: Some(crate::config::MasterPassword::try_from("env-secret".to_owned())?),
        },
    });
    let configuration = resolver.configuration();
    assert_eq!(
        configuration.config_file_path.as_deref(),
        Some("/etc/tallyo/config.yaml")
    );
    assert_eq!(configuration.port, "9090");
    assert!(configuration.sync_off);
    assert_eq!(
        configuration.authorization.master_password.as_deref(),
        Some(OBFUSCATED_SECRET)
    );
    assert!(configuration.authorization.disable_all_auth);
    assert_eq!(configuration.authorization.oauth_issuer_url, "");
    assert_eq!(configuration.security.trusted_proxy_cidrs, Vec::<String>::new());
    Ok(())
}

#[tokio::test]
async fn update_configuration_updates_dynamic_sections() -> Result<()> {
    let fixture = seed().await?;
    admin_store::save_sections(
        &fixture.pool,
        &Patch {
            google: stored(
                true,
                GoogleConfig {
                    google_client_id: Some("old".to_owned()),
                    google_client_secret: Some("secret".to_owned()),
                },
            ),
            ..Patch::default()
        },
    )
    .await?;
    let resolver = fixture.resolver();
    resolver.admin.manager.load(true, false).await?;

    let payload = resolver
        .update_configuration(UpdateConfigurationInput {
            general: Some(GeneralConfigurationInput {
                disable_transaction_tracking: true,
                disable_wealth_tracking: true,
                hide_owners: true,
            }),
            google_authn: Some(GoogleAuthnConfigurationInput {
                enabled: true,
                google_client_id: Some("new-client".to_owned()),
                google_client_secret: Some("new-secret".to_owned()),
            }),
            llm_categorization: Some(LlmCategorizationConfigurationInput {
                enabled: true,
                provider: LlmProvider::Ollama,
                ollama: OllamaProviderConfigurationInput {
                    url: Some("http://ollama:11434".to_owned()),
                    model: "llama3".to_owned(),
                },
            }),
            mcp: Some(McpConfigurationInput {
                enabled: true,
                dynamic_redirect_hosts: Some(vec!["claude.ai".to_owned()]),
            }),
            security: Some(SecurityConfigurationInput {
                trusted_proxy_cidrs: vec![" 10.0.0.0/24 ".to_owned(), "127.0.0.1".to_owned(), " ".to_owned()],
            }),
            ..update_input()
        })
        .await?;
    let configuration = payload.configuration;
    assert_eq!(
        configuration.google_authn.google_client_id.as_deref(),
        Some("new-client")
    );
    assert_eq!(
        configuration.google_authn.google_client_secret.as_deref(),
        Some(OBFUSCATED_SECRET)
    );
    assert!(
        configuration.general.disable_transaction_tracking
            && configuration.general.disable_wealth_tracking
            && configuration.general.hide_owners
    );
    assert!(configuration.llm_categorization.enabled);
    assert_eq!(configuration.llm_categorization.ollama.model, "llama3");
    assert!(configuration.mcp.enabled);
    assert_eq!(
        configuration.mcp.dynamic_redirect_hosts.as_deref(),
        Some(&["claude.ai".to_owned()][..])
    );
    assert_eq!(configuration.security.trusted_proxy_cidrs, ["10.0.0.0/24", "127.0.0.1"]);
    assert_eq!(
        admin_store::list_sections(&fixture.pool)
            .await?
            .google
            .fields
            .google_client_secret
            .as_deref(),
        Some("new-secret")
    );
    Ok(())
}

#[tokio::test]
async fn update_configuration_preserves_placeholders_and_omitted_hosts() -> Result<()> {
    let fixture = seed().await?;
    admin_store::save_sections(
        &fixture.pool,
        &Patch {
            auth: stored(
                true,
                AuthConfig {
                    master_password: Some("master-secret".to_owned()),
                    ..AuthConfig::default()
                },
            ),
            google: stored(
                true,
                GoogleConfig {
                    google_client_id: Some("id".to_owned()),
                    google_client_secret: Some("google-secret".to_owned()),
                },
            ),
            email: stored(
                true,
                EmailConfig {
                    smtp_password: Some("smtp-secret".to_owned()),
                    ..EmailConfig::default()
                },
            ),
            mcp: stored(
                true,
                McpConfig {
                    dynamic_redirect_hosts: vec!["claude.ai".to_owned()],
                },
            ),
            ..Patch::default()
        },
    )
    .await?;
    let resolver = fixture.resolver();
    resolver.admin.manager.load(true, false).await?;

    resolver
        .update_configuration(UpdateConfigurationInput {
            authorization: Some(AuthorizationConfigurationInput {
                master_password: Some(OBFUSCATED_SECRET.to_owned()),
                disable_all_auth: false,
                oauth_issuer_url: "https://issuer.example.com".to_owned(),
                frontend_redirect_uris: vec!["https://app.example.com/callback".to_owned()],
                access_token_lifetime: "15m".to_owned(),
                refresh_token_lifetime: "168h".to_owned(),
                dev_cors_allowed_origins: Some(vec!["http://localhost:5173".to_owned()]),
            }),
            google_authn: Some(GoogleAuthnConfigurationInput {
                enabled: true,
                google_client_id: Some("id".to_owned()),
                google_client_secret: Some(OBFUSCATED_SECRET.to_owned()),
            }),
            email_code_authn: Some(EmailCodeAuthnConfigurationInput {
                enabled: false,
                smtp_host: None,
                smtp_port: "587".to_owned(),
                smtp_from: None,
                smtp_username: None,
                smtp_password: Some(OBFUSCATED_SECRET.to_owned()),
            }),
            mcp: Some(McpConfigurationInput {
                enabled: true,
                dynamic_redirect_hosts: None,
            }),
            ..update_input()
        })
        .await?;
    let sections = admin_store::list_sections(&fixture.pool).await?;
    assert_eq!(sections.auth.fields.master_password.as_deref(), Some("master-secret"));
    assert_eq!(sections.auth.fields.oauth_issuer_url, "https://issuer.example.com");
    assert_eq!(sections.auth.fields.dev_cors_allowed_origins, ["http://localhost:5173"]);
    assert_eq!(
        sections.google.fields.google_client_secret.as_deref(),
        Some("google-secret")
    );
    assert_eq!(sections.email.fields.smtp_password.as_deref(), Some("smtp-secret"));
    assert_eq!(sections.mcp.fields.dynamic_redirect_hosts, ["claude.ai"]);

    let configuration = resolver.configuration();
    assert_eq!(
        configuration.authorization.oauth_issuer_url,
        "https://issuer.example.com"
    );
    assert_eq!(
        configuration.authorization.frontend_redirect_uris,
        ["https://app.example.com/callback"]
    );
    assert_eq!(
        configuration.authorization.dev_cors_allowed_origins.as_deref(),
        Some(&["http://localhost:5173".to_owned()][..])
    );
    assert_eq!(
        configuration.mcp.dynamic_redirect_hosts.as_deref(),
        Some(&["claude.ai".to_owned()][..])
    );
    Ok(())
}

#[tokio::test]
async fn update_configuration_marks_setup_complete_through_graphql() -> Result<()> {
    let fixture = seed().await?;
    let resolver = fixture.resolver();
    resolver.admin.manager.load(true, false).await?;
    let manager = resolver.admin.manager.clone();
    let schema = crate::graph::build_schema(resolver);
    let response = schema
        .execute(super::request(
            r#"mutation { updateConfiguration(input: {
                authorization: { disableAllAuth: false, oauthIssuerUrl: "https://spend.example", frontendRedirectUris: ["https://spend.example/auth/callback"], accessTokenLifetime: "15m", refreshTokenLifetime: "168h" },
                googleAuthn: { enabled: true, googleClientId: "id", googleClientSecret: "secret" },
                locale: { timezone: "Europe/Paris" },
                setupComplete: true
            }) { configuration { locale { timezone } googleAuthn { enabled googleClientSecret } authorization { accessTokenLifetime } } } }"#,
            all_scopes(),
        ))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json()?;
    assert_eq!(
        data["updateConfiguration"]["configuration"],
        json!({"locale": {"timezone": "Europe/Paris"}, "googleAuthn": {"enabled": true, "googleClientSecret": OBFUSCATED_SECRET}, "authorization": {"accessTokenLifetime": "15m"}})
    );
    let sections = manager.sections();
    assert!(sections.setup_complete.enabled && sections.setup_complete.stored);
    assert_eq!(manager.timezone(), "Europe/Paris");

    let response = schema
        .execute(super::request(
            r#"mutation { updateConfiguration(input: { locale: { timezone: "Mars/Olympus" } }) { configuration { locale { timezone } } } }"#,
            all_scopes(),
        ))
        .await;
    assert_eq!(super::code(&response.errors[0]), "BAD_USER_INPUT");
    Ok(())
}
