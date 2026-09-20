use url::Url;

use crate::{
    accounts::AccountType,
    clients::simplefin::{SimpleFinAccount, SimpleFinConnection},
    database::queries,
    utils::favicon::duckduckgo_favicon_url,
};

pub use crate::database::queries::SimpleFinTokenSecretsRow as SimpleFinAccessTokenSecret;

impl From<queries::SimpleFinTokenSecretByConnIdRow> for SimpleFinAccessTokenSecret {
    fn from(row: queries::SimpleFinTokenSecretByConnIdRow) -> Self {
        Self {
            access_url: row.access_url,
            created_at: row.created_at,
            id: row.id,
            label: row.label,
            last_synced_at: row.last_synced_at,
            next_balance_sync_at: row.next_balance_sync_at,
            next_sync_at: row.next_sync_at,
            owner_id: row.owner_id,
            sync_cron: row.sync_cron,
            updated_at: row.updated_at,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SimpleFinAccountFields {
    pub id: String,
    pub name: String,
    pub account_type: AccountType,
    pub mask: Option<String>,
    pub needs_review: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct UpsertSimpleFinConnectionParams {
    pub external_id: String,
    pub access_token_id: i64,
    pub org_id: Option<String>,
    pub org_domain: Option<String>,
    pub org_url: Option<String>,
    pub sfin_url: Option<String>,
    pub logo_url: Option<String>,
    pub name: String,
    pub owner_id: i64,
}

pub fn fields_from_simplefin_account(account: &SimpleFinAccount) -> SimpleFinAccountFields {
    let (name, mask) = simplefin_name_and_mask(&account.name);
    let balance = account.balance.trim().parse::<f64>().unwrap_or_default();
    let (account_type, needs_review) = infer_simplefin_account_type(&name, !account.holdings.is_empty(), balance);
    SimpleFinAccountFields {
        id: account.id.clone(),
        name,
        account_type,
        mask,
        needs_review,
    }
}

pub fn new_upsert_simple_fin_connection_params(
    token_id: i64,
    owner_id: i64,
    connection: &SimpleFinConnection,
) -> UpsertSimpleFinConnectionParams {
    let org_domain = simplefin_org_domain(&connection.org_url);
    UpsertSimpleFinConnectionParams {
        external_id: connection.conn_id.clone(),
        access_token_id: token_id,
        org_id: nonempty(&connection.org_id),
        org_domain: nonempty(&org_domain),
        org_url: nonempty(&connection.org_url),
        sfin_url: nonempty(&connection.sfin_url),
        logo_url: duckduckgo_favicon_url(&connection.org_url),
        name: connection.name.clone(),
        owner_id,
    }
}

fn simplefin_name_and_mask(name: &str) -> (String, Option<String>) {
    let trimmed = name.trim_end();
    let Some(without_closing) = trimmed.strip_suffix(')') else {
        return (name.trim().to_owned(), None);
    };
    let Some((base, mask)) = without_closing.rsplit_once('(') else {
        return (name.trim().to_owned(), None);
    };
    if !base.chars().next_back().is_some_and(char::is_whitespace)
        || mask.is_empty()
        || !mask.bytes().all(|byte| byte.is_ascii_digit())
    {
        return (name.trim().to_owned(), None);
    }
    let base = base.trim();
    if base.is_empty() {
        return (name.trim().to_owned(), None);
    }
    (base.to_owned(), Some(mask.to_owned()))
}

fn infer_simplefin_account_type(name: &str, has_holdings: bool, balance: f64) -> (AccountType, bool) {
    let name = name
        .to_ascii_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    match (has_holdings, name.as_str(), balance) {
        (true, _, _) => (AccountType::Investment, false),
        (_, name, _) if name.contains("brokerage") => (AccountType::Investment, false),
        (_, name, _)
            if has_keyword(
                name,
                &[
                    "checking",
                    "savings",
                    "money market",
                    "cd",
                    "hsa",
                    "cash mgmt",
                    "cash management",
                    "high yield",
                ],
            ) =>
        {
            (AccountType::Depository, false)
        }
        (_, name, _)
            if has_keyword(
                name,
                &[
                    "card",
                    "credit",
                    "visa",
                    "mastercard",
                    "amex",
                    "american express",
                    "freedom",
                    "sapphire",
                    "platinum",
                    "gold",
                    "blue cash",
                    "hyatt",
                    "gateway",
                    "mileage",
                    "rewards",
                    "cashback",
                ],
            ) =>
        {
            (AccountType::Credit, false)
        }
        (_, name, _)
            if has_keyword(
                name,
                &["loan", "mortgage", "auto", "heloc", "student", "line of credit"],
            ) =>
        {
            (AccountType::Loan, false)
        }
        (_, _, balance) if balance < 0.0 => (AccountType::Credit, false),
        (_, _, balance) if balance > 0.0 => (AccountType::Depository, false),
        _ => (AccountType::Credit, true),
    }
}

fn has_keyword(name: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|keyword| {
        name.match_indices(keyword).any(|(index, _)| {
            let before = name[..index].chars().next_back();
            let after = name[index + keyword.len()..].chars().next();
            !before.is_some_and(char::is_alphanumeric) && !after.is_some_and(char::is_alphanumeric)
        })
    })
}

fn simplefin_org_domain(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| url.to_owned())
}

fn nonempty(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_owned())
}

#[cfg(test)]
mod tests {
    use crate::{
        accounts::{AccountType, simplefin_types::fields_from_simplefin_account},
        clients::simplefin::{SimpleFinAccount, SimpleFinHolding},
    };

    #[test]
    fn infers_simplefin_account_fields() {
        struct Case {
            name: &'static str,
            balance: &'static str,
            holdings: bool,
            expected_name: &'static str,
            expected_mask: Option<&'static str>,
            expected_type: AccountType,
            expected_needs_review: bool,
        }

        let cases = [
            Case {
                name: "Joint Checking",
                balance: "",
                holdings: false,
                expected_name: "Joint Checking",
                expected_mask: None,
                expected_type: AccountType::Depository,
                expected_needs_review: false,
            },
            Case {
                name: "Sapphire Reserve (4628)",
                balance: "",
                holdings: false,
                expected_name: "Sapphire Reserve",
                expected_mask: Some("4628"),
                expected_type: AccountType::Credit,
                expected_needs_review: false,
            },
            Case {
                name: "Sapphire Reserve",
                balance: "",
                holdings: false,
                expected_name: "Sapphire Reserve",
                expected_mask: None,
                expected_type: AccountType::Credit,
                expected_needs_review: false,
            },
            Case {
                name: "Auto Loan",
                balance: "",
                holdings: false,
                expected_name: "Auto Loan",
                expected_mask: None,
                expected_type: AccountType::Loan,
                expected_needs_review: false,
            },
            Case {
                name: "Self Directed",
                balance: "",
                holdings: true,
                expected_name: "Self Directed",
                expected_mask: None,
                expected_type: AccountType::Investment,
                expected_needs_review: false,
            },
            Case {
                name: "Taxable brokerage",
                balance: "",
                holdings: false,
                expected_name: "Taxable brokerage",
                expected_mask: None,
                expected_type: AccountType::Investment,
                expected_needs_review: false,
            },
            Case {
                name: "Self Directed BrokerageAccount",
                balance: "",
                holdings: false,
                expected_name: "Self Directed BrokerageAccount",
                expected_mask: None,
                expected_type: AccountType::Investment,
                expected_needs_review: false,
            },
            Case {
                name: "Mystery Account",
                balance: "",
                holdings: false,
                expected_name: "Mystery Account",
                expected_mask: None,
                expected_type: AccountType::Credit,
                expected_needs_review: true,
            },
            Case {
                name: "Joint Checking",
                balance: "-106.17",
                holdings: false,
                expected_name: "Joint Checking",
                expected_mask: None,
                expected_type: AccountType::Depository,
                expected_needs_review: false,
            },
            Case {
                name: "Premier Account",
                balance: "-50.00",
                holdings: false,
                expected_name: "Premier Account",
                expected_mask: None,
                expected_type: AccountType::Credit,
                expected_needs_review: false,
            },
            Case {
                name: "Premier Account",
                balance: "500.00",
                holdings: false,
                expected_name: "Premier Account",
                expected_mask: None,
                expected_type: AccountType::Depository,
                expected_needs_review: false,
            },
        ];

        for case in cases {
            let fields = fields_from_simplefin_account(&SimpleFinAccount {
                name: case.name.into(),
                balance: case.balance.into(),
                holdings: if case.holdings { vec![SimpleFinHolding::default()] } else { Vec::new() },
                ..Default::default()
            });
            assert_eq!(fields.name, case.expected_name, "{}", case.name);
            assert_eq!(fields.mask.as_deref(), case.expected_mask, "{}", case.name);
            assert_eq!(fields.account_type, case.expected_type, "{}", case.name);
            assert_eq!(fields.needs_review, case.expected_needs_review, "{}", case.name);
        }
    }
}
