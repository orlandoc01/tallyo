use std::{str::FromStr, sync::LazyLock};

use strum_macros::{Display, EnumString, IntoStaticStr};

use crate::schema::Role;

#[derive(Clone, Copy, Debug, Display, EnumString, IntoStaticStr, PartialEq, Eq, Hash)]
#[strum(serialize_all = "snake_case")]
pub enum Scope {
    #[strum(serialize = "read:transactions")]
    ReadTransactions,
    #[strum(serialize = "write:transactions")]
    WriteTransactions,
    #[strum(serialize = "read:accounts")]
    ReadAccounts,
    #[strum(serialize = "write:accounts")]
    WriteAccounts,
    #[strum(serialize = "read:users")]
    ReadUsers,
    #[strum(serialize = "write:users")]
    WriteUsers,
    #[strum(serialize = "read:rules")]
    ReadRules,
    #[strum(serialize = "write:rules")]
    WriteRules,
    #[strum(serialize = "read:categories")]
    ReadCategories,
    #[strum(serialize = "write:categories")]
    WriteCategories,
    #[strum(serialize = "read:spending")]
    ReadSpending,
    #[strum(serialize = "read:cashflow")]
    ReadCashflow,
    #[strum(serialize = "read:owners")]
    ReadOwners,
    #[strum(serialize = "write:owners")]
    WriteOwners,
    #[strum(serialize = "read:assets")]
    ReadAssets,
    #[strum(serialize = "write:assets")]
    WriteAssets,
    #[strum(serialize = "read:wealth")]
    ReadWealth,
    #[strum(serialize = "write:wealth")]
    WriteWealth,
    #[strum(serialize = "read:holdings")]
    ReadHoldings,
    #[strum(serialize = "read:portfolio")]
    ReadPortfolio,
    #[strum(serialize = "read:budgets")]
    ReadBudgets,
    #[strum(serialize = "write:budgets")]
    WriteBudgets,
    #[strum(serialize = "read:tags")]
    ReadTags,
    #[strum(serialize = "write:tags")]
    WriteTags,
    #[strum(serialize = "read:settings")]
    ReadSettings,
    #[strum(serialize = "write:settings")]
    WriteSettings,
}

pub const ALL_SCOPES: &[Scope] = &[
    Scope::ReadTransactions,
    Scope::WriteTransactions,
    Scope::ReadAccounts,
    Scope::WriteAccounts,
    Scope::ReadUsers,
    Scope::WriteUsers,
    Scope::ReadRules,
    Scope::WriteRules,
    Scope::ReadCategories,
    Scope::WriteCategories,
    Scope::ReadSpending,
    Scope::ReadCashflow,
    Scope::ReadOwners,
    Scope::WriteOwners,
    Scope::ReadAssets,
    Scope::WriteAssets,
    Scope::ReadWealth,
    Scope::WriteWealth,
    Scope::ReadHoldings,
    Scope::ReadPortfolio,
    Scope::ReadBudgets,
    Scope::WriteBudgets,
    Scope::ReadTags,
    Scope::WriteTags,
    Scope::ReadSettings,
    Scope::WriteSettings,
];
pub static CLIENT_ALLOWED_SCOPES: LazyLock<Vec<&'static str>> = LazyLock::new(|| {
    ["read", "write"]
        .into_iter()
        .chain(ALL_SCOPES.iter().map(|scope| (*scope).into()))
        .collect()
});

pub fn scopes_for_role(role: Role) -> &'static [Scope] {
    match role {
        Role::Admin => ALL_SCOPES,
        Role::Writer => &[
            Scope::ReadTransactions,
            Scope::WriteTransactions,
            Scope::ReadAccounts,
            Scope::WriteAccounts,
            Scope::ReadRules,
            Scope::WriteRules,
            Scope::ReadCategories,
            Scope::WriteCategories,
            Scope::ReadSpending,
            Scope::ReadCashflow,
            Scope::ReadOwners,
            Scope::ReadAssets,
            Scope::WriteAssets,
            Scope::ReadWealth,
            Scope::WriteWealth,
            Scope::ReadHoldings,
            Scope::ReadPortfolio,
            Scope::ReadBudgets,
            Scope::WriteBudgets,
            Scope::ReadTags,
            Scope::WriteTags,
        ],
        Role::Readonly => &[
            Scope::ReadTransactions,
            Scope::ReadAccounts,
            Scope::ReadRules,
            Scope::ReadCategories,
            Scope::ReadSpending,
            Scope::ReadCashflow,
            Scope::ReadOwners,
            Scope::ReadAssets,
            Scope::ReadWealth,
            Scope::ReadHoldings,
            Scope::ReadPortfolio,
            Scope::ReadBudgets,
            Scope::ReadTags,
        ],
        Role::SpendTracker => &[
            Scope::ReadSpending,
            Scope::ReadCategories,
            Scope::ReadOwners,
            Scope::ReadTags,
        ],
        Role::CashflowTracker => &[
            Scope::ReadSpending,
            Scope::ReadCashflow,
            Scope::ReadCategories,
            Scope::ReadOwners,
            Scope::ReadBudgets,
            Scope::WriteBudgets,
            Scope::ReadTags,
        ],
        Role::NetWorthTracker => &[
            Scope::ReadAssets,
            Scope::WriteAssets,
            Scope::ReadWealth,
            Scope::WriteWealth,
            Scope::ReadAccounts,
            Scope::ReadOwners,
        ],
        Role::PortfolioTracker => &[Scope::ReadPortfolio, Scope::ReadAccounts, Scope::ReadOwners],
    }
}

pub fn expand_requested_scopes(requested: &[String]) -> Vec<Scope> {
    ALL_SCOPES
        .iter()
        .copied()
        .filter(|scope| {
            let scope: &'static str = (*scope).into();
            requested.iter().any(|requested| {
                requested == scope
                    || (requested == "read" && scope.starts_with("read:"))
                    || (requested == "write" && scope.starts_with("write:"))
            })
        })
        .collect()
}

pub fn granted_scopes_for_role(role: Role, requested: &[String]) -> Vec<Scope> {
    let requested = expand_requested_scopes(requested);
    scopes_for_role(role)
        .iter()
        .copied()
        .filter(|scope| requested.contains(scope))
        .collect()
}

pub(super) fn parse_scopes(value: &str) -> Vec<Scope> {
    value
        .split_whitespace()
        .filter_map(|scope| Scope::from_str(scope).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use strum::IntoEnumIterator;

    use super::{Scope, expand_requested_scopes, granted_scopes_for_role, scopes_for_role};
    use crate::schema::Role;

    #[test]
    fn round_trips_persisted_role_names() {
        for role in Role::iter() {
            let persisted = role.to_string().to_ascii_lowercase();
            assert_eq!(persisted.to_ascii_uppercase().parse(), Ok(role));
        }
        assert!("unknown".parse::<Role>().is_err());
    }

    #[test]
    fn matches_each_role_scope_set() {
        let cases: &[(Role, &[Scope])] = &[
            (Role::Admin, super::ALL_SCOPES),
            (
                Role::Writer,
                &[
                    Scope::ReadTransactions,
                    Scope::WriteTransactions,
                    Scope::ReadAccounts,
                    Scope::WriteAccounts,
                    Scope::ReadRules,
                    Scope::WriteRules,
                    Scope::ReadCategories,
                    Scope::WriteCategories,
                    Scope::ReadSpending,
                    Scope::ReadCashflow,
                    Scope::ReadOwners,
                    Scope::ReadAssets,
                    Scope::WriteAssets,
                    Scope::ReadWealth,
                    Scope::WriteWealth,
                    Scope::ReadHoldings,
                    Scope::ReadPortfolio,
                    Scope::ReadBudgets,
                    Scope::WriteBudgets,
                    Scope::ReadTags,
                    Scope::WriteTags,
                ],
            ),
            (
                Role::Readonly,
                &[
                    Scope::ReadTransactions,
                    Scope::ReadAccounts,
                    Scope::ReadRules,
                    Scope::ReadCategories,
                    Scope::ReadSpending,
                    Scope::ReadCashflow,
                    Scope::ReadOwners,
                    Scope::ReadAssets,
                    Scope::ReadWealth,
                    Scope::ReadHoldings,
                    Scope::ReadPortfolio,
                    Scope::ReadBudgets,
                    Scope::ReadTags,
                ],
            ),
            (
                Role::SpendTracker,
                &[
                    Scope::ReadSpending,
                    Scope::ReadCategories,
                    Scope::ReadOwners,
                    Scope::ReadTags,
                ],
            ),
            (
                Role::CashflowTracker,
                &[
                    Scope::ReadSpending,
                    Scope::ReadCashflow,
                    Scope::ReadCategories,
                    Scope::ReadOwners,
                    Scope::ReadBudgets,
                    Scope::WriteBudgets,
                    Scope::ReadTags,
                ],
            ),
            (
                Role::NetWorthTracker,
                &[
                    Scope::ReadAssets,
                    Scope::WriteAssets,
                    Scope::ReadWealth,
                    Scope::WriteWealth,
                    Scope::ReadAccounts,
                    Scope::ReadOwners,
                ],
            ),
            (
                Role::PortfolioTracker,
                &[Scope::ReadPortfolio, Scope::ReadAccounts, Scope::ReadOwners],
            ),
        ];
        for &(role, expected) in cases {
            assert_eq!(scopes_for_role(role), expected);
        }
    }

    #[test]
    fn expands_shorthand_before_role_intersection() {
        let requested = vec!["read".to_owned(), "write".to_owned()];
        let granted = granted_scopes_for_role(Role::SpendTracker, &requested);
        assert_eq!(granted, scopes_for_role(Role::SpendTracker));
        assert!(expand_requested_scopes(&requested).contains(&Scope::WriteAccounts));
        assert!(!granted_scopes_for_role(Role::Writer, &["write:users".to_owned()]).contains(&Scope::WriteUsers));
    }
}
