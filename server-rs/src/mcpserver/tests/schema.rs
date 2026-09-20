use anyhow::Result;
use serde_json::Value;

use super::{Client, all_scopes, server};
use crate::{
    mcpserver::tools::{TOOLS, ToolSpec, input_schema},
    schema::TransactionsInput,
};

const GO_TOOL_NAMES: [&str; 26] = [
    "list_transactions",
    "get_transaction",
    "spending_by_category",
    "cash_flow",
    "transactions_summary",
    "list_categories",
    "list_category_groups",
    "list_accounts",
    "net_worth",
    "portfolio_analysis",
    "list_recurring_charges",
    "list_rules",
    "list_plaid_items",
    "list_plaid_credentials",
    "list_owners",
    "budget_report",
    "bulk_update_transactions",
    "create_rule",
    "delete_rule",
    "update_transaction",
    "delete_transaction",
    "bulk_delete_transactions",
    "create_transaction",
    "update_account",
    "create_manual_account",
    "set_budget",
];

#[test]
fn registered_tools_marshal_input_schema() -> Result<()> {
    let names = TOOLS.iter().map(|spec| spec.name).collect::<Vec<_>>();
    assert_eq!(names, GO_TOOL_NAMES);
    for spec in &TOOLS {
        let tool = serde_json::to_value(spec.definition())?;
        assert_eq!(tool["inputSchema"]["type"], "object", "{}", spec.name);
        assert_eq!(tool["inputSchema"]["additionalProperties"], false, "{}", spec.name);
        assert!(
            tool["description"].as_str().is_some_and(|d| !d.is_empty()),
            "{}",
            spec.name
        );
        let read_only = names[..16].contains(&spec.name);
        assert_eq!(tool["annotations"]["readOnlyHint"], read_only, "{}", spec.name);
        let destructive = ["delete_rule", "delete_transaction", "bulk_delete_transactions"].contains(&spec.name);
        assert_eq!(
            tool["annotations"]["destructiveHint"].as_bool(),
            destructive.then_some(true),
            "{}",
            spec.name
        );
    }
    Ok(())
}

#[test]
fn list_transactions_schema_uses_strings_for_custom_scalars() {
    let schema = Value::Object(input_schema::<TransactionsInput>());
    let filter = prop(&schema, "filter");
    let from = prop(prop(filter, "datetimeRange"), "from");
    assert_type_includes("filter.datetimeRange.from", from, "string");
    let items = &prop(filter, "categoryIds")["items"];
    assert!(items.is_object(), "filter.categoryIds: missing items schema: {filter}");
    assert_type_includes("filter.categoryIds[]", items, "string");
    assert_eq!(
        items["description"],
        "Opaque global ID, as returned by other tool calls."
    );
    let amount = prop(filter, "amountMin");
    assert_type_includes("filter.amountMin", amount, "number");
    assert_eq!(amount["description"], "USD amount in dollars, e.g. 12.34.");
    assert!(schema.get("$defs").is_none(), "nested inputs must be inlined: {schema}");
}

#[test]
fn every_tool_operation_has_a_generated_scope() {
    let identity = all_scopes();
    for spec in &TOOLS {
        let checked = crate::graph::operation_scope(spec.operation(), spec.operation_name)
            .and_then(|scope| crate::graph::require_scope(Some(&identity), scope));
        assert!(checked.is_ok(), "{}: {checked:?}", spec.name);
    }
}

#[tokio::test]
async fn tools_list_over_http_carries_schemas_and_annotations() -> Result<()> {
    let (_, server) = server().await?;
    let client = Client::connect(server, Some(all_scopes())).await?;
    let listed = client.request("tools/list", serde_json::json!({})).await?;
    let tools = listed["tools"].as_array().unwrap();
    let by_name = |name: &str| tools.iter().find(|tool| tool["name"] == name).unwrap();
    assert_eq!(by_name("list_accounts")["annotations"]["readOnlyHint"], true);
    assert_eq!(by_name("list_accounts")["inputSchema"]["additionalProperties"], false);
    assert_eq!(by_name("delete_rule")["annotations"]["destructiveHint"], true);
    assert_eq!(
        by_name("delete_rule")["inputSchema"]["required"],
        serde_json::json!(["id", "confirm"])
    );
    assert_eq!(
        by_name("delete_rule")["description"],
        "Delete a rule. Requires confirm=true."
    );
    Ok(())
}

fn prop<'a>(schema: &'a Value, name: &str) -> &'a Value {
    let property = &schema["properties"][name];
    assert!(property.is_object(), "schema missing property {name:?}: {schema}");
    property
}

fn assert_type_includes(path: &str, schema: &Value, want: &str) {
    match &schema["type"] {
        Value::String(typ) => assert_eq!(typ, want, "{path}"),
        Value::Array(types) => assert!(types.iter().any(|typ| typ == want), "{path}: {types:?}"),
        other => panic!("{path}: schema has no usable type field: {other}"),
    }
}

#[test]
fn tool_spec_operations_follow_their_kind() {
    let by_name = |name: &str| TOOLS.iter().find(|spec| spec.name == name).unwrap();
    assert_eq!(ToolSpec::operation(by_name("list_rules")), "Query");
    assert_eq!(ToolSpec::operation(by_name("create_rule")), "Mutation");
    assert_eq!(ToolSpec::operation(by_name("delete_rule")), "Mutation");
}
