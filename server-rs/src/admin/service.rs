use std::sync::Arc;

#[cfg(test)]
use std::sync::{Mutex, PoisonError};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use crate::{
    admin::{runtimeconfig, store},
    apierror::ApiError,
    auth::{self, User},
    schema::Role,
};

pub enum Inviter {
    Disabled,
    Auth(Arc<auth::Service>),
    #[cfg(test)]
    Recording(Arc<RecordingInviter>),
}

#[cfg(test)]
#[derive(Default)]
pub struct RecordingInviter {
    invitations: Mutex<Vec<(String, Role, String)>>,
    links: Mutex<Vec<(String, Role)>>,
}

#[cfg(test)]
impl RecordingInviter {
    pub(crate) fn invitations(&self) -> Vec<(String, Role, String)> {
        self.invitations.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    pub(crate) fn links(&self) -> Vec<(String, Role)> {
        self.links.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }
}

impl Inviter {
    async fn send_invitation(&self, email: &str, role: Role, invited_by: &str) -> Result<()> {
        match self {
            Self::Disabled => Ok(()),
            Self::Auth(service) => service.send_invitation(email, role, invited_by).await,
            #[cfg(test)]
            Self::Recording(recorder) => {
                recorder
                    .invitations
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .push((email.to_owned(), role, invited_by.to_owned()));
                Ok(())
            }
        }
    }

    async fn create_invite_link(&self, email: &str, role: Role) -> Result<(String, DateTime<Utc>)> {
        match self {
            Self::Disabled => Err(ApiError::bad_input("invitations are not configured").into()),
            Self::Auth(service) => service.create_invite_link(email, role).await,
            #[cfg(test)]
            Self::Recording(recorder) => {
                recorder
                    .links
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .push((email.to_owned(), role));
                Ok(("https://tallyo.test/invite".to_owned(), "2026-09-06T12:00:00Z".parse()?))
            }
        }
    }
}

pub struct Service {
    pub inviter: Inviter,
    pub manager: Arc<runtimeconfig::Manager>,
    pool: SqlitePool,
}

impl Service {
    pub fn new(pool: SqlitePool, manager: Arc<runtimeconfig::Manager>) -> Self {
        Self {
            pool,
            inviter: Inviter::Disabled,
            manager,
        }
    }

    pub async fn add_user(&self, email: &str, invited_by: Option<&str>, role: Role) -> Result<User> {
        if store::user_exists(&self.pool, email).await? {
            return Err(ApiError::bad_input("user already exists").into());
        }

        let inviter_id = if let Some(invited_by) = invited_by {
            Some(
                store::user_id_by_email(&self.pool, invited_by)
                    .await
                    .context("lookup inviter")?,
            )
        } else {
            None
        };
        let user = store::insert_user(&self.pool, email, inviter_id, role).await?;
        if let Err(error) = self
            .inviter
            .send_invitation(email, role, invited_by.unwrap_or_default())
            .await
        {
            if let Err(delete_error) = store::remove_user(&self.pool, user.id).await {
                return Err(anyhow::anyhow!(
                    "send invitation: {error} (compensating delete also failed: {delete_error})"
                ));
            }
            return Err(anyhow::anyhow!("send invitation: {error}"));
        }
        Ok(user)
    }

    pub async fn create_invite_link(&self, user_id: i64) -> Result<(String, DateTime<Utc>)> {
        let user = store::user_by_id(&self.pool, user_id).await.context("lookup user")?;
        self.inviter.create_invite_link(&user.email, user.role).await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::{Inviter, RecordingInviter, Service};
    use crate::{
        admin::{runtimeconfig::Manager, store},
        auth::{AuthSettings, Config as AuthConfig, Service as AuthService},
        database::dbtest,
        middleware::client_ip::ClientIpResolver,
        schema::Role,
    };

    async fn service(pool: sqlx::SqlitePool) -> Service {
        Service::new(pool.clone(), Arc::new(Manager::new(pool)))
    }

    #[tokio::test]
    async fn adds_users_and_reports_disabled_invitations() {
        let pool = dbtest::open().await.unwrap();
        let service = service(pool.clone()).await;
        let admin = service.add_user("admin@example.com", None, Role::Admin).await.unwrap();
        let user = service
            .add_user("friend@example.com", Some(&admin.email), Role::CashflowTracker)
            .await
            .unwrap();

        assert_eq!(user.role, Role::CashflowTracker);
        assert_eq!(
            service
                .add_user("friend@example.com", Some(&admin.email), Role::Writer)
                .await
                .unwrap_err()
                .to_string(),
            "user already exists"
        );
        assert_eq!(
            service.create_invite_link(user.id).await.unwrap_err().to_string(),
            "invitations are not configured"
        );
        assert!(
            service
                .add_user("another@example.com", Some("missing@example.com"), Role::Writer)
                .await
                .is_err()
        );
        assert!(store::user_exists(&pool, &user.email).await.unwrap());
    }

    #[tokio::test]
    async fn compensates_when_an_auth_invitation_cannot_be_created() {
        let pool = dbtest::open().await.unwrap();
        let mut service = service(pool.clone()).await;
        let auth = Arc::new(
            AuthService::new(
                AuthConfig::new(
                    AuthSettings {
                        issuer_url: "https://tallyo.test".to_owned(),
                        oauth_enabled: true,
                        ..Default::default()
                    },
                    ClientIpResolver::new(&[]).unwrap(),
                ),
                pool.clone(),
            )
            .await
            .unwrap(),
        );
        service.inviter = Inviter::Auth(auth);

        assert_eq!(
            service
                .add_user("friend@example.com", None, Role::Writer)
                .await
                .unwrap_err()
                .to_string(),
            "send invitation: frontend redirect uri is required"
        );
        assert!(!store::user_exists(&pool, "friend@example.com").await.unwrap());
    }

    #[tokio::test]
    async fn reports_both_invitation_and_compensation_failures() {
        let pool = dbtest::open().await.unwrap();
        let mut service = service(pool.clone()).await;
        let auth = Arc::new(
            AuthService::new(
                AuthConfig::new(
                    AuthSettings {
                        issuer_url: "https://tallyo.test".to_owned(),
                        oauth_enabled: true,
                        ..Default::default()
                    },
                    ClientIpResolver::new(&[]).unwrap(),
                ),
                pool.clone(),
            )
            .await
            .unwrap(),
        );
        service.inviter = Inviter::Auth(auth);
        sqlx::query(
            "CREATE TRIGGER reject_user_delete BEFORE DELETE ON users WHEN OLD.email = 'friend@example.com' BEGIN SELECT RAISE(ABORT, 'db unavailable'); END",
        )
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(
            service
                .add_user("friend@example.com", None, Role::Writer)
                .await
                .unwrap_err()
                .to_string(),
            "send invitation: frontend redirect uri is required (compensating delete also failed: delete user: error returned from database: (code: 1811) db unavailable)"
        );
        assert!(store::user_exists(&pool, "friend@example.com").await.unwrap());
    }

    #[tokio::test]
    async fn records_invitation_and_invite_link_arguments() {
        let pool = dbtest::open().await.unwrap();
        let mut service = service(pool).await;
        let recorder = Arc::new(RecordingInviter::default());
        service.inviter = Inviter::Recording(Arc::clone(&recorder));
        let admin = service.add_user("admin@example.com", None, Role::Admin).await.unwrap();
        let user = service
            .add_user("friend@example.com", Some(&admin.email), Role::CashflowTracker)
            .await
            .unwrap();

        assert_eq!(
            recorder.invitations(),
            [
                ("admin@example.com".to_owned(), Role::Admin, String::new()),
                (
                    "friend@example.com".to_owned(),
                    Role::CashflowTracker,
                    "admin@example.com".to_owned()
                ),
            ]
        );
        assert_eq!(
            service.create_invite_link(user.id).await.unwrap().0,
            "https://tallyo.test/invite"
        );
        assert_eq!(
            recorder.links(),
            [("friend@example.com".to_owned(), Role::CashflowTracker)]
        );
    }
}
