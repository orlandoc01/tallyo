mod auto_categorize;
mod cash_flow;
mod categories;
mod category_pfc;
mod import;
pub mod llm_store;
mod mapping;
pub(crate) mod plaid_sync;
mod query;
mod recurring;
pub mod recurring_write;
mod report_periods;
mod reports;
mod rule_values;
mod rules;
pub(crate) mod simplefin_sync;
pub(crate) mod sync;
mod tags;
mod transaction_targets;
mod transaction_updates;
mod transactions;

pub use cash_flow::*;
pub use categories::*;
pub use import::*;
pub use recurring::*;
pub use reports::*;
pub use rules::*;
pub use tags::*;
pub use transactions::*;

pub(crate) use mapping::category_from_row;

#[cfg(test)]
pub(crate) const HANDWRITTEN_QUERIES: &[(&str, &str)] = &[(
    "similar_categorized_by_merchants",
    llm_store::SIMILAR_CATEGORIZED_BY_MERCHANTS_SQL,
)];

#[cfg(test)]
mod tests;
