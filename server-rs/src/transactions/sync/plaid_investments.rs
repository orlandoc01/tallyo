use std::collections::{HashMap, HashSet};

use anyhow::{Context, Result, ensure};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde_json::to_string;

use crate::{
    accounts::{PlaidItemSecret, store::hidden_account_ids_by_connection},
    clients::plaid::{InvestmentTransaction, PlaidClient, Security, Transaction},
    money::Cents,
    transactions::{
        RemovedTransaction, SyncBatchApi, SyncBatchLog, SyncedTransaction, TransactionSource,
        store::plaid_sync::plaid_transaction_ids_in_window,
    },
};

use super::{
    PersistEvent,
    plaid::{PlaidSync, log_batch},
    plaid_convert::{date_at_noon, non_empty},
};

const INVESTMENT_TRANSACTIONS_PAGE_SIZE: i32 = 500;

const INVESTMENT_SUBTYPE_PFC2: &[(&str, &str)] = &[
    ("dividend", "INCOME:INCOME_DIVIDENDS"),
    ("non-qualified dividend", "INCOME:INCOME_DIVIDENDS"),
    ("qualified dividend", "INCOME:INCOME_DIVIDENDS"),
    ("interest", "INCOME:INCOME_INTEREST_EARNED"),
    ("deposit", "TRANSFER_IN:TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS"),
    (
        "contribution",
        "TRANSFER_IN:TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS",
    ),
    (
        "withdrawal",
        "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
    ),
    (
        "distribution",
        "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
    ),
    ("long-term capital gain", "INCOME:INCOME_DIVIDENDS"),
    ("short-term capital gain", "INCOME:INCOME_DIVIDENDS"),
    ("unqualified gain", "INCOME:INCOME_DIVIDENDS"),
    ("return of principal", "INCOME:INCOME_DIVIDENDS"),
    (
        "dividend reinvestment",
        "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
    ),
    (
        "interest reinvestment",
        "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
    ),
    (
        "long-term capital gain reinvestment",
        "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
    ),
    (
        "short-term capital gain reinvestment",
        "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
    ),
    ("account fee", "BANK_FEES:BANK_FEES_OTHER_BANK_FEES"),
    ("fund fee", "BANK_FEES:BANK_FEES_OTHER_BANK_FEES"),
    ("management fee", "BANK_FEES:BANK_FEES_OTHER_BANK_FEES"),
    ("legal fee", "BANK_FEES:BANK_FEES_OTHER_BANK_FEES"),
    ("trust fee", "BANK_FEES:BANK_FEES_OTHER_BANK_FEES"),
    ("transfer fee", "BANK_FEES:BANK_FEES_OTHER_BANK_FEES"),
    ("miscellaneous fee", "BANK_FEES:BANK_FEES_OTHER_BANK_FEES"),
    ("margin expense", "BANK_FEES:BANK_FEES_OTHER_BANK_FEES"),
    ("tax", "BANK_FEES:BANK_FEES_OTHER_BANK_FEES"),
    ("tax withheld", "BANK_FEES:BANK_FEES_OTHER_BANK_FEES"),
    ("non-resident tax", "BANK_FEES:BANK_FEES_OTHER_BANK_FEES"),
    ("pending credit", "TRANSFER_IN:TRANSFER_IN_OTHER_TRANSFER_IN"),
    ("pending debit", "TRANSFER_OUT:TRANSFER_OUT_OTHER_TRANSFER_OUT"),
    (
        "adjustment",
        "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
    ),
    ("rebalance", "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"),
    ("merger", "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"),
    ("spin off", "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"),
    ("split", "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"),
    (
        "stock distribution",
        "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
    ),
    (
        "assignment",
        "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
    ),
    ("exercise", "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"),
    ("expire", "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"),
    ("request", "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"),
    ("send", "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"),
    ("trade", "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"),
    (
        "loan payment",
        "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
    ),
    (
        "interest receivable",
        "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
    ),
];

const INVESTMENT_TYPE_PFC2: &[(&str, &str)] = &[
    ("buy", "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"),
    ("sell", "TRANSFER_IN:TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS"),
    ("transfer", "TRANSFER_OUT:TRANSFER_OUT_ACCOUNT_TRANSFER"),
    ("cancel", "TRANSFER_IN:TRANSFER_IN_OTHER_TRANSFER_IN"),
];

impl PlaidSync {
    pub(super) async fn investment_events(
        &self,
        client: &PlaidClient,
        item: &PlaidItemSecret,
        account_ids: &[String],
        connection_id: i64,
    ) -> Result<Vec<PersistEvent>> {
        let hidden = hidden_account_ids_by_connection(&self.pool, connection_id).await?;
        let (start_date, end_date) = investment_transaction_date_range(item, Utc::now());
        let mut offset = 0;
        let mut securities = HashMap::new();
        let mut events = Vec::new();
        let mut logged_transactions = Vec::new();

        loop {
            let response = client
                .investments_transactions_get(
                    &item.plaid_items.access_token,
                    start_date,
                    end_date,
                    account_ids,
                    INVESTMENT_TRANSACTIONS_PAGE_SIZE,
                    offset,
                )
                .await?;
            securities.extend(
                response
                    .securities
                    .into_iter()
                    .map(|security| (security.security_id.clone(), security)),
            );
            let transactions = response.investment_transactions;
            let transaction_count = transactions.len() as i32;
            events.extend(
                transactions
                    .iter()
                    .map(|transaction| {
                        investment_transaction_from_plaid(
                            transaction,
                            &securities,
                            item.institution_name.as_deref(),
                            item.plaid_items.logo_url.as_deref(),
                            &hidden,
                        )
                        .map(PersistEvent::Upsert)
                    })
                    .collect::<Result<Vec<_>>>()?,
            );
            logged_transactions.extend(transactions);
            offset += transaction_count;
            if offset >= response.total_investment_transactions {
                break;
            }
            ensure!(
                transaction_count > 0,
                "plaid returned an empty investments page at offset {offset} of {}",
                response.total_investment_transactions
            );
        }

        let fetched_ids = logged_transactions
            .iter()
            .map(|transaction| transaction.investment_transaction_id.as_str())
            .collect::<HashSet<_>>();
        let removals = plaid_transaction_ids_in_window(&self.pool, account_ids, start_date, end_date)
            .await?
            .into_iter()
            .filter(|external_id| !fetched_ids.contains(external_id.as_str()))
            .collect::<Vec<_>>();
        log_batch(
            &self.pool,
            &investment_batch_log(item.plaid_items.id, &logged_transactions, &removals)?,
        )
        .await;
        events.extend(removals.into_iter().map(|external_id| {
            PersistEvent::Removal(RemovedTransaction {
                external_id,
                source: TransactionSource::Plaid,
            })
        }));
        Ok(events)
    }
}

pub(super) fn investment_transaction_from_plaid(
    transaction: &InvestmentTransaction,
    securities: &HashMap<String, Security>,
    institution_name: Option<&str>,
    logo_url: Option<&str>,
    hidden: &HashSet<String>,
) -> Result<SyncedTransaction> {
    let datetime = date_at_noon(&transaction.date)?;
    Ok(SyncedTransaction {
        external_id: transaction.investment_transaction_id.clone(),
        account_id: transaction.account_id.clone(),
        amount: Cents::from_dollars_checked(transaction.amount)?,
        datetime,
        posted_datetime: datetime,
        merchant_name: Some(derive_investment_merchant_name(
            transaction,
            securities,
            institution_name,
        )),
        original_name: non_empty(Some(&transaction.name)),
        logo_url: logo_url.map(ToOwned::to_owned),
        plaid_category: synthetic_investment_pfc2(transaction),
        raw_provider_json: Some(to_string(transaction).context("marshal raw plaid investment transaction")?),
        source: TransactionSource::Plaid,
        pending: false,
        hidden_by_account: hidden.contains(&transaction.account_id),
        stage_for_llm: false,
    })
}

pub(super) fn filter_out_investment_accounts(
    transactions: &[Transaction],
    investment_account_ids: &HashSet<String>,
) -> Vec<Transaction> {
    transactions
        .iter()
        .filter(|transaction| !investment_account_ids.contains(&transaction.account_id))
        .cloned()
        .collect()
}

fn investment_batch_log(
    item_id: i64,
    transactions: &[InvestmentTransaction],
    removed: &[String],
) -> Result<SyncBatchLog> {
    Ok(SyncBatchLog {
        item_id,
        api: SyncBatchApi::Investments,
        added: to_string(transactions).context("marshal raw plaid investment transactions")?,
        modified: "[]".to_owned(),
        removed: to_string(removed).context("marshal removed plaid investment transaction ids")?,
    })
}

fn investment_transaction_date_range(item: &PlaidItemSecret, now: DateTime<Utc>) -> (NaiveDate, NaiveDate) {
    let start = item
        .last_synced_at()
        .map(|last_synced_at| last_synced_at.with_timezone(&Utc) - Duration::days(7))
        .unwrap_or_else(|| now - Duration::days(30));
    (start.date_naive(), now.date_naive())
}

fn derive_investment_merchant_name(
    transaction: &InvestmentTransaction,
    securities: &HashMap<String, Security>,
    institution_name: Option<&str>,
) -> String {
    let prefix = institution_name
        .filter(|name| !name.is_empty())
        .map(|name| format!("{name} - "))
        .unwrap_or_default();
    let security = transaction
        .security_id
        .as_deref()
        .filter(|security_id| !security_id.is_empty())
        .and_then(|security_id| securities.get(security_id))
        .filter(|security| security.is_cash_equivalent != Some(true));
    let Some(name) = security.and_then(|security| security.name.as_deref().filter(|name| !name.is_empty())) else {
        return format!("{prefix}{}", investment_fallback_name(transaction));
    };
    let ticker = security.and_then(|security| security.ticker_symbol.as_deref().filter(|ticker| !ticker.is_empty()));
    ticker.map_or_else(
        || format!("{prefix}{name}"),
        |ticker| format!("{prefix}{name} ({ticker})"),
    )
}

fn investment_fallback_name(transaction: &InvestmentTransaction) -> String {
    let subtype = title_words(&transaction.subtype);
    if subtype.is_empty() { "Investment Activity".to_owned() } else { format!("Investment {subtype}") }
}

fn title_words(value: &str) -> String {
    value
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().chain(chars).collect::<String>())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn synthetic_investment_pfc2(transaction: &InvestmentTransaction) -> Option<String> {
    INVESTMENT_SUBTYPE_PFC2
        .iter()
        .find_map(|(subtype, category)| (*subtype == transaction.subtype).then_some((*category).to_owned()))
        .or_else(|| {
            INVESTMENT_TYPE_PFC2.iter().find_map(|(transaction_type, category)| {
                (*transaction_type == transaction.transaction_type).then_some((*category).to_owned())
            })
        })
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use anyhow::Result;
    use chrono::{NaiveDate, TimeZone, Utc};

    use super::{
        Security, derive_investment_merchant_name, filter_out_investment_accounts, investment_transaction_date_range,
        investment_transaction_from_plaid, synthetic_investment_pfc2,
    };
    use crate::{
        accounts::{PlaidSyncKind, store::plaid_item_secret_by_id},
        clients::plaid::{InvestmentTransaction, Transaction},
        database::dbtest,
        testutil::store::{create_owner, seed_plaid_item},
    };

    #[test]
    fn converts_investment_transactions() -> Result<()> {
        let transaction = investment_transaction("itx-1", "invest", Some("sec-1"), "buy", "buy", 123.45);
        let synced = investment_transaction_from_plaid(
            &transaction,
            &HashMap::from([(
                "sec-1".to_owned(),
                Security {
                    security_id: "sec-1".to_owned(),
                    name: Some("iShares 0-3 Month Treasury Bond ETF".to_owned()),
                    ticker_symbol: Some("SGOV".to_owned()),
                    ..Default::default()
                },
            )]),
            Some("Chase"),
            Some("https://icons.duckduckgo.com/ip3/chase.com.ico"),
            &HashSet::new(),
        )?;

        assert_eq!(synced.external_id, "itx-1");
        assert_eq!(synced.account_id, "invest");
        assert_eq!(synced.amount.0, 12_345);
        assert_eq!(synced.datetime, Utc.with_ymd_and_hms(2026, 6, 18, 12, 0, 0).unwrap());
        assert_eq!(synced.posted_datetime, synced.datetime);
        assert_eq!(
            synced.merchant_name.as_deref(),
            Some("Chase - iShares 0-3 Month Treasury Bond ETF (SGOV)")
        );
        assert_eq!(synced.original_name.as_deref(), Some("BUY"));
        assert_eq!(
            synced.logo_url.as_deref(),
            Some("https://icons.duckduckgo.com/ip3/chase.com.ico")
        );
        assert_eq!(
            synced.plaid_category.as_deref(),
            Some("TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS")
        );
        assert!(
            synced
                .raw_provider_json
                .as_deref()
                .is_some_and(|raw| raw.contains("itx-1"))
        );
        Ok(())
    }

    #[test]
    fn falls_back_for_cash_equivalent_securities() {
        let transaction = investment_transaction("itx-1", "invest", Some("cash"), "cash", "deposit", -100.0);
        let merchant = derive_investment_merchant_name(
            &transaction,
            &HashMap::from([(
                "cash".to_owned(),
                Security {
                    security_id: "cash".to_owned(),
                    name: Some("U.S. Dollar".to_owned()),
                    is_cash_equivalent: Some(true),
                    ..Default::default()
                },
            )]),
            Some("Chase"),
        );
        assert_eq!(merchant, "Chase - Investment Deposit");
    }

    #[test]
    fn maps_investment_personal_finance_categories() {
        let cases = [
            (
                "buy",
                "buy",
                "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
            ),
            (
                "sell",
                "sell",
                "TRANSFER_IN:TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS",
            ),
            ("fee", "dividend", "INCOME:INCOME_DIVIDENDS"),
            ("cash", "interest", "INCOME:INCOME_INTEREST_EARNED"),
            (
                "cash",
                "deposit",
                "TRANSFER_IN:TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS",
            ),
            (
                "cash",
                "withdrawal",
                "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
            ),
            ("fee", "account fee", "BANK_FEES:BANK_FEES_OTHER_BANK_FEES"),
            ("transfer", "transfer", "TRANSFER_OUT:TRANSFER_OUT_ACCOUNT_TRANSFER"),
            ("cancel", "cancel", "TRANSFER_IN:TRANSFER_IN_OTHER_TRANSFER_IN"),
            ("cash", "pending credit", "TRANSFER_IN:TRANSFER_IN_OTHER_TRANSFER_IN"),
            ("cash", "pending debit", "TRANSFER_OUT:TRANSFER_OUT_OTHER_TRANSFER_OUT"),
            (
                "cash",
                "rebalance",
                "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
            ),
        ];
        for (transaction_type, subtype, expected) in cases {
            assert_eq!(
                synthetic_investment_pfc2(&investment_transaction(
                    "itx",
                    "invest",
                    Some("sec"),
                    transaction_type,
                    subtype,
                    1.0
                ))
                .as_deref(),
                Some(expected)
            );
        }
    }

    #[tokio::test]
    async fn calculates_investment_transaction_date_ranges() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "Alex").await?;
        let (item_id, _) = seed_plaid_item(&pool, &owner, "item").await?;
        let now = Utc.with_ymd_and_hms(2026, 6, 20, 12, 0, 0).unwrap();
        let item = plaid_item_secret_by_id(&pool, item_id, PlaidSyncKind::Sync)
            .await?
            .expect("item exists");
        assert_eq!(
            investment_transaction_date_range(&item, now),
            (date(2026, 5, 21), date(2026, 6, 20))
        );

        sqlx::query("UPDATE plaid_items SET last_synced_at = '2026-06-14T09:00:00Z' WHERE id = ?")
            .bind(item_id)
            .execute(&pool)
            .await?;
        let item = plaid_item_secret_by_id(&pool, item_id, PlaidSyncKind::Sync)
            .await?
            .expect("item exists");
        assert_eq!(
            investment_transaction_date_range(&item, now),
            (date(2026, 6, 7), date(2026, 6, 20))
        );
        Ok(())
    }

    fn date(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).expect("valid date")
    }

    #[test]
    fn filters_regular_transactions_for_investment_accounts() {
        let transactions = vec![
            Transaction {
                transaction_id: "checking".to_owned(),
                account_id: "checking".to_owned(),
                ..Default::default()
            },
            Transaction {
                transaction_id: "investment".to_owned(),
                account_id: "invest".to_owned(),
                ..Default::default()
            },
        ];
        assert_eq!(
            filter_out_investment_accounts(&transactions, &HashSet::from(["invest".to_owned()]))
                .into_iter()
                .map(|transaction| transaction.transaction_id)
                .collect::<Vec<_>>(),
            ["checking"]
        );
    }

    fn investment_transaction(
        id: &str,
        account_id: &str,
        security_id: Option<&str>,
        transaction_type: &str,
        subtype: &str,
        amount: f64,
    ) -> InvestmentTransaction {
        InvestmentTransaction {
            investment_transaction_id: id.to_owned(),
            account_id: account_id.to_owned(),
            security_id: security_id.map(ToOwned::to_owned),
            date: "2026-06-18".to_owned(),
            name: subtype.to_uppercase(),
            amount,
            transaction_type: transaction_type.to_owned(),
            subtype: subtype.to_owned(),
            ..Default::default()
        }
    }
}
