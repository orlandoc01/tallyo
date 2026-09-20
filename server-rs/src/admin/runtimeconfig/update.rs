use anyhow::{Context, Result, ensure};

use crate::{admin::store, apierror::ApiError};

use super::validation::{validate_disable_all_auth_issuer, validate_runtime_config};
use super::{Manager, Patch, Section, Sections};

const SETUP_AUTH_REQUIRED: &str = "setup completion requires at least one auth method: configure MASTER_PASSWORD or enable google_authn, email_code_authn, or passkey_authn";
const RUNTIME_AUTH_REQUIRED: &str = "at least one auth method required: enable google_authn, email_code_authn, passkey_authn, or configure MASTER_PASSWORD";
const PASSKEY_REQUIRED: &str =
    "passkey-only sign-in requires at least one admin passkey before disabling other sign-in methods";

impl Manager {
    pub async fn update_sections(&self, mut patch: Patch) -> Result<()> {
        let changed = patch.section_ids();
        if changed.is_empty() {
            return Ok(());
        }
        validate_patch(&mut patch)?;

        let update_lock = self.lock_updates().await;
        let prospective = apply_patch(self.sections(), &patch);
        self.validate_auth_prospective(&prospective).await?;
        let targets = self.targets().clone();
        let commits = self.prepare(&targets, &changed, &prospective).await?;
        self.record("save");
        let saved = store::save_sections(self.pool(), &patch)
            .await
            .context("upsert configuration sections")?;
        self.cache_mut().sections = saved;
        for commit in commits {
            commit().await;
        }
        self.record("commit");
        drop(update_lock);

        self.on_change(&targets, &changed);
        Ok(())
    }

    async fn validate_auth_prospective(&self, prospective: &Sections) -> Result<()> {
        let prospective = self.resolved(prospective);
        let auth = &prospective.auth.fields;
        if prospective.auth.stored && !prospective.auth.enabled {
            return validate_disable_all_auth_issuer(&auth.oauth_issuer_url);
        }

        let has_real_auth = prospective.oauth_enabled();
        let has_master_password = auth.has_master_password();
        if prospective.setup_complete.enabled && !has_master_password && !has_real_auth {
            return Err(ApiError::bad_input(SETUP_AUTH_REQUIRED).into());
        }
        if !self.cache().environment.disable_all_auth && !has_master_password && !has_real_auth {
            return Err(ApiError::bad_input(RUNTIME_AUTH_REQUIRED).into());
        }
        validate_runtime_config(&prospective)?;

        let passkey_only = prospective.setup_complete.enabled
            && !has_master_password
            && !prospective.google.enabled
            && !prospective.email.enabled
            && prospective.webauthn.enabled;
        if !passkey_only {
            return Ok(());
        }
        ensure!(
            store::admin_passkey_exists(self.pool())
                .await
                .context("check admin passkey")?,
            ApiError::bad_input(PASSKEY_REQUIRED)
        );
        Ok(())
    }
}

fn validate_patch(patch: &mut Patch) -> Result<()> {
    if let Some(locale) = patch.locale.as_ref() {
        locale.fields.validate(locale.enabled)?;
    }
    if let Some(llm) = patch.llm.as_ref() {
        llm.fields.validate(llm.enabled)?;
    }
    if let Some(webauthn) = patch.webauthn.as_ref() {
        webauthn.fields.validate(webauthn.enabled)?;
    }
    if let Some(mcp) = patch.mcp.as_mut() {
        mcp.fields = mcp.fields.normalize()?;
    }
    if let Some(security) = patch.security.as_ref() {
        security.fields.validate(security.enabled)?;
    }
    Ok(())
}

fn apply_patch(mut sections: Sections, patch: &Patch) -> Sections {
    sections.auth = apply_section_patch(sections.auth, patch.auth.as_ref());
    sections.email = apply_section_patch(sections.email, patch.email.as_ref());
    sections.general = apply_section_patch(sections.general, patch.general.as_ref());
    sections.google = apply_section_patch(sections.google, patch.google.as_ref());
    sections.llm = apply_section_patch(sections.llm, patch.llm.as_ref());
    sections.locale = apply_section_patch(sections.locale, patch.locale.as_ref());
    sections.mcp = apply_section_patch(sections.mcp, patch.mcp.as_ref());
    sections.security = apply_section_patch(sections.security, patch.security.as_ref());
    sections.setup_complete = apply_section_patch(sections.setup_complete, patch.setup_complete.as_ref());
    sections.webauthn = apply_section_patch(sections.webauthn, patch.webauthn.as_ref());
    sections
}

fn apply_section_patch<T: Clone>(section: Section<T>, patch: Option<&super::SectionPatch<T>>) -> Section<T> {
    patch.map_or(section, |patch| Section {
        stored: true,
        enabled: patch.enabled,
        fields: patch.fields.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::apply_patch;
    use crate::admin::{AuthConfig, Patch, SectionPatch, Sections};

    #[test]
    fn applies_only_patched_sections() {
        let patched = apply_patch(
            Sections::default(),
            &Patch {
                auth: Some(SectionPatch {
                    enabled: true,
                    fields: AuthConfig::default(),
                }),
                ..Default::default()
            },
        );
        assert!(patched.auth.stored && patched.auth.enabled);
        assert!(!patched.general.stored);
    }
}
