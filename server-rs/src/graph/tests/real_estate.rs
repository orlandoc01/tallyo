use anyhow::Result;
use serde_json::{Value, json};

use super::{all_scopes, by_name, code, global_id};
use crate::{database::dbtest, ids::GlobalIdType, testutil::store::create_owner};

#[tokio::test]
async fn manual_real_estate_flow_executes() -> Result<()> {
    let pool = dbtest::open().await?;
    let owner = create_owner(&pool, "alex").await?;
    let fixture = super::Fixture {
        pool: pool.clone(),
        owner: owner.clone(),
        plaid_account_id: 0,
        plaid_connection_id: 0,
        rule_id: 0,
        tag_id: 0,
        tagged_transaction_id: 0,
        stock_asset_id: 0,
    };
    let owner_id = global_id(GlobalIdType::Owner, owner.id);

    let (data, errors) = fixture
        .execute_with(
            r#"mutation($owner: ID!) { linkRealEstate(input: { ownerId: $owner, manualValuationUSD: 1450000, street: "123 Main St", city: "Springfield", label: "  Home  " }) {
                valuationUSD connection { id name provider { __typename } } account { id type name }
            } }"#,
            all_scopes(),
            json!({"owner": owner_id}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    let linked = &data["linkRealEstate"];
    assert_eq!(linked["valuationUSD"], 1_450_000);
    assert_eq!(linked["connection"]["provider"], Value::Null);
    assert_eq!(linked["connection"]["name"], "Home");
    assert_eq!(linked["account"]["type"], "PROPERTY");
    let connection_id = linked["connection"]["id"].as_str().unwrap().to_owned();
    let account_id = linked["account"]["id"].as_str().unwrap().to_owned();

    let (data, errors) = fixture
        .execute_with(
            r#"mutation($id: ID!) { updateRealEstate(input: { connectionId: $id, valuationUSD: 1500000, street: "456 Oak Ave" }) { account { id } } }"#,
            all_scopes(),
            json!({"id": connection_id}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["updateRealEstate"]["account"]["id"], account_id);

    let (data, errors) = fixture
        .execute("{ netWorth(input: {}) { currentNetWorthUSD classifierBreakdown { classifier holdings { asset { assetType } } } } }", all_scopes())
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["netWorth"]["currentNetWorthUSD"], 1_500_000);
    assert_eq!(
        data["netWorth"]["classifierBreakdown"][0]["holdings"][0]["asset"]["assetType"],
        "REAL_ESTATE"
    );

    let (_, errors) = fixture
        .execute_with(
            r#"mutation($id: ID!) { updateRealEstate(input: { connectionId: $id, valuationUSD: -1, street: "789 Bad Write Way" }) { account { id } } }"#,
            all_scopes(),
            json!({"id": connection_id}),
        )
        .await?;
    assert_eq!(errors[0].message, "valuationUSD must be positive");
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");
    let local_connection_id = crate::ids::GlobalId::decode(&connection_id)?.i64();
    let real_estate = crate::wealth::store::real_estate_by_connection_id(&pool, local_connection_id)
        .await?
        .unwrap();
    assert_eq!(real_estate.details.street.as_deref(), Some("456 Oak Ave"));

    let (data, errors) = fixture
        .execute_with(
            r#"mutation($id: ID!) { updateAccount(input: { id: $id, name: "Updated Home" }) { account { name } } }"#,
            all_scopes(),
            json!({"id": account_id}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["updateAccount"]["account"]["name"], "Updated Home");
    let asset_name = sqlx::query_scalar::<_, String>("SELECT name FROM assets WHERE id = ?")
        .bind(real_estate.asset_id)
        .fetch_one(&pool)
        .await?;
    let connection_name = sqlx::query_scalar::<_, String>("SELECT name FROM connections WHERE id = ?")
        .bind(local_connection_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(
        (asset_name.as_str(), connection_name.as_str()),
        ("Updated Home", "Updated Home")
    );

    let (data, errors) = fixture
        .execute(
            "{ accounts { items { name type latestSnapshot { balanceUSD netContributionUSD } lastSyncedAt owner { name } connection { id } accountWealthProperty { __typename ... on RealEstateAssetDetails { address { street } } } } } connections(input: { includeInactive: true }) { items { id } } }",
            all_scopes(),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    let home = by_name(&data["accounts"]["items"], "Updated Home");
    assert_eq!(home["type"], "PROPERTY");
    assert_eq!(home["latestSnapshot"]["balanceUSD"], 1_500_000);
    assert_eq!(home["connection"]["id"], connection_id);
    assert_eq!(home["accountWealthProperty"]["address"]["street"], "456 Oak Ave");
    assert_eq!(
        data["connections"]["items"],
        json!([]),
        "asset-backed connections are not listed"
    );

    let (data, errors) = fixture
        .execute_with(
            "mutation($id: ID!) { unlinkRealEstate(id: $id) }",
            all_scopes(),
            json!({"id": connection_id}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["unlinkRealEstate"], true);

    let (_, errors) = fixture
        .execute_with(
            r#"mutation($id: ID!) { updateRealEstate(input: { connectionId: $id, street: "gone" }) { account { id } } }"#,
            all_scopes(),
            json!({"id": connection_id}),
        )
        .await?;
    assert_eq!(
        errors[0].message,
        format!("real estate not found for connection {local_connection_id}")
    );
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");
    Ok(())
}

#[tokio::test]
async fn real_estate_guards_reject_property_accounts_and_type_changes() -> Result<()> {
    let pool = dbtest::open().await?;
    let owner = create_owner(&pool, "alex").await?;
    let fixture = super::Fixture {
        pool,
        owner: owner.clone(),
        plaid_account_id: 0,
        plaid_connection_id: 0,
        rule_id: 0,
        tag_id: 0,
        tagged_transaction_id: 0,
        stock_asset_id: 0,
    };
    let owner_id = global_id(GlobalIdType::Owner, owner.id);
    let create = "mutation($owner: ID!, $type: AccountType!, $name: String!) { createManualAccount(input: { name: $name, type: $type, ownerId: $owner }) { account { id type } } }";

    let (_, errors) = fixture
        .execute_with(
            create,
            all_scopes(),
            json!({"owner": owner_id, "type": "PROPERTY", "name": "My Home"}),
        )
        .await?;
    assert_eq!(
        errors[0].message,
        "real estate accounts must be created via linkRealEstate"
    );
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");

    let (_, errors) = fixture
        .execute_with(
            create,
            all_scopes(),
            json!({"owner": global_id(GlobalIdType::Owner, 999_999), "type": "OTHER", "name": "Ghost"}),
        )
        .await?;
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");
    let (_, errors) = fixture
        .execute_with(
            "mutation($owner: ID!, $connection: ID!) { createManualAccount(input: { name: \"Cash\", type: DEPOSITORY, ownerId: $owner, connectionId: $connection }) { account { id } } }",
            all_scopes(),
            json!({"owner": owner_id, "connection": global_id(GlobalIdType::Connection, 999_999)}),
        )
        .await?;
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");
    assert!(crate::accounts::store::accounts(&fixture.pool).await?.is_empty());

    let (data, errors) = fixture
        .execute_with(
            create,
            all_scopes(),
            json!({"owner": owner_id, "type": "OTHER", "name": "Manual"}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    let manual_id = data["createManualAccount"]["account"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (_, errors) = fixture
        .execute_with(
            "mutation($id: ID!) { updateAccount(input: { id: $id, type: PROPERTY }) { account { id } } }",
            all_scopes(),
            json!({"id": manual_id}),
        )
        .await?;
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");

    let (data, errors) = fixture
        .execute_with(
            "mutation($owner: ID!) { linkRealEstate(input: { ownerId: $owner, manualValuationUSD: 500000 }) { account { id } } }",
            all_scopes(),
            json!({"owner": owner_id}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    let property_id = data["linkRealEstate"]["account"]["id"].as_str().unwrap().to_owned();
    let (_, errors) = fixture
        .execute_with(
            "mutation($id: ID!) { updateAccount(input: { id: $id, type: OTHER }) { account { id } } }",
            all_scopes(),
            json!({"id": property_id}),
        )
        .await?;
    assert_eq!(code(&errors[0]), "BAD_USER_INPUT");

    let (data, errors) = fixture
        .execute_with(
            "mutation($id: ID!) { updateAccount(input: { id: $id, type: CRYPTO_WALLET }) { account { type } } }",
            all_scopes(),
            json!({"id": manual_id}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["updateAccount"]["account"]["type"], "CRYPTO_WALLET");

    let (data, errors) = fixture
        .execute_with(
            create,
            all_scopes(),
            json!({"owner": owner_id, "type": "CRYPTO_WALLET", "name": "My Wallet"}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["createManualAccount"]["account"]["type"], "CRYPTO_WALLET");

    let (_, errors) = fixture
        .execute_with(
            "mutation($owner: ID!) { linkRealEstate(input: { ownerId: $owner, manualValuationUSD: 0 }) { account { id } } }",
            all_scopes(),
            json!({"owner": owner_id}),
        )
        .await?;
    assert_eq!(errors[0].message, "manualValuationUSD must be positive");

    let (data, errors) = fixture
        .execute_with(
            "mutation($id: ID!) { removeManualAccount(input: { id: $id }) { success } }",
            all_scopes(),
            json!({"id": manual_id}),
        )
        .await?;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(data["removeManualAccount"]["success"], true);
    Ok(())
}
