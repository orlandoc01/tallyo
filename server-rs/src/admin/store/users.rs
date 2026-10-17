use anyhow::{Context, Result};
use sqlx::{Executor, Sqlite, SqliteConnection, SqlitePool};

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
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let email = lookup_email(&mut **transaction, id).await?;
            queries::update_user_role(&mut **transaction, queries::UpdateUserRoleParams { role: &role, id })
                .await
                .context("update user role")?;
            revoke_subject_tokens(transaction, &email).await
        })
    })
    .await?;
    user_by_id(pool, id)
        .await
        .map_err(|error| anyhow::anyhow!("find updated user: {error}"))
}

async fn lookup_email(executor: impl Executor<'_, Database = Sqlite>, id: i64) -> Result<String> {
    let rows = queries::users(
        executor,
        queries::UsersParams {
            id: Some(id),
            ..Default::default()
        },
    )
    .await?;
    Ok(rows.into_iter().next().context("lookup user: user not found")?.email)
}

/// Revokes every access and refresh token issued to `email`; takes a connection so it can run inside a transaction.
async fn revoke_subject_tokens(connection: &mut SqliteConnection, email: &str) -> Result<()> {
    queries::delete_access_tokens_by_subject(
        &mut *connection,
        queries::DeleteAccessTokensBySubjectParams { subject: email },
    )
    .await
    .map_err(|error| anyhow::anyhow!("revoke access tokens: {error}"))?;
    queries::delete_refresh_tokens_by_subject(
        &mut *connection,
        queries::DeleteRefreshTokensBySubjectParams { subject: email },
    )
    .await
    .map_err(|error| anyhow::anyhow!("revoke refresh tokens: {error}"))?;
    Ok(())
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
            let email = lookup_email(&mut **transaction, id).await?;
            queries::delete_user(&mut **transaction, queries::DeleteUserParams { id })
                .await
                .map_err(|error| anyhow::anyhow!("delete user: {error}"))?;
            revoke_subject_tokens(transaction, &email).await
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

        seed_tokens(&pool, &user.email).await;
        remove_user(&pool, user.id).await.unwrap();
        assert!(!user_exists(&pool, &user.email).await.unwrap());
        assert_eq!(live_token_count(&pool).await, (0, 0));
        assert!(remove_user(&pool, user.id).await.is_err());
    }

    async fn seed_tokens(pool: &sqlx::SqlitePool, subject: &str) {
        let expires_at = Timestamp("2099-09-06T12:00:00Z".parse().unwrap());
        queries::create_access_token(
            pool,
            queries::CreateAccessTokenParams {
                signature: "access",
                client_id: "client",
                subject,
                scopes: None,
                expires_at,
                request_id: None,
            },
        )
        .await
        .unwrap();
        queries::create_refresh_token(
            pool,
            queries::CreateRefreshTokenParams {
                signature: "refresh",
                client_id: "client",
                subject,
                scopes: None,
                expires_at,
                request_id: None,
                first_issued_at: None,
            },
        )
        .await
        .unwrap();
    }

    async fn live_token_count(pool: &sqlx::SqlitePool) -> (i64, i64) {
        let count = |table: &str| {
            let sql = format!("SELECT COUNT(*) FROM {table}");
            async move { sqlx::query_scalar::<_, i64>(&sql).fetch_one(pool).await.unwrap() }
        };
        (count("oauth_access_tokens").await, count("oauth_refresh_tokens").await)
    }

    #[tokio::test]
    async fn updates_user_roles_revokes_their_tokens_and_reports_unknown_users() {
        let pool = dbtest::open().await.unwrap();
        let user = insert_user(&pool, "user@example.com", None, Role::Writer)
            .await
            .unwrap();
        seed_tokens(&pool, &user.email).await;

        assert_eq!(
            update_user_role(&pool, user.id, Role::Admin).await.unwrap().role,
            Role::Admin
        );
        assert_eq!(live_token_count(&pool).await, (0, 0));
        assert_eq!(
            update_user_role(&pool, 999, Role::Writer)
                .await
                .unwrap_err()
                .to_string(),
            "lookup user: user not found"
        );
    }
}
