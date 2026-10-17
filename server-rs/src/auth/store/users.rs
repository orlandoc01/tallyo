use anyhow::{Context, Result};

use crate::{database::queries, schema::Role};

use super::{Store, User};

impl Store {
    pub async fn user_role(&self, email: &str) -> Result<Option<Role>> {
        queries::users(
            &self.pool,
            queries::UsersParams {
                email: Some(email),
                ..Default::default()
            },
        )
        .await?
        .into_iter()
        .next()
        .map(|row| {
            row.role
                .to_ascii_uppercase()
                .parse()
                .context("parse persisted user role")
        })
        .transpose()
    }

    pub async fn is_email_allowed(&self, email: &str) -> Result<bool> {
        Ok(self.user_role(email).await?.is_some())
    }

    pub async fn users(&self, id: Option<i64>, email: Option<&str>) -> Result<Vec<User>> {
        queries::users(&self.pool, queries::UsersParams { id, email })
            .await?
            .into_iter()
            .map(User::try_from)
            .collect()
    }

    pub async fn user_id_by_email(&self, email: &str) -> Result<Option<i64>> {
        Ok(self
            .users(None, Some(email))
            .await?
            .into_iter()
            .next()
            .map(|user| user.id))
    }

    pub async fn user_email_by_id(&self, id: i64) -> Result<Option<String>> {
        Ok(self
            .users(Some(id), None)
            .await?
            .into_iter()
            .next()
            .map(|user| user.email))
    }
}

impl TryFrom<queries::UsersRow> for User {
    type Error = anyhow::Error;

    fn try_from(row: queries::UsersRow) -> Result<Self> {
        Ok(Self {
            created_at: row.created_at.into(),
            email: row.email,
            id: row.id,
            role: row
                .role
                .to_ascii_uppercase()
                .parse()
                .context("parse persisted user role")?,
        })
    }
}

impl TryFrom<queries::InsertUserRow> for User {
    type Error = anyhow::Error;

    fn try_from(row: queries::InsertUserRow) -> Result<Self> {
        Ok(Self {
            created_at: row.created_at.into(),
            email: row.email,
            id: row.id,
            role: row
                .role
                .to_ascii_uppercase()
                .parse()
                .context("parse persisted user role")?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::Store;
    use crate::database::{dbtest, queries};
    use crate::schema::Role;

    #[tokio::test]
    async fn rejects_corrupt_persisted_roles() {
        let pool = dbtest::open().await.unwrap();
        let store = Store::new(pool.clone());
        let user = queries::insert_user(
            &pool,
            queries::InsertUserParams {
                email: "person@example.com",
                role: "corrupt",
                invited_by: None,
            },
        )
        .await
        .unwrap();
        assert!(store.user_role("person@example.com").await.is_err());
        assert!(store.users(Some(user.id), None).await.is_err());
        queries::update_user_role(
            &pool,
            queries::UpdateUserRoleParams {
                role: "admin",
                id: user.id,
            },
        )
        .await
        .unwrap();
        let loaded = store.users(Some(user.id), None).await.unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, user.id);
        assert_eq!(loaded[0].email, user.email);
        assert_eq!(loaded[0].created_at, user.created_at.into());
        assert_eq!(loaded[0].role, Role::Admin);
    }
}
