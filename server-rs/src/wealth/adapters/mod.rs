mod debank;
mod debank_retry;
mod manual;
mod plaid;
mod plaid_dedupe;
mod plaid_investment_valuation;
mod plaid_investments;
mod realestate;
mod simplefin;

pub use debank::DebankSyncAdapter;
pub use manual::ManualSyncAdapter;
pub use plaid::PlaidSyncAdapter;
pub use realestate::RealEstateSyncAdapter;
pub use simplefin::SimpleFinSyncAdapter;

#[cfg(test)]
mod tests;
