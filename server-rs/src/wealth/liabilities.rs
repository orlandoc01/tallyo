use std::collections::HashMap;

use crate::{accounts::AccountType, schema::LiabilityCategory};

use super::{LiabilityAccountBalance, LiabilityBreakdown};

pub const LIABILITY_SERIES_ORDER: [LiabilityCategory; 4] = [
    LiabilityCategory::Card,
    LiabilityCategory::Mortgage,
    LiabilityCategory::Loan,
    LiabilityCategory::Other,
];

pub fn is_liability_type(account_type: AccountType) -> bool {
    matches!(account_type, AccountType::Credit | AccountType::Loan)
}

pub fn liability_category(account_type: AccountType, subtype: Option<&str>) -> LiabilityCategory {
    match (account_type, subtype.map(str::to_ascii_lowercase).as_deref()) {
        (AccountType::Credit, _) => LiabilityCategory::Card,
        (AccountType::Loan, Some("mortgage" | "home equity")) => LiabilityCategory::Mortgage,
        (
            AccountType::Loan,
            Some(
                "auto" | "business" | "commercial" | "construction" | "consumer" | "line of credit" | "loan"
                | "overdraft" | "student",
            ),
        ) => LiabilityCategory::Loan,
        _ => LiabilityCategory::Other,
    }
}

pub fn liability_label(category: LiabilityCategory) -> &'static str {
    match category {
        LiabilityCategory::Card => "Cards",
        LiabilityCategory::Mortgage => "Mortgage",
        LiabilityCategory::Loan => "Loans",
        LiabilityCategory::Other => "Other Liabilities",
    }
}

pub fn liability_breakdown(
    balances: Vec<LiabilityAccountBalance>,
    total: crate::money::Cents,
) -> Vec<LiabilityBreakdown> {
    let mut grouped = balances.into_iter().fold(
        HashMap::<LiabilityCategory, Vec<LiabilityAccountBalance>>::new(),
        |mut grouped, balance| {
            grouped
                .entry(liability_category(
                    balance.account.r#type,
                    balance.account.subtype.as_deref(),
                ))
                .or_default()
                .push(balance);
            grouped
        },
    );

    LIABILITY_SERIES_ORDER
        .into_iter()
        .filter_map(|category| {
            let balances = grouped.remove(&category)?;
            let value_usd = balances.iter().map(|balance| balance.balance_usd).sum();
            Some(LiabilityBreakdown {
                category,
                label: liability_label(category).to_owned(),
                value_usd,
                percent_of_liabilities: if total != crate::money::Cents::default() {
                    value_usd.dollars() / total.dollars() * 100.0
                } else {
                    0.0
                },
                account_count: balances.len() as i32,
                balances,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{liability_breakdown, liability_category};
    use crate::{
        accounts::{AccountType, Owner},
        money::Cents,
        schema::LiabilityCategory,
        wealth::LiabilityAccountBalance,
    };

    #[test]
    fn categorizes_liabilities_with_the_provider_subtype_rules() {
        for (account_type, subtype, expected) in [
            (AccountType::Credit, None, LiabilityCategory::Card),
            (AccountType::Loan, Some("MORTGAGE"), LiabilityCategory::Mortgage),
            (AccountType::Loan, Some("student"), LiabilityCategory::Loan),
            (AccountType::Loan, Some("unknown"), LiabilityCategory::Other),
        ] {
            assert_eq!(liability_category(account_type, subtype), expected);
        }
    }

    #[test]
    fn sorts_breakdowns_in_schema_order() {
        let balances = [
            (AccountType::Loan, Some("mortgage"), Cents(30_000)),
            (AccountType::Credit, None, Cents(50_000)),
        ]
        .into_iter()
        .map(|(account_type, subtype, balance_usd)| LiabilityAccountBalance {
            account: crate::accounts::Account {
                id: balance_usd.0,
                owner: Owner {
                    id: 1,
                    ..Default::default()
                },
                name: String::new(),
                r#type: account_type,
                subtype: subtype.map(ToOwned::to_owned),
                mask: None,
                notes: None,
                closed: false,
                hidden: false,
                needs_review: false,
                manual: false,
                created_at: "2026-09-06T12:00:00Z".parse().unwrap(),
                updated_at: "2026-09-06T12:00:00Z".parse().unwrap(),
            },
            balance_usd,
        })
        .collect();

        let breakdown = liability_breakdown(balances, Cents(80_000));

        assert_eq!(
            breakdown.iter().map(|item| item.category).collect::<Vec<_>>(),
            [LiabilityCategory::Card, LiabilityCategory::Mortgage]
        );
        assert_eq!(breakdown[0].percent_of_liabilities, 62.5);
    }
}
