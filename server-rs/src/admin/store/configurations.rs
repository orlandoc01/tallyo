use anyhow::Result;
use serde::de::DeserializeOwned;
use sqlx::{Executor, Sqlite, SqlitePool};

use crate::{
    admin::runtimeconfig::{
        LlmConfig, LocaleConfig, McpConfig, Patch, Section, SectionId, SectionPatch, Sections, SecurityConfig,
        WebAuthnConfig,
    },
    database::{self, queries},
};

pub async fn admin_passkey_exists(executor: impl Executor<'_, Database = Sqlite>) -> Result<bool> {
    queries::admin_passkey_exists(executor)
        .await
        .map(|row| row.exists)
        .map_err(Into::into)
}

pub async fn list_sections(executor: impl Executor<'_, Database = Sqlite>) -> Result<Sections> {
    load_sections(executor, true).await
}

pub async fn save_sections(pool: &SqlitePool, patch: &Patch) -> Result<Sections> {
    let patch = patch.clone();
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            for section in patch.section_ids() {
                save_section(&mut **transaction, &patch, section).await?;
            }
            load_sections(&mut **transaction, false).await
        })
    })
    .await
}

async fn load_sections(executor: impl Executor<'_, Database = Sqlite>, validate: bool) -> Result<Sections> {
    queries::list_configuration_sections(executor)
        .await?
        .into_iter()
        .try_fold(Sections::default(), |mut sections, row| {
            decode_section_row(&mut sections, row, validate)?;
            Ok(sections)
        })
}

fn decode_section_row(
    sections: &mut Sections,
    row: queries::ListConfigurationSectionsRow,
    validate: bool,
) -> Result<()> {
    let Ok(id) = row.section.parse::<SectionId>() else {
        return Err(anyhow::anyhow!("invalid configuration section {:?}", row.section));
    };
    let should_validate = validate && (row.enabled || row.fields.trim() != "{}");
    let result = match id {
        SectionId::Auth => decode(&mut sections.auth, row, false, |_, _| Ok(())),
        SectionId::Email => decode(&mut sections.email, row, false, |_, _| Ok(())),
        SectionId::General => decode(&mut sections.general, row, false, |_, _| Ok(())),
        SectionId::Google => decode(&mut sections.google, row, false, |_, _| Ok(())),
        SectionId::Llm => decode(&mut sections.llm, row, false, |_: &LlmConfig, _| Ok(())),
        SectionId::Locale => decode(
            &mut sections.locale,
            row,
            should_validate,
            |fields: &LocaleConfig, enabled| fields.validate(enabled),
        ),
        SectionId::Mcp => decode(&mut sections.mcp, row, should_validate, |fields: &McpConfig, _| {
            fields.normalize().map(|_| ())
        }),
        SectionId::Security => decode(
            &mut sections.security,
            row,
            should_validate,
            |fields: &SecurityConfig, enabled| fields.validate(enabled),
        ),
        SectionId::SetupComplete => decode(&mut sections.setup_complete, row, false, |_, _| Ok(())),
        SectionId::WebAuthn => decode(
            &mut sections.webauthn,
            row,
            should_validate,
            |fields: &WebAuthnConfig, enabled| fields.validate(enabled),
        ),
    };
    result.map_err(|error| anyhow::anyhow!("load configuration section {}: {error}", <&str>::from(id)))
}

fn decode<T: Default + DeserializeOwned>(
    destination: &mut Section<T>,
    row: queries::ListConfigurationSectionsRow,
    validate: bool,
    validator: impl FnOnce(&T, bool) -> Result<()>,
) -> Result<()> {
    let fields = (!row.fields.is_empty())
        .then(|| serde_json::from_str(&row.fields))
        .transpose()
        .map_err(anyhow::Error::from)?
        .unwrap_or_default();
    if validate {
        validator(&fields, row.enabled)?;
    }
    *destination = Section {
        stored: true,
        enabled: row.enabled,
        fields,
    };
    Ok(())
}

async fn save_section(executor: impl Executor<'_, Database = Sqlite>, patch: &Patch, id: SectionId) -> Result<()> {
    match id {
        SectionId::Auth => save(executor, id, patch.auth.as_ref()).await,
        SectionId::Email => save(executor, id, patch.email.as_ref()).await,
        SectionId::General => save(executor, id, patch.general.as_ref()).await,
        SectionId::Google => save(executor, id, patch.google.as_ref()).await,
        SectionId::Llm => save(executor, id, patch.llm.as_ref()).await,
        SectionId::Locale => save(executor, id, patch.locale.as_ref()).await,
        SectionId::Mcp => save(executor, id, patch.mcp.as_ref()).await,
        SectionId::Security => save(executor, id, patch.security.as_ref()).await,
        SectionId::SetupComplete => save(executor, id, patch.setup_complete.as_ref()).await,
        SectionId::WebAuthn => save(executor, id, patch.webauthn.as_ref()).await,
    }
}

async fn save<T: serde::Serialize>(
    executor: impl Executor<'_, Database = Sqlite>,
    id: SectionId,
    patch: Option<&SectionPatch<T>>,
) -> Result<()> {
    let Some(patch) = patch else {
        return Ok(());
    };
    let fields = serde_json::to_string(&patch.fields)?;
    queries::upsert_configuration_section(
        executor,
        queries::UpsertConfigurationSectionParams {
            section: id.into(),
            enabled: patch.enabled,
            fields: &fields,
        },
    )
    .await
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::{list_sections, save_sections};
    use crate::{
        admin::{AuthConfig, GeneralConfig, LlmConfig, LocaleConfig, Patch, SectionPatch},
        database::{dbtest, queries},
    };

    #[tokio::test]
    async fn saves_sections_and_reloads_their_stored_values() {
        let pool = dbtest::open().await.unwrap();
        let sections = save_sections(
            &pool,
            &Patch {
                auth: Some(SectionPatch {
                    enabled: true,
                    fields: AuthConfig {
                        master_password: Some("password".to_owned()),
                        ..Default::default()
                    },
                }),
                general: Some(SectionPatch {
                    enabled: true,
                    fields: GeneralConfig {
                        disable_transaction_tracking: true,
                        ..Default::default()
                    },
                }),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert!(sections.auth.stored && sections.auth.enabled);
        assert!(sections.general.fields.disable_transaction_tracking);
        assert_eq!(list_sections(&pool).await.unwrap(), sections);
    }

    #[tokio::test]
    async fn validates_loaded_rows_but_not_direct_saves() {
        let pool = dbtest::open().await.unwrap();
        queries::upsert_configuration_section(
            &pool,
            queries::UpsertConfigurationSectionParams {
                section: "MCP",
                enabled: true,
                fields: r#"{"dynamic_redirect_hosts":[" CLAUDE.AI "]}"#,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            list_sections(&pool).await.unwrap().mcp.fields.dynamic_redirect_hosts,
            [" CLAUDE.AI "]
        );

        let saved = save_sections(
            &pool,
            &Patch {
                locale: Some(SectionPatch {
                    enabled: false,
                    fields: LocaleConfig {
                        timezone: "Not/AZone".to_owned(),
                    },
                }),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(saved.locale.fields.timezone, "Not/AZone");
    }

    #[tokio::test]
    async fn reports_bad_raw_configuration_rows() {
        for (section, fields) in [("GOOGLE", "{"), ("UNKNOWN", "{}"), ("LOCALE", r#"{"timezone":""}"#)] {
            let pool = dbtest::open().await.unwrap();
            queries::upsert_configuration_section(
                &pool,
                queries::UpsertConfigurationSectionParams {
                    section,
                    enabled: true,
                    fields,
                },
            )
            .await
            .unwrap();
            let error = list_sections(&pool).await.unwrap_err().to_string();
            match section {
                "GOOGLE" => assert!(error.starts_with("load configuration section GOOGLE: EOF while parsing")),
                "UNKNOWN" => assert_eq!(error, "invalid configuration section \"UNKNOWN\""),
                "LOCALE" => assert_eq!(error, "load configuration section LOCALE: timezone is required"),
                _ => unreachable!(),
            }
        }
    }

    #[tokio::test]
    async fn accepts_unknown_llm_providers_until_runtime_preparation() {
        let pool = dbtest::open().await.unwrap();
        queries::upsert_configuration_section(
            &pool,
            queries::UpsertConfigurationSectionParams {
                section: "LLM",
                enabled: true,
                fields: r#"{"provider":"future-provider"}"#,
            },
        )
        .await
        .unwrap();

        assert_eq!(
            list_sections(&pool).await.unwrap().llm.fields,
            LlmConfig {
                provider: Some(crate::admin::Provider::Unknown("future-provider".to_owned())),
                ..Default::default()
            }
        );
    }

    #[tokio::test]
    async fn rolls_back_when_post_save_reload_fails() {
        let pool = dbtest::open().await.unwrap();
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

        assert!(
            save_sections(
                &pool,
                &Patch {
                    general: Some(SectionPatch {
                        enabled: true,
                        fields: GeneralConfig {
                            hide_owners: true,
                            ..Default::default()
                        },
                    }),
                    ..Default::default()
                },
            )
            .await
            .is_err()
        );
        sqlx::query("DELETE FROM configurations WHERE section = 'UNKNOWN'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(!list_sections(&pool).await.unwrap().general.stored);
    }

    #[tokio::test]
    async fn loads_disabled_empty_sections_as_stored() {
        let pool = dbtest::open().await.unwrap();
        for section in [
            "AUTHORIZATION",
            "EMAIL",
            "GENERAL",
            "GOOGLE",
            "LLM",
            "LOCALE",
            "MCP",
            "SECURITY",
            "SETUP_COMPLETE",
            "WEBAUTHN",
        ] {
            queries::upsert_configuration_section(
                &pool,
                queries::UpsertConfigurationSectionParams {
                    section,
                    enabled: false,
                    fields: "{}",
                },
            )
            .await
            .unwrap();
        }

        let sections = list_sections(&pool).await.unwrap();
        assert!(sections.auth.stored);
        assert!(sections.email.stored);
        assert!(sections.general.stored);
        assert!(sections.google.stored);
        assert!(sections.llm.stored);
        assert!(sections.locale.stored);
        assert!(sections.mcp.stored);
        assert!(sections.security.stored);
        assert!(sections.setup_complete.stored);
        assert!(sections.webauthn.stored);
    }

    #[tokio::test]
    async fn reports_wrong_field_types_from_serde() {
        let pool = dbtest::open().await.unwrap();
        queries::upsert_configuration_section(
            &pool,
            queries::UpsertConfigurationSectionParams {
                section: "AUTHORIZATION",
                enabled: true,
                fields: r#"{"frontend_redirect_uris":"https://tallyo.test/callback"}"#,
            },
        )
        .await
        .unwrap();

        let error = list_sections(&pool).await.unwrap_err().to_string();
        assert!(error.starts_with("load configuration section AUTHORIZATION: invalid type: string"));
        assert!(error.contains("expected a sequence"));
    }
}
