use anyhow::Result;

use super::{
    Resolver,
    ids::{local_id, local_ids},
};
use crate::{
    ids::GlobalIdType,
    schema::{
        CreateCategoryGroupInput, CreateCategoryGroupPayload, CreateCategoryInput, CreateCategoryPayload,
        DeleteCategoryGroupPayload, DeleteCategoryPayload, ReorderCategoriesInput, ReorderCategoriesPayload,
        UpdateCategoryGroupInput, UpdateCategoryGroupPayload, UpdateCategoryInput, UpdateCategoryPayload,
    },
    transactions::store,
};

impl Resolver {
    pub async fn create_category_group(&self, input: CreateCategoryGroupInput) -> Result<CreateCategoryGroupPayload> {
        let group = store::create_category_group(&self.pool, &input.name, &input.emoji, input.kind).await?;
        Ok(CreateCategoryGroupPayload { group })
    }

    pub async fn update_category_group(&self, input: UpdateCategoryGroupInput) -> Result<UpdateCategoryGroupPayload> {
        let group_id = local_id(&input.id, GlobalIdType::CategoryGroup)?;
        let group = store::update_category_group(&self.pool, group_id, &input.name, &input.emoji).await?;
        Ok(UpdateCategoryGroupPayload { group })
    }

    pub async fn delete_category_group(&self, id: &async_graphql::ID) -> Result<DeleteCategoryGroupPayload> {
        let group_id = local_id(id, GlobalIdType::CategoryGroup)?;
        Ok(DeleteCategoryGroupPayload {
            success: store::delete_category_group(&self.pool, group_id).await?,
        })
    }

    pub async fn create_category(&self, input: CreateCategoryInput) -> Result<CreateCategoryPayload> {
        let group_id = local_id(&input.group_id, GlobalIdType::CategoryGroup)?;
        let category = store::create_category(&self.pool, &input.name, &input.emoji, group_id).await?;
        Ok(CreateCategoryPayload { category })
    }

    pub async fn update_category(&self, input: UpdateCategoryInput) -> Result<UpdateCategoryPayload> {
        let category_id = local_id(&input.id, GlobalIdType::Category)?;
        let group_id = local_id(&input.group_id, GlobalIdType::CategoryGroup)?;
        let category = store::update_category(
            &self.pool,
            category_id,
            &input.name,
            &input.emoji,
            group_id,
            input.plaid_pfc2_codes.as_deref(),
        )
        .await?;
        Ok(UpdateCategoryPayload { category })
    }

    pub async fn delete_category(&self, id: &async_graphql::ID) -> Result<DeleteCategoryPayload> {
        let category_id = local_id(id, GlobalIdType::Category)?;
        Ok(DeleteCategoryPayload {
            success: store::delete_category(&self.pool, category_id).await?,
        })
    }

    pub async fn reorder_categories(&self, input: ReorderCategoriesInput) -> Result<ReorderCategoriesPayload> {
        let group_id = local_id(&input.group_id, GlobalIdType::CategoryGroup)?;
        let category_ids = local_ids(Some(&input.category_ids), GlobalIdType::Category)?;
        let group = store::reorder_categories(&self.pool, group_id, &category_ids).await?;
        Ok(ReorderCategoriesPayload { group })
    }
}
