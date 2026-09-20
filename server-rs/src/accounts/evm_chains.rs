use std::collections::BTreeSet;

use anyhow::Result;

use crate::{apierror::ApiError, clients::debank::DEBANK_CHAINS};

pub const NO_EVM_CHAINS: &str = "at least one EVM chain is required";

pub fn normalize_evm_chain_ids(chain_ids: &[String]) -> Vec<String> {
    chain_ids.iter().cloned().collect::<BTreeSet<_>>().into_iter().collect()
}

pub fn validate_evm_chain_ids(chain_ids: &[String]) -> Result<()> {
    anyhow::ensure!(!chain_ids.is_empty(), ApiError::bad_input(NO_EVM_CHAINS));
    if let Some(chain_id) = chain_ids
        .iter()
        .find(|chain_id| !DEBANK_CHAINS.iter().any(|chain| chain.id == chain_id.as_str()))
    {
        return Err(ApiError::bad_input(format!("unknown EVM chain ID {chain_id:?}")).into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{normalize_evm_chain_ids, validate_evm_chain_ids};

    #[test]
    fn normalizes_and_validates_chain_ids() {
        assert_eq!(
            normalize_evm_chain_ids(&["op".into(), "eth".into(), "op".into(), "arb".into()]),
            ["arb", "eth", "op"]
        );
        assert!(validate_evm_chain_ids(&["eth".into(), "base".into()]).is_ok());
        assert!(validate_evm_chain_ids(&[]).is_err());
        assert!(validate_evm_chain_ids(&["not-a-chain".into()]).is_err());
    }
}
