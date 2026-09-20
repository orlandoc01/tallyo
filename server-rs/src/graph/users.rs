use anyhow::{Result, ensure};

use super::{Resolver, ids::local_id};
use crate::{
    admin::store,
    apierror::ApiError,
    auth::Identity,
    ids::GlobalIdType,
    schema::{
        AddUserInput, AddUserPayload, CreateInviteLinkInput, CreateInviteLinkPayload, RemoveUserInput,
        RemoveUserPayload, Role, UpdateUserInput, UpdateUserPayload, UserList,
    },
};

impl Resolver {
    pub async fn users(&self) -> Result<UserList> {
        Ok(UserList {
            items: store::users(&self.pool).await?,
        })
    }

    pub async fn add_user(&self, identity: &Identity, input: AddUserInput) -> Result<AddUserPayload> {
        let email = input.email.trim().to_lowercase();
        ensure!(!email.is_empty(), ApiError::bad_input("email is required"));
        let invited_by = identity.subject.as_deref().filter(|subject| !subject.is_empty());
        let user = self
            .admin
            .add_user(&email, invited_by, input.role.unwrap_or(Role::Writer))
            .await?;
        Ok(AddUserPayload { user })
    }

    pub async fn create_invite_link(&self, input: CreateInviteLinkInput) -> Result<CreateInviteLinkPayload> {
        let user_id = local_id(&input.user_id, GlobalIdType::User)?;
        let (url, expires_at) = self.admin.create_invite_link(user_id).await?;
        Ok(CreateInviteLinkPayload { url, expires_at })
    }

    pub async fn remove_user(&self, input: RemoveUserInput) -> Result<RemoveUserPayload> {
        let user_id = local_id(&input.id, GlobalIdType::User)?;
        store::remove_user(&self.pool, user_id).await?;
        Ok(RemoveUserPayload { success: true })
    }

    pub async fn update_user(&self, input: UpdateUserInput) -> Result<UpdateUserPayload> {
        let user_id = local_id(&input.id, GlobalIdType::User)?;
        let user = store::update_user_role(&self.pool, user_id, input.role).await?;
        Ok(UpdateUserPayload { user })
    }
}
