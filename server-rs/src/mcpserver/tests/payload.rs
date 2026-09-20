use anyhow::Result;
use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use super::{all_scopes, identity};
use crate::wealth::LiabilityAccountBalance;
use crate::{
    auth::Scope,
    graph::HydratedRule,
    ids::Date,
    ids::GlobalIdType,
    mcpserver::{
        projections::map_account,
        projections_analysis::map_analysis_report,
        projections_networth::{map_holding_rollups, map_net_worth_report},
        projections_plaid::map_plaid_credential_list,
        projections_rules::{map_recurring_charge_list, map_rule},
        projections_transactions::{map_transaction_connection, map_transactions_summary},
        tool_result,
        tools::ToolOutput,
    },
    money::Cents,
    schema::{
        Account, AccountType, AnalysisHolding, AnalysisReport, AnalysisSlice, AnalysisView, Asset, AssetClassifier,
        AssetType, Category, CategoryKind, ClassifierBreakdown, ConnectivityStatus, Holding, HoldingRollup,
        LiabilityBreakdown, LiabilityCategory, NetWorthReport, Owner, PageInfo, PlaidCredential, PlaidEnvironment,
        RecurrenceInterval, RecurringCharge, RecurringStreamStatus, Rule, Transaction, TransactionConnection,
        TransactionEdge, TransactionsSummary,
    },
};

fn now() -> DateTime<Utc> {
    "2026-05-01T12:00:00Z".parse().unwrap()
}

fn fixture_accounts(n: i64) -> Vec<Account> {
    (0..n)
        .map(|i| Account {
            id: i,
            owner: Owner {
                id: 1,
                name: "Alex".to_owned(),
            },
            name: format!("Account Number {i} Checking"),
            r#type: AccountType::Depository,
            subtype: Some("checking".to_owned()),
            mask: None,
            notes: None,
            closed: false,
            hidden: false,
            needs_review: false,
            manual: false,
            created_at: now(),
            updated_at: now(),
        })
        .collect()
}

fn fixture_categories(n: i64) -> Vec<Category> {
    (0..n)
        .map(|i| Category {
            id: i,
            name: format!("Category {i}"),
            emoji: "\u{1F4B0}".to_owned(),
            group_name: "Everyday Spending".to_owned(),
            group_emoji: "\u{1F4E6}".to_owned(),
            kind: CategoryKind::Expense,
            sort_order: i as i32,
            plaid_pfc2_codes: vec!["FOOD_AND_DRINK".to_owned(), "FOOD_AND_DRINK_GROCERIES".to_owned()],
        })
        .collect()
}

fn fixture_transaction_connection(n: i64, num_accounts: i64, num_categories: i64) -> TransactionConnection {
    let accounts = fixture_accounts(num_accounts);
    let categories = fixture_categories(num_categories);
    let edges = (0..n)
        .map(|i| TransactionEdge {
            node: Transaction {
                id: i,
                account: accounts[(i % num_accounts) as usize].clone(),
                amount: Cents::from_dollars(12.34),
                datetime: now(),
                posted_datetime: now(),
                merchant_name: Some(format!("Merchant Number {i}")),
                original_name: Some(format!("ORIGINAL MERCHANT DESC {i}")),
                logo_url: None,
                category: categories[(i % num_categories) as usize].clone(),
                is_recurring: false,
                is_reviewed: i % 2 == 0,
                notes: None,
                plaid_category: None,
                pending: false,
                is_hidden: false,
                created_at: now(),
                updated_at: now(),
            },
            cursor: format!("cursor-{i}"),
        })
        .collect::<Vec<_>>();
    TransactionConnection {
        page_info: PageInfo {
            has_next_page: true,
            has_previous_page: false,
            start_cursor: edges.first().map(|edge| edge.cursor.clone()),
            end_cursor: edges.last().map(|edge| edge.cursor.clone()),
        },
        total_count: (n * 4) as i32,
        edges,
    }
}

fn fixture_asset(i: i64) -> Asset {
    Asset {
        id: i + 1,
        asset_type: AssetType::Security,
        identifier: format!("TICK{i}"),
        name: Some(format!("Fund {i}")),
        classifier: AssetClassifier::Public,
        current_price: None,
        forced_usd_price: None,
        tracking_ticker: None,
        tracking_multiplier: 1.0,
        price_connectivity: ConnectivityStatus::Healthy,
        investment_connectivity: ConnectivityStatus::Healthy,
    }
}

fn fixture_holding(asset: &Asset, account: &Account) -> Holding {
    Holding {
        asset_id: crate::ids::GlobalId::new(GlobalIdType::Asset, asset.id)
            .encoded_string()
            .into(),
        asset: asset.clone(),
        account_id: crate::ids::GlobalId::new(GlobalIdType::Account, account.id)
            .encoded_string()
            .into(),
        quantity: Some(10.0),
        value_usd: Cents(1000),
        manual: false,
    }
}

fn fixture_net_worth_report(num_holdings: i64, num_accounts: i64) -> NetWorthReport {
    let accounts = fixture_accounts(num_accounts);
    let holdings = (0..num_holdings)
        .map(|i| {
            let asset = fixture_asset(i);
            let holding = fixture_holding(&asset, &accounts[(i % num_accounts) as usize]);
            HoldingRollup {
                asset,
                total_quantity: Some(10.0),
                value_usd: Cents(1000),
                percent_of_classifier: 100.0 / num_holdings as f64,
                holdings: Some(vec![holding]),
            }
        })
        .collect();
    NetWorthReport {
        as_of_date: None,
        current_net_worth_usd: Cents(100_000),
        current_assets_usd: Cents(120_000),
        current_liabilities_usd: Cents(20_000),
        classifier_breakdown: vec![ClassifierBreakdown {
            classifier: AssetClassifier::Public,
            label: "Public Assets".to_owned(),
            value_usd: Cents(120_000),
            percent_of_assets: 100.0,
            asset_count: num_holdings as i32,
            holdings,
        }],
        liability_breakdown: vec![LiabilityBreakdown {
            category: LiabilityCategory::Card,
            label: "Cards".to_owned(),
            value_usd: Cents(20_000),
            percent_of_liabilities: 100.0,
            account_count: num_accounts as i32,
            balances: accounts
                .into_iter()
                .map(|account| LiabilityAccountBalance {
                    account,
                    balance_usd: Cents(20_000 / num_accounts),
                })
                .collect(),
        }],
    }
}

fn bare_rollup(holdings: Option<Vec<Holding>>) -> HoldingRollup {
    HoldingRollup {
        asset: fixture_asset(0),
        total_quantity: None,
        value_usd: Cents(0),
        percent_of_classifier: 0.0,
        holdings,
    }
}

#[test]
fn map_holding_rollups_preserves_unknown_quantity() {
    let rollups = map_holding_rollups(&all_scopes(), vec![bare_rollup(None)]);
    assert_eq!(rollups.len(), 1);
    assert_eq!(rollups[0].total_quantity, None);
}

#[test]
fn map_holding_rollups_omits_holdings_without_scope() -> Result<()> {
    let holding = fixture_holding(&fixture_asset(0), &fixture_accounts(1)[0]);
    let rollups = || vec![bare_rollup(Some(vec![holding.clone()]))];

    let without_scope = serde_json::to_value(map_holding_rollups(&identity(&[]), rollups()))?;
    assert!(without_scope[0].get("holdings").is_none(), "{without_scope}");

    let with_scope = map_holding_rollups(&identity(&[Scope::ReadHoldings]), rollups());
    assert_eq!(with_scope[0].holdings.len(), 1);
    assert_eq!(with_scope[0].holdings[0].asset_id, holding.asset_id.to_string());
    let text = serde_json::to_string(&with_scope)?;
    assert!(
        text.contains("\"quantity\":10.0") && text.contains("\"manual\":false"),
        "{text}"
    );
    let unknown_quantity = map_holding_rollups(
        &identity(&[Scope::ReadHoldings]),
        vec![bare_rollup(Some(vec![Holding {
            quantity: None,
            ..holding
        }]))],
    );
    assert!(serde_json::to_string(&unknown_quantity)?.contains("\"quantity\":null"));
    Ok(())
}

#[test]
fn list_transactions_payload_stays_lean() -> Result<()> {
    let connection = fixture_transaction_connection(50, 15, 10);
    let summary = format!(
        "Fetched {} transactions ({} total).",
        connection.edges.len(),
        connection.total_count
    );
    let dto = map_transaction_connection(connection);
    let dto_json = serde_json::to_value(&dto)?;
    let result = tool_result(ToolOutput {
        value: dto_json.clone(),
        summary,
    });
    let wire = serde_json::to_vec(&result)?;
    assert!(wire.len() < 45_000, "payload = {} bytes, want < 45000", wire.len());
    assert!(result.structured_content.is_some());

    let text = dto_json.to_string();
    for field in [
        "\"accountId\"",
        "\"accountName\"",
        "\"categoryId\"",
        "\"categoryName\"",
        "\"endCursor\"",
        "\"totalCount\"",
    ] {
        assert!(text.contains(field), "payload missing {field}: {text}");
    }
    assert!(
        text.contains("\"isReviewed\":false"),
        "payload should preserve false isReviewed"
    );
    assert!(!text.contains("\"cursor\""), "payload should drop per-edge cursors");
    assert!(
        !text.contains("\"isRecurring\"") && !text.contains("\"pending\""),
        "false flags are omitted: {text}"
    );
    Ok(())
}

#[test]
fn net_worth_payload_stays_lean() -> Result<()> {
    let report = fixture_net_worth_report(20, 15);
    let summary = format!("Current net worth: ${:.2}.", report.current_net_worth_usd.dollars());
    let dto = serde_json::to_value(map_net_worth_report(&all_scopes(), report))?;
    let result = tool_result(ToolOutput {
        value: dto.clone(),
        summary,
    });
    let wire = serde_json::to_vec(&result)?;
    assert!(wire.len() < 30_000, "payload = {} bytes, want < 30000", wire.len());
    assert!(result.structured_content.is_some());

    let text = dto.to_string();
    for field in [
        "\"ownerName\"",
        "\"identifier\"",
        "\"currentNetWorthUSD\"",
        "\"percentOfClassifier\"",
    ] {
        assert!(text.contains(field), "payload missing {field}: {text}");
    }
    assert!(
        !text.contains("\"connection\":") && !text.contains("\"mask\""),
        "{text}"
    );
    assert!(!text.contains("\"asOfDate\""), "absent asOfDate is omitted");
    Ok(())
}

#[test]
fn net_worth_payload_omits_holdings_without_scope() -> Result<()> {
    let dto = map_net_worth_report(&identity(&[]), fixture_net_worth_report(3, 2));
    assert!(
        dto.classifier_breakdown[0]
            .holdings
            .iter()
            .all(|rollup| rollup.holdings.is_empty())
    );
    // The rollup list itself is unprotected; only the per-account rows inside each rollup are gated.
    let text = serde_json::to_string(&dto)?;
    assert_eq!(dto.classifier_breakdown[0].holdings.len(), 3);
    assert!(
        !text.contains("\"assetId\"") && !text.contains("\"accountId\""),
        "{text}"
    );
    Ok(())
}

#[test]
fn lean_account_omits_false_flags_and_missing_subtype() -> Result<()> {
    let account = Account {
        subtype: None,
        ..fixture_accounts(1).remove(0)
    };
    let json = serde_json::to_value(map_account(account))?;
    assert_eq!(
        json,
        json!({
            "id": crate::ids::GlobalId::new(GlobalIdType::Account, 0).encoded_string(),
            "name": "Account Number 0 Checking",
            "type": "DEPOSITORY",
            "ownerId": crate::ids::GlobalId::new(GlobalIdType::Owner, 1).encoded_string(),
            "ownerName": "Alex"
        })
    );
    Ok(())
}

#[test]
fn lean_rule_omits_empty_relations() -> Result<()> {
    let rule = HydratedRule {
        rule: Rule {
            id: 7,
            merchant_pattern: None,
            original_pattern: None,
            merchant_name: None,
            category: None,
            should_hide: None,
            should_be_recurring: None,
            amount_min: None,
            amount_max: None,
            priority: 3,
            created_at: now(),
        },
        tags: Vec::new(),
        accounts: Vec::new(),
    };
    let json = serde_json::to_value(map_rule(rule))?;
    assert_eq!(
        json,
        json!({"id": crate::ids::GlobalId::new(GlobalIdType::Rule, 7).encoded_string(), "priority": 3})
    );
    Ok(())
}

#[test]
fn transactions_summary_omits_missing_dates_and_plaid_credential_flattens() -> Result<()> {
    let summary = serde_json::to_value(map_transactions_summary(TransactionsSummary {
        total_count: 0,
        total_amount: Cents(0),
        average_amount: Cents(0),
        largest_amount: Cents(0),
        first_date: None,
        last_date: None,
    }))?;
    assert_eq!(
        summary,
        json!({"totalCount": 0, "totalAmount": 0, "averageAmount": 0, "largestAmount": 0})
    );

    let credentials = serde_json::to_value(map_plaid_credential_list(vec![PlaidCredential {
        id: 1,
        client_id: "client".to_owned(),
        environment: PlaidEnvironment::Sandbox,
        label: None,
        item_count: 2,
        created_at: now(),
    }]))?;
    assert_eq!(
        credentials,
        json!({"items": [{"id": 1, "clientId": "client", "environment": "SANDBOX", "itemCount": 2}]})
    );
    let _: Value = credentials;
    Ok(())
}

#[test]
fn analysis_report_projection_keeps_go_field_names() -> Result<()> {
    let report = AnalysisReport {
        view: AnalysisView::Sectors,
        total_value_usd: Cents(12_345),
        slices: vec![AnalysisSlice {
            label: "Technology".to_owned(),
            value_usd: Cents(12_345),
            percent: 100.0,
            holdings: vec![AnalysisHolding {
                asset: fixture_asset(0),
                value_usd: Cents(12_345),
                percent: 100.0,
            }],
        }],
    };
    let json = serde_json::to_value(map_analysis_report(report))?;
    assert_eq!(json["view"], "SECTORS");
    assert_eq!(json["totalValueUSD"], 123.45);
    assert_eq!(json["slices"][0]["label"], "Technology");
    assert_eq!(json["slices"][0]["valueUSD"], 123.45);
    let holding = &json["slices"][0]["holdings"][0];
    assert_eq!(
        holding["asset"]["id"],
        crate::ids::GlobalId::new(GlobalIdType::Asset, 1).encoded_string()
    );
    assert_eq!(holding["asset"]["identifier"], "TICK0");
    assert_eq!(holding["percent"], 100.0);
    Ok(())
}

#[test]
fn recurring_charge_projection_flattens_the_category() -> Result<()> {
    let transaction = fixture_transaction_connection(1, 1, 1).edges.remove(0).node;
    let charge = |category: Option<Category>| RecurringCharge {
        id: 5,
        merchant_name: "Netflix".to_owned(),
        estimated_amount: Cents(1599),
        interval: Some(RecurrenceInterval::Monthly),
        category,
        transactions: vec![transaction.clone()],
        first_date: Date::new("2026-01-01").unwrap(),
        last_date: Date::new("2026-05-01").unwrap(),
        last_amount: Cents(1599),
        is_user_modified: false,
        next_expected_date: None,
        status: RecurringStreamStatus::Mature,
        is_active: true,
    };
    let categorised = serde_json::to_value(map_recurring_charge_list(vec![charge(Some(
        fixture_categories(1).remove(0),
    ))]))?;
    let item = &categorised["items"][0];
    assert_eq!(
        item["id"],
        crate::ids::GlobalId::new(GlobalIdType::RecurringCharge, 5).encoded_string()
    );
    assert_eq!(
        item["categoryId"],
        crate::ids::GlobalId::new(GlobalIdType::Category, 0).encoded_string()
    );
    assert_eq!(item["categoryName"], "Category 0");
    assert_eq!(item["interval"], "MONTHLY");
    assert_eq!(item["status"], "MATURE");
    assert_eq!(item["estimatedAmount"], 15.99);
    assert_eq!(item["transactions"][0]["merchantName"], "Merchant Number 0");
    assert!(item.get("nextExpectedDate").is_none());

    let uncategorised = serde_json::to_value(map_recurring_charge_list(vec![charge(None)]))?;
    assert!(uncategorised["items"][0].get("categoryId").is_none());
    assert!(uncategorised["items"][0].get("categoryName").is_none());
    Ok(())
}
