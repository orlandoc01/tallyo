use anyhow::Result;
use chrono_tz::Tz;

use super::{Resolver, transactions::validate_filter_id_types};
use crate::{
    auth::Identity,
    schema::SpendingFilter,
    transactions::{CashFlowReport, SpendingByCategoryReport, store},
};

impl Resolver {
    pub async fn spending_by_category(
        &self,
        identity: &Identity,
        filter: SpendingFilter,
    ) -> Result<SpendingByCategoryReport> {
        validate_spending_filter_id_types(&filter)?;
        store::spending_by_category(&self.pool, &filter, timezone(identity)).await
    }

    pub async fn cash_flow(&self, identity: &Identity, filter: SpendingFilter) -> Result<CashFlowReport> {
        validate_spending_filter_id_types(&filter)?;
        store::cash_flow(&self.pool, &filter, timezone(identity)).await
    }
}

fn validate_spending_filter_id_types(filter: &SpendingFilter) -> Result<()> {
    validate_filter_id_types(
        filter.category_ids.as_deref(),
        filter.account_ids.as_deref(),
        filter.owner_ids.as_deref(),
        filter.tag_ids.as_deref(),
    )
}

// Go reads the request timezone from the context; the identity carries it here.
pub(super) fn timezone(identity: &Identity) -> Tz {
    crate::wealth::timezone::timezone_or_utc(&identity.timezone)
}
