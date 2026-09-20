mod generated;
#[path = "generated/objects.rs"]
mod objects;
#[path = "generated/roots.rs"]
mod roots;
mod scalars;

pub use generated::*;
pub use objects::*;
pub use roots::*;

#[cfg(test)]
mod tests {
    use async_graphql::{InputType, Value, resolver_utils::EnumType};
    use serde_json::json;
    use strum::IntoEnumIterator;

    use super::*;
    use crate::money::Cents;

    macro_rules! assert_enum_round_trips {
        ($($typ:ty),* $(,)?) => {
            $(
                for value in <$typ as IntoEnumIterator>::iter() {
                    let wire = value.to_string();
                    assert_eq!(wire.parse::<$typ>().unwrap(), value);
                    assert!(<$typ as EnumType>::items().iter().any(|item| item.name == wire && item.value == value));
                    assert_eq!(<$typ as InputType>::parse(Some(Value::from(wire))).unwrap(), value);
                }
            )*
        };
    }

    #[test]
    fn generated_enums_preserve_graphql_names() {
        assert_enum_round_trips!(
            AccountType,
            AnalysisView,
            AssetClassifier,
            AssetSourceAdapter,
            AssetType,
            BalanceReviewAction,
            BalanceReviewDecision,
            CategoryKind,
            ConnectivityStatus,
            Granularity,
            LiabilityCategory,
            LlmProvider,
            NetWorthRange,
            PlaidEnvironment,
            PlaidItemHealthState,
            RecurrenceInterval,
            RecurringStreamStatus,
            Role,
            SortDirection,
            TransactionSortField,
        );
    }

    #[test]
    fn generated_inputs_parse_schema_wire_names() {
        let range = DateTimeRange::parse(Some(json_value(json!({
            "from": "2026-09-06T12:00:00Z",
            "to": "2026-09-07T12:00:00Z"
        }))))
        .unwrap();
        assert_eq!(range.from.unwrap().to_rfc3339(), "2026-09-06T12:00:00+00:00");

        let transactions = BulkUpdateTransactionsInput::parse(Some(json_value(json!({
            "transactionIds": ["transaction"],
            "updates": {"merchantName": "Coffee", "tagIds": ["tag"]}
        }))))
        .unwrap();
        assert_eq!(transactions.transaction_ids.unwrap()[0].as_str(), "transaction");
        assert_eq!(transactions.updates.tag_ids.unwrap()[0].as_str(), "tag");

        let transaction = CreateTransactionInput::parse(Some(json_value(json!({
            "accountId": "account",
            "date": "2026-09-06",
            "amount": 12.34
        }))))
        .unwrap();
        assert_eq!(transaction.account_id.as_str(), "account");
        assert_eq!(transaction.date.as_str(), "2026-09-06");
        assert_eq!(transaction.amount, Cents(1234));

        let account = CreateManualAccountInput::parse(Some(json_value(json!({
            "connectionId": "connection",
            "name": "Cash",
            "ownerId": "owner",
            "type": "DEPOSITORY",
            "closed": true
        }))))
        .unwrap();
        assert_eq!(account.connection_id.unwrap().as_str(), "connection");
        assert_eq!(account.owner_id.as_str(), "owner");
        assert_eq!(account.r#type, AccountType::Depository);

        let holdings = ChangeAccountSnapshotInput::parse(Some(json_value(json!({
            "snapshotId": "snapshot",
            "holdings": [{"assetId": "asset", "quantity": 2.5, "valueUSD": 12.34}]
        }))))
        .unwrap();
        assert_eq!(holdings.holdings[0].asset_id.as_str(), "asset");
        assert_eq!(holdings.holdings[0].value_usd, Cents(1234));

        let history = BudgetReportHistoryInput::parse(Some(json_value(json!({
            "startMonth": "2026-01",
            "endMonth": "2026-02"
        }))))
        .unwrap();
        assert_eq!(history.end_month.as_deref(), Some("2026-02"));

        let analysis = AnalysisInput::parse(Some(json_value(json!({
            "view": "COMPOSITION",
            "ownerIds": ["owner"],
            "accountSubtypes": ["brokerage"]
        }))))
        .unwrap();
        assert_eq!(analysis.view, AnalysisView::Composition);
        assert_eq!(analysis.include_unclassified, Some(false));

        let configuration = UpdateConfigurationInput::parse(Some(json_value(json!({
            "locale": {"timezone": "America/New_York"},
            "setupComplete": true
        }))))
        .unwrap();
        assert_eq!(configuration.locale.unwrap().timezone, "America/New_York");
        assert_eq!(configuration.setup_complete, Some(true));
    }

    fn json_value(value: serde_json::Value) -> Value {
        Value::from_json(value).unwrap()
    }
}
