use anyhow::{Context, Result};
use sqlx::{Executor, Sqlite};

use crate::{accounts::Owner, database::queries};

pub async fn owners(executor: impl Executor<'_, Database = Sqlite>) -> Result<Vec<Owner>> {
    queries::owners(executor, queries::OwnersParams::default())
        .await
        .map(|rows| rows.into_iter().map(Into::into).collect())
        .map_err(Into::into)
}

pub async fn owner_by_id(executor: impl Executor<'_, Database = Sqlite>, id: i64) -> Result<Option<Owner>> {
    queries::owners(executor, queries::OwnersParams { id: Some(id) })
        .await
        .map(|rows| rows.into_iter().next().map(Into::into))
        .map_err(Into::into)
}

pub async fn create_owner(executor: impl Executor<'_, Database = Sqlite>, name: &str) -> Result<Owner> {
    queries::create_owner(executor, queries::CreateOwnerParams { name })
        .await
        .map(Into::into)
        .context("insert owner")
}

pub async fn delete_owner(executor: impl Executor<'_, Database = Sqlite>, id: i64) -> Result<bool> {
    queries::delete_owner(executor, queries::DeleteOwnerParams { id })
        .await
        .map(|rows| rows > 0)
        .context("delete owner")
}
