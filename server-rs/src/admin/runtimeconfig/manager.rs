use std::sync::{PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};

use anyhow::Result;
use sqlx::SqlitePool;
use tokio::sync::{Mutex, MutexGuard};

use crate::{
    admin::store,
    utils::timezone::{FALLBACK_TIMEZONE, normalize_timezone},
};

use super::validation::validate_runtime_config;
use super::{Sections, wiring::RuntimeTargets};

#[cfg(test)]
use super::wiring::RecordingTargets;

#[derive(Clone, Copy, Default)]
pub(super) struct Environment {
    pub(super) master_password_configured: bool,
    pub(super) disable_all_auth: bool,
}

#[derive(Clone, Default)]
pub(super) struct Cache {
    pub(super) sections: Sections,
    pub(super) environment: Environment,
}

pub struct Manager {
    pool: SqlitePool,
    update_lock: Mutex<()>,
    cache: RwLock<Cache>,
    targets: RwLock<RuntimeTargets>,
    #[cfg(test)]
    recorder: RwLock<Option<std::sync::Arc<RecordingTargets>>>,
}

impl Manager {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            pool,
            update_lock: Mutex::new(()),
            cache: RwLock::new(Cache::default()),
            targets: RwLock::new(RuntimeTargets::default()),
            #[cfg(test)]
            recorder: RwLock::new(None),
        }
    }

    #[cfg(test)]
    pub(super) fn set_recorder(&self, recorder: std::sync::Arc<RecordingTargets>) {
        *self.recorder.write().unwrap_or_else(PoisonError::into_inner) = Some(recorder);
    }

    #[cfg(test)]
    pub(super) fn recorder(&self) -> RwLockReadGuard<'_, Option<std::sync::Arc<RecordingTargets>>> {
        self.recorder.read().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn set_runtime_targets(&self, targets: RuntimeTargets) {
        *self.targets_mut() = targets;
    }

    pub async fn load(&self, env_master_password_auth: bool, authless_config_allowed: bool) -> Result<()> {
        let sections = store::list_sections(&self.pool).await?;
        *self.cache_mut() = Cache {
            sections,
            environment: Environment {
                master_password_configured: env_master_password_auth,
                disable_all_auth: authless_config_allowed,
            },
        };
        Ok(())
    }

    pub fn sections(&self) -> Sections {
        self.cache().sections.clone()
    }

    pub fn resolve_runtime_config(&self, master_password: Option<&str>, disable_all_auth: bool) -> Result<Sections> {
        let sections = resolve_runtime_config(self.sections(), master_password, disable_all_auth);
        validate_runtime_config(&sections)?;
        Ok(sections)
    }

    pub fn timezone(&self) -> String {
        let locale = &self.sections().locale;
        if !locale.stored {
            return FALLBACK_TIMEZONE.to_owned();
        }
        normalize_timezone(&locale.fields.timezone)
    }

    pub(super) fn resolved(&self, prospective: &Sections) -> Sections {
        let cache = self.cache();
        resolve_runtime_config(
            prospective.clone(),
            cache.environment.master_password_configured.then_some("configured"),
            cache.environment.disable_all_auth,
        )
    }

    pub(super) fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub(super) async fn lock_updates(&self) -> MutexGuard<'_, ()> {
        self.update_lock.lock().await
    }

    pub(super) fn cache(&self) -> RwLockReadGuard<'_, Cache> {
        self.cache.read().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn cache_mut(&self) -> RwLockWriteGuard<'_, Cache> {
        self.cache.write().unwrap_or_else(PoisonError::into_inner)
    }

    pub(super) fn targets(&self) -> RwLockReadGuard<'_, RuntimeTargets> {
        self.targets.read().unwrap_or_else(PoisonError::into_inner)
    }

    fn targets_mut(&self) -> RwLockWriteGuard<'_, RuntimeTargets> {
        self.targets.write().unwrap_or_else(PoisonError::into_inner)
    }
}

fn resolve_runtime_config(mut sections: Sections, master_password: Option<&str>, disable_all_auth: bool) -> Sections {
    if !sections.auth.stored {
        sections.auth.fields = Default::default();
    }
    if let Some(master_password) = master_password {
        sections.auth.fields.master_password = Some(master_password.to_owned());
    }
    if disable_all_auth {
        sections.auth.stored = true;
        sections.auth.enabled = false;
    }
    sections
}

#[cfg(test)]
mod tests {
    use super::Manager;
    use crate::{
        admin::{AuthConfig, Section, Sections},
        database::{dbtest, queries},
    };

    #[tokio::test]
    async fn preserves_cached_sections_when_loading_fails() {
        let pool = dbtest::open().await.unwrap();
        let manager = Manager::new(pool.clone());
        manager.load(true, false).await.unwrap();
        manager.cache_mut().sections = Sections {
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
        queries::upsert_configuration_section(
            &pool,
            queries::UpsertConfigurationSectionParams {
                section: "LOCALE",
                enabled: true,
                fields: "{",
            },
        )
        .await
        .unwrap();

        assert!(manager.load(false, false).await.is_err());
        assert_eq!(
            manager.sections().auth.fields.master_password.as_deref(),
            Some("password")
        );
    }
}
