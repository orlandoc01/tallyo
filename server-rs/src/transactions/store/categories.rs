use std::collections::HashMap;

use anyhow::{Result, anyhow};
use sqlx::{Executor, Sqlite, SqlitePool};

use crate::{
    apierror::ApiError,
    database::{self, queries},
    schema::CategoryKind,
    transactions::{Category, CategoryGroup},
};

use super::{category_pfc::replace_pfc2_mappings, mapping::category_kind};

pub const UNCATEGORIZED_CATEGORY_ID: i64 = 0;

pub async fn categories(executor: impl Executor<'_, Database = Sqlite>) -> Result<Vec<Category>> {
    queries::list_categories(executor, queries::ListCategoriesParams::default())
        .await
        .map(|rows| rows.into_iter().map(Into::into).collect())
        .map_err(Into::into)
}

pub async fn category_by_id(executor: impl Executor<'_, Database = Sqlite>, id: i64) -> Result<Option<Category>> {
    let ids = [id];
    queries::list_categories(
        executor,
        queries::ListCategoriesParams {
            category_ids: Some(&ids),
            ..Default::default()
        },
    )
    .await
    .map(|rows| rows.into_iter().next().map(Into::into))
    .map_err(Into::into)
}

pub async fn category_groups(executor: impl Executor<'_, Database = Sqlite>) -> Result<Vec<CategoryGroup>> {
    queries::list_categories(
        executor,
        queries::ListCategoriesParams {
            group_order: true,
            ..Default::default()
        },
    )
    .await
    .map(|rows| {
        rows.into_iter()
            .fold((Vec::new(), HashMap::new()), |(mut groups, mut indexes), row| {
                let group_id = row.group_id;
                let category: Category = row.into();
                let index = *indexes.entry(group_id).or_insert_with(|| {
                    groups.push(CategoryGroup {
                        id: group_id,
                        name: category.group_name.clone(),
                        emoji: category.group_emoji.clone(),
                        kind: category.kind,
                        categories: Vec::new(),
                    });
                    groups.len() - 1
                });
                groups[index].categories.push(category);
                (groups, indexes)
            })
            .0
    })
    .map_err(Into::into)
}

pub async fn category_group_by_id(
    executor: impl Executor<'_, Database = Sqlite>,
    id: i64,
) -> Result<Option<CategoryGroup>> {
    let Some(group) = queries::category_group_by_id_opt(executor, queries::CategoryGroupByIdParams { id }).await?
    else {
        return Ok(None);
    };
    Ok(Some(CategoryGroup {
        id: group.id,
        name: group.name,
        emoji: group.emoji,
        kind: category_kind(&group.kind),
        categories: Vec::new(),
    }))
}

pub async fn create_category_group(
    pool: &SqlitePool,
    name: &str,
    emoji: &str,
    kind: CategoryKind,
) -> Result<CategoryGroup> {
    let id = queries::create_category_group(
        pool,
        queries::CreateCategoryGroupParams {
            name,
            emoji,
            kind: &kind.to_string(),
            sort_order: 0,
        },
    )
    .await?
    .id;
    category_group(pool, id).await
}

pub async fn update_category_group(pool: &SqlitePool, id: i64, name: &str, emoji: &str) -> Result<CategoryGroup> {
    if queries::update_category_group(pool, queries::UpdateCategoryGroupParams { name, emoji, id }).await? == 0 {
        return Err(ApiError::bad_input(format!("category group {id} not found")).into());
    }
    category_group(pool, id).await
}

pub async fn delete_category_group(pool: &SqlitePool, id: i64) -> Result<bool> {
    if id == UNCATEGORIZED_CATEGORY_ID {
        return Err(ApiError::bad_input("cannot delete the uncategorized category group").into());
    }
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let count = queries::count_categories_by_group(
                &mut **transaction,
                queries::CountCategoriesByGroupParams { group_id: id },
            )
            .await?
            .count;
            if count > 0 {
                let suffix = if count == 1 { "y" } else { "ies" };
                return Err(ApiError::bad_input(format!(
                    "cannot delete group with {count} categor{suffix}; delete all categories first"
                ))
                .into());
            }
            queries::delete_category_group(&mut **transaction, queries::DeleteCategoryGroupParams { id })
                .await
                .map(|rows| rows > 0)
                .map_err(Into::into)
        })
    })
    .await
}

pub async fn create_category(pool: &SqlitePool, name: &str, emoji: &str, group_id: i64) -> Result<Category> {
    let name = name.to_owned();
    let emoji = emoji.to_owned();
    let id = database::with_tx(pool, |transaction| {
        Box::pin(async move {
            ensure_group(&mut **transaction, group_id).await?;
            queries::create_category(
                &mut **transaction,
                queries::CreateCategoryParams {
                    name: &name,
                    emoji: &emoji,
                    group_id,
                },
            )
            .await
            .map(|row| row.id)
            .map_err(Into::into)
        })
    })
    .await?;
    category(pool, id).await
}

pub async fn update_category(
    pool: &SqlitePool,
    id: i64,
    name: &str,
    emoji: &str,
    group_id: i64,
    plaid_pfc2_codes: Option<&[String]>,
) -> Result<Category> {
    let name = name.to_owned();
    let emoji = emoji.to_owned();
    let plaid_pfc2_codes = plaid_pfc2_codes.map(ToOwned::to_owned);
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            ensure_group(&mut **transaction, group_id).await?;
            if queries::update_category_fields(
                &mut **transaction,
                queries::UpdateCategoryFieldsParams {
                    name: &name,
                    emoji: &emoji,
                    group_id,
                    id,
                },
            )
            .await?
                == 0
            {
                return Err(ApiError::bad_input(format!("category {id} not found")).into());
            }
            if let Some(codes) = plaid_pfc2_codes.as_deref() {
                replace_pfc2_mappings(transaction, id, codes).await?;
            }
            Ok(())
        })
    })
    .await?;
    category(pool, id).await
}

pub async fn delete_category(pool: &SqlitePool, id: i64) -> Result<bool> {
    if id == UNCATEGORIZED_CATEGORY_ID {
        return Err(ApiError::bad_input("cannot delete the uncategorized category").into());
    }
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let Some(category) =
                queries::category_info_opt(&mut **transaction, queries::CategoryInfoParams { id }).await?
            else {
                return Err(ApiError::bad_input(format!("category {id} not found")).into());
            };
            if category.transaction_count > 0 {
                let suffix = if category.transaction_count == 1 { "" } else { "s" };
                return Err(ApiError::bad_input(format!(
                    "cannot delete category with {} transaction{suffix}; reassign them first",
                    category.transaction_count
                ))
                .into());
            }
            queries::delete_category(&mut **transaction, queries::DeleteCategoryParams { id })
                .await
                .map_err(Into::into)
        })
    })
    .await
    .map(|()| true)
}

pub async fn reorder_categories(pool: &SqlitePool, group_id: i64, category_ids: &[i64]) -> Result<CategoryGroup> {
    let category_ids = category_ids.to_vec();
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            ensure_group(&mut **transaction, group_id).await?;
            for (index, id) in category_ids.iter().enumerate() {
                queries::update_category_sort_order(
                    &mut **transaction,
                    queries::UpdateCategorySortOrderParams {
                        sort_order: (index + 1) as i64,
                        id: *id,
                        group_id,
                    },
                )
                .await?;
            }
            Ok(())
        })
    })
    .await?;
    category_group(pool, group_id).await
}

async fn category(pool: &SqlitePool, id: i64) -> Result<Category> {
    category_by_id(pool, id)
        .await?
        .ok_or_else(|| anyhow!("category {id} not found"))
}

async fn category_group(pool: &SqlitePool, id: i64) -> Result<CategoryGroup> {
    let mut group = category_group_by_id(pool, id)
        .await?
        .ok_or_else(|| anyhow!("category group {id} not found"))?;
    group.categories = queries::list_categories(
        pool,
        queries::ListCategoriesParams {
            group_id: Some(id),
            ..Default::default()
        },
    )
    .await?
    .into_iter()
    .map(Into::into)
    .collect();
    Ok(group)
}

async fn ensure_group(executor: impl Executor<'_, Database = Sqlite>, id: i64) -> Result<()> {
    anyhow::ensure!(
        queries::category_group_by_id_opt(executor, queries::CategoryGroupByIdParams { id })
            .await?
            .is_some(),
        ApiError::bad_input(format!("category group {id} not found"))
    );
    Ok(())
}

#[cfg(test)]
pub(super) async fn group_id_of(pool: &SqlitePool, category_id: i64) -> Result<i64> {
    category_groups(pool)
        .await?
        .into_iter()
        .find(|group| group.categories.iter().any(|category| category.id == category_id))
        .map(|group| group.id)
        .ok_or_else(|| anyhow!("category {category_id} has no group"))
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::*;
    use crate::{
        money::Cents,
        testutil::transactions::{account, transaction},
    };

    #[tokio::test]
    async fn manages_category_groups_categories_and_mappings() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        let group = create_category_group(&pool, "Home", "*", CategoryKind::Expense).await?;
        let first = create_category(&pool, "Test groceries", "*", group.id).await?;
        let second = create_category(&pool, "Test dining", "*", group.id).await?;
        assert_eq!(category_by_id(&pool, first.id).await?, Some(first.clone()));
        assert!(categories(&pool).await?.iter().any(|category| category.id == second.id));
        assert_eq!(
            category_groups(&pool)
                .await?
                .iter()
                .find(|item| item.id == group.id)
                .unwrap()
                .categories
                .len(),
            2
        );

        let seeded = categories(&pool)
            .await?
            .into_iter()
            .find(|category| !category.plaid_pfc2_codes.is_empty())
            .expect("seeded PFC2 mapping");
        let code = seeded.plaid_pfc2_codes[0].clone();
        update_category(
            &pool,
            seeded.id,
            &seeded.name,
            &seeded.emoji,
            group_id_of(&pool, seeded.id).await?,
            Some(&[]),
        )
        .await?;

        let updated_group = update_category_group(&pool, group.id, "Essentials", "#").await?;
        let updated = update_category(
            &pool,
            first.id,
            "Test food",
            "!",
            group.id,
            Some(&[format!(" {code} "), code.clone()]),
        )
        .await?;
        assert_eq!(updated_group.name, "Essentials");
        assert_eq!(updated.plaid_pfc2_codes, [code]);
        assert_eq!(
            reorder_categories(&pool, group.id, &[second.id, first.id])
                .await?
                .categories
                .into_iter()
                .map(|category| category.id)
                .collect::<Vec<_>>(),
            [second.id, first.id]
        );
        assert_eq!(
            delete_category_group(&pool, group.id).await.unwrap_err().to_string(),
            "cannot delete group with 2 categories; delete all categories first"
        );

        let account_id = account(&pool, "category-account").await?;
        let transaction_id = transaction(
            &pool,
            "category-transaction",
            account_id,
            first.id,
            Cents(100),
            "2026-01-01T12:00:00Z".parse()?,
        )
        .await?;
        assert_eq!(
            delete_category(&pool, first.id).await.unwrap_err().to_string(),
            "cannot delete category with 1 transaction; reassign them first"
        );
        super::super::delete_transaction(&pool, transaction_id).await?;
        assert!(delete_category(&pool, first.id).await?);
        assert!(delete_category(&pool, second.id).await?);
        assert!(delete_category_group(&pool, group.id).await?);
        assert!(!delete_category_group(&pool, group.id).await?);
        Ok(())
    }

    #[tokio::test]
    async fn rejects_missing_and_uncategorized_categories() -> Result<()> {
        let pool = crate::database::dbtest::open().await?;
        assert_eq!(
            create_category(&pool, "Missing", "*", 999)
                .await
                .unwrap_err()
                .to_string(),
            "category group 999 not found"
        );
        assert_eq!(
            update_category_group(&pool, 999, "Missing", "*")
                .await
                .unwrap_err()
                .to_string(),
            "category group 999 not found"
        );
        assert_eq!(
            delete_category(&pool, UNCATEGORIZED_CATEGORY_ID)
                .await
                .unwrap_err()
                .to_string(),
            "cannot delete the uncategorized category"
        );
        assert_eq!(
            delete_category_group(&pool, UNCATEGORIZED_CATEGORY_ID)
                .await
                .unwrap_err()
                .to_string(),
            "cannot delete the uncategorized category group"
        );
        Ok(())
    }
}
