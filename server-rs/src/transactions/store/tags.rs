use std::collections::HashMap;

use anyhow::Result;
use sqlx::{Executor, Sqlite};

use crate::{apierror::ApiError, database::queries, transactions::Tag};

use super::mapping::{tag_from_fields, tag_from_row};

pub async fn tags(executor: impl Executor<'_, Database = Sqlite>) -> Result<Vec<Tag>> {
    queries::list_tags(executor, queries::ListTagsParams::default())
        .await
        .map(|rows| rows.into_iter().map(tag_from_row).collect())
        .map_err(Into::into)
}

pub async fn tag_by_id(executor: impl Executor<'_, Database = Sqlite>, id: i64) -> Result<Option<Tag>> {
    queries::list_tags(executor, queries::ListTagsParams { id: Some(id) })
        .await
        .map(|rows| rows.into_iter().next().map(tag_from_row))
        .map_err(Into::into)
}

pub async fn create_tag(executor: impl Executor<'_, Database = Sqlite>, name: &str, color: &str) -> Result<Tag> {
    validate_color(color)?;
    queries::create_tag(executor, queries::CreateTagParams { name, color })
        .await
        .map(|row| tag_from_fields(row.id, row.name, row.color, row.transaction_count))
        .map_err(Into::into)
}

pub async fn update_tag(
    executor: impl Executor<'_, Database = Sqlite>,
    id: i64,
    name: &str,
    color: &str,
) -> Result<Option<Tag>> {
    validate_color(color)?;
    queries::update_tag_opt(executor, queries::UpdateTagParams { name, color, id })
        .await
        .map(|row| row.map(|row| tag_from_fields(row.id, row.name, row.color, row.transaction_count)))
        .map_err(Into::into)
}

pub async fn delete_tag(executor: impl Executor<'_, Database = Sqlite>, id: i64) -> Result<bool> {
    queries::delete_tag(executor, queries::DeleteTagParams { id })
        .await
        .map(|rows| rows > 0)
        .map_err(Into::into)
}

pub async fn tags_by_transaction_ids(
    executor: impl Executor<'_, Database = Sqlite>,
    transaction_ids: &[i64],
) -> Result<HashMap<i64, Vec<Tag>>> {
    if transaction_ids.is_empty() {
        return Ok(HashMap::new());
    }
    queries::tags_by_transaction_ids(executor, queries::TagsByTransactionIDsParams { transaction_ids })
        .await
        .map(|rows| {
            rows.into_iter().fold(HashMap::<i64, Vec<Tag>>::new(), |mut tags, row| {
                tags.entry(row.transaction_id).or_default().push(tag_from_fields(
                    row.tags.id,
                    row.tags.name,
                    row.tags.color,
                    row.tags.transaction_count,
                ));
                tags
            })
        })
        .map_err(Into::into)
}

pub async fn tags_by_rule_ids(
    executor: impl Executor<'_, Database = Sqlite>,
    rule_ids: &[i64],
) -> Result<HashMap<i64, Vec<Tag>>> {
    if rule_ids.is_empty() {
        return Ok(HashMap::new());
    }
    queries::tags_by_rule_ids(executor, queries::TagsByRuleIDsParams { rule_ids })
        .await
        .map(|rows| {
            rows.into_iter().fold(HashMap::<i64, Vec<Tag>>::new(), |mut tags, row| {
                tags.entry(row.rule_id).or_default().push(tag_from_fields(
                    row.tags.id,
                    row.tags.name,
                    row.tags.color,
                    row.tags.transaction_count,
                ));
                tags
            })
        })
        .map_err(Into::into)
}

fn validate_color(color: &str) -> Result<()> {
    anyhow::ensure!(
        color.len() == 7 && color.starts_with('#') && color[1..].bytes().all(|byte| byte.is_ascii_hexdigit()),
        ApiError::bad_input("tag color must be a #RRGGBB hex value")
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::*;

    #[tokio::test]
    async fn manages_tags_and_validates_colors() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        let tag = create_tag(&pool, "Household", "#AABBCC").await?;
        assert_eq!(tag_by_id(&pool, tag.id).await?, Some(tag.clone()));
        assert!(tags(&pool).await?.iter().any(|item| item.id == tag.id));
        let updated = update_tag(&pool, tag.id, "Home", "#112233").await?.expect("tag exists");
        assert_eq!((updated.name.as_str(), updated.color.as_str()), ("Home", "#112233"));
        assert!(delete_tag(&pool, tag.id).await?);
        assert!(!delete_tag(&pool, tag.id).await?);
        assert_eq!(update_tag(&pool, tag.id, "Missing", "#112233").await?, None);
        assert_eq!(tags_by_transaction_ids(&pool, &[]).await?, HashMap::new());
        assert_eq!(tags_by_rule_ids(&pool, &[]).await?, HashMap::new());
        for color in ["#123", "112233", "#GGGGGG"] {
            assert_eq!(
                create_tag(&pool, "Invalid", color).await.unwrap_err().to_string(),
                "tag color must be a #RRGGBB hex value"
            );
        }
        Ok(())
    }
}
