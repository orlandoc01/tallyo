use anyhow::Result;

use super::{Resolver, ids::local_ids};
use crate::{
    ids::GlobalIdType,
    portfolio::{self, AnalysisReport, HoldingsFilter},
    schema::AnalysisInput,
};

impl Resolver {
    pub async fn analysis(&self, input: AnalysisInput) -> Result<AnalysisReport> {
        let owner_ids = local_ids(input.owner_ids.as_deref(), GlobalIdType::Owner)?;
        let account_ids = local_ids(input.account_ids.as_deref(), GlobalIdType::Account)?;
        portfolio::analyze(
            &self.pool,
            input.view,
            HoldingsFilter {
                owner_ids,
                account_subtypes: input.account_subtypes.unwrap_or_default(),
                account_ids,
                include_unclassified: input.include_unclassified.unwrap_or_default(),
            },
        )
        .await
    }
}
