use anyhow::Result;

use super::{Resolver, ids::local_id};
use crate::{
    apierror::ApiError,
    ids::GlobalIdType,
    schema::{CreateTagInput, CreateTagPayload, DeleteTagPayload, TagList, UpdateTagInput, UpdateTagPayload},
    transactions::store,
};

impl Resolver {
    pub async fn tags(&self) -> Result<TagList> {
        Ok(TagList {
            items: store::tags(&self.pool).await?,
        })
    }

    pub async fn create_tag(&self, input: CreateTagInput) -> Result<CreateTagPayload> {
        let tag = store::create_tag(&self.pool, &input.name, &input.color).await?;
        Ok(CreateTagPayload { tag })
    }

    pub async fn update_tag(&self, input: UpdateTagInput) -> Result<UpdateTagPayload> {
        let tag_id = local_id(&input.id, GlobalIdType::Tag)?;
        let tag = store::update_tag(&self.pool, tag_id, &input.name, &input.color)
            .await?
            .ok_or_else(|| ApiError::bad_input(format!("tag {tag_id} not found")))?;
        Ok(UpdateTagPayload { tag })
    }

    pub async fn delete_tag(&self, id: &async_graphql::ID) -> Result<DeleteTagPayload> {
        let tag_id = local_id(id, GlobalIdType::Tag)?;
        Ok(DeleteTagPayload {
            success: store::delete_tag(&self.pool, tag_id).await?,
        })
    }
}
