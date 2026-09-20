use anyhow::{Context, Result};
use sqlx::{Executor, Sqlite, SqlitePool};

use crate::{
    auth::User,
    database::{self, queries},
    schema::Role,
};

pub async fn users(executor: impl Executor<'_, Database = Sqlite>) -> Result<Vec<User>> {
    queries::users(executor, queries::UsersParams::default())
        .await?
        .into_iter()
        .map(User::try_from)
        .collect()
}

pub async fn user_by_id(executor: impl Executor<'_, Database = Sqlite>, id: i64) -> Result<User> {
    find_user(executor, id).await?.context("user not found")
}

pub async fn find_user(executor: impl Executor<'_, Database = Sqlite>, id: i64) -> Result<Option<User>> {
    queries::users(
        executor,
        queries::UsersParams {
            id: Some(id),
            ..Default::default()
        },
    )
    .await?
    .into_iter()
    .next()
    .map(User::try_from)
    .transpose()
}

pub async fn update_user_role(pool: &SqlitePool, id: i64, role: Role) -> Result<User> {
    let role = role.to_string().to_ascii_lowercase();
    queries::update_user_role(pool, queries::UpdateUserRoleParams { role: &role, id })
        .await
        .context("update user role")?;
    user_by_id(pool, id)
        .await
        .map_err(|error| anyhow::anyhow!("find updated user: {error}"))
}

pub async fn insert_user(
    executor: impl Executor<'_, Database = Sqlite>,
    email: &str,
    invited_by: Option<i64>,
    role: Role,
) -> Result<User> {
    let role = role.to_string().to_ascii_lowercase();
    queries::insert_user(
        executor,
        queries::InsertUserParams {
            email,
            role: &role,
            invited_by,
        },
    )
    .await
    .map(User::try_from)
    .context("insert user")?
}

pub async fn user_id_by_email(executor: impl Executor<'_, Database = Sqlite>, email: &str) -> Result<i64> {
    queries::users(
        executor,
        queries::UsersParams {
            email: Some(email),
            ..Default::default()
        },
    )
    .await?
    .into_iter()
    .next()
    .map(|row| row.id)
    .context("user not found")
}

pub async fn user_exists(executor: impl Executor<'_, Database = Sqlite>, email: &str) -> Result<bool> {
    Ok(!queries::users(
        executor,
        queries::UsersParams {
            email: Some(email),
            ..Default::default()
        },
    )
    .await?
    .is_empty())
}

pub async fn remove_user(pool: &SqlitePool, id: i64) -> Result<()> {
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let rows = queries::users(
                &mut **transaction,
                queries::UsersParams {
                    id: Some(id),
                    ..Default::default()
                },
            )
            .await?;
            let email = rows.into_iter().next().context("lookup user: user not found")?.email;
            queries::delete_user(&mut **transaction, queries::DeleteUserParams { id })
                .await
                .map_err(|error| anyhow::anyhow!("delete user: {error}"))?;
            queries::delete_access_tokens_by_subject(
                &mut **transaction,
                queries::DeleteAccessTokensBySubjectParams { subject: &email },
            )
            .await
            .map_err(|error| anyhow::anyhow!("revoke access tokens: {error}"))?;
            queries::delete_refresh_tokens_by_subject(
                &mut **transaction,
                queries::DeleteRefreshTokensBySubjectParams { subject: &email },
            )
            .await
            .map_err(|error| anyhow::anyhow!("revoke refresh tokens: {error}"))?;
            Ok(())
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{insert_user, remove_user, update_user_role, user_by_id, user_exists, user_id_by_email, users};
    use crate::{
        database::{Timestamp, dbtest, queries},
        schema::Role,
    };

    #[tokio::test]
    async fn creates_lists_and_removes_users_with_their_tokens() {
        let pool = dbtest::open().await.unwrap();
        let admin = insert_user(&pool, "admin@example.com", None, Role::Admin)
            .await
            .unwrap();
        let user = insert_user(&pool, "user@example.com", Some(admin.id), Role::Writer)
            .await
            .unwrap();

        assert_eq!(users(&pool).await.unwrap().len(), 2);
        assert_eq!(user_id_by_email(&pool, &user.email).await.unwrap(), user.id);
        assert_eq!(user_by_id(&pool, user.id).await.unwrap(), user);
        assert!(user_exists(&pool, &user.email).await.unwrap());

        let expires_at = Timestamp("2099-09-06T12:00:00Z".parse().unwrap());
        queries::create_access_token(
            &pool,
            queries::CreateAccessTokenParams {
                signature: "access",
                client_id: "client",
                subject: &user.email,
                scopes: None,
                expires_at,
                request_id: None,
            },
        )
        .await
        .unwrap();
        queries::create_refresh_token(
            &pool,
            queries::CreateRefreshTokenParams {
                signature: "refresh",
                client_id: "client",
                subject: &user.email,
                scopes: None,
                expires_at,
                request_id: None,
            },
        )
        .await
        .unwrap();

        remove_user(&pool, user.id).await.unwrap();
        assert!(!user_exists(&pool, &user.email).await.unwrap());
        assert!(
            queries::access_token_opt(
                &pool,
                queries::AccessTokenParams {
                    signature: "access",
                    now: Timestamp("2026-09-06T12:00:00Z".parse().unwrap()),
                },
            )
            .await
            .unwrap()
            .is_none()
        );
        assert!(remove_user(&pool, user.id).await.is_err());
    }

    #[tokio::test]
    async fn updates_user_roles_and_reports_unknown_users() {
        let pool = dbtest::open().await.unwrap();
        let user = insert_user(&pool, "user@example.com", None, Role::Writer)
            .await
            .unwrap();

        assert_eq!(
            update_user_role(&pool, user.id, Role::Admin).await.unwrap().role,
            Role::Admin
        );
        assert_eq!(
            update_user_role(&pool, 999, Role::Writer)
                .await
                .unwrap_err()
                .to_string(),
            "find updated user: user not found"
        );
    }
}
