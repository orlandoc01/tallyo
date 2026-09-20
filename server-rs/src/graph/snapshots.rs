use anyhow::Result;

use super::{
    Resolver,
    ids::{local_id, validate_id, validate_optional_id},
};
use crate::{
    ids::GlobalIdType,
    schema::{
        AccountSnapshot, AccountSnapshotConnection, AccountSnapshotInput, AccountSnapshotsInput, BalanceReviewAction,
        BalanceSnapshotReviewList, ChangeAccountSnapshotInput, ChangeAccountSnapshotPayload, ResolveBalanceReviewInput,
        ResolveBalanceReviewPayload,
    },
    wealth::store,
};

impl Resolver {
    pub async fn balance_snapshot_reviews(&self) -> Result<BalanceSnapshotReviewList> {
        Ok(BalanceSnapshotReviewList {
            items: store::in_review_balance_reviews(&self.pool).await?,
        })
    }

    pub async fn resolve_balance_review(
        &self,
        input: ResolveBalanceReviewInput,
    ) -> Result<ResolveBalanceReviewPayload> {
        let review_id = local_id(&input.id, GlobalIdType::BalanceSnapshotReview)?;
        match input.action {
            BalanceReviewAction::ApproveChanges => store::approve_balance_review(&self.pool, review_id).await?,
            BalanceReviewAction::UseProvider => store::use_provider_balance_review(&self.pool, review_id).await?,
        }
        Ok(ResolveBalanceReviewPayload { success: true })
    }

    pub async fn account_snapshot(&self, input: AccountSnapshotInput) -> Result<Option<AccountSnapshot>> {
        validate_optional_id(input.snapshot_id.as_ref(), GlobalIdType::AccountSnapshot)?;
        validate_optional_id(input.account_id.as_ref(), GlobalIdType::Account)?;
        self.wealth.account_snapshot(input).await
    }

    pub async fn account_snapshots(&self, input: AccountSnapshotsInput) -> Result<AccountSnapshotConnection> {
        validate_id(&input.account_id, GlobalIdType::Account)?;
        self.wealth.account_snapshots(input).await
    }

    pub async fn change_account_snapshot(
        &self,
        input: ChangeAccountSnapshotInput,
    ) -> Result<ChangeAccountSnapshotPayload> {
        validate_id(&input.snapshot_id, GlobalIdType::AccountSnapshot)?;
        for holding in &input.holdings {
            validate_id(&holding.asset_id, GlobalIdType::Asset)?;
        }
        let changed = self.wealth.change_account_snapshot(input).await?;
        Ok(ChangeAccountSnapshotPayload {
            snapshot: changed.snapshot,
            account: changed.account,
        })
    }
}
