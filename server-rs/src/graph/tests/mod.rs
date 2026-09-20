mod admin;
mod budgets;
mod configuration;
mod fields;
mod node;
mod presenter;
mod real_estate;
mod transactions;
mod wealth;

use std::{path::PathBuf, sync::Arc};

use anyhow::Result;
use async_graphql::{PathSegment, Request, ServerError, Variables};
use serde_json::{Value, json};
use sqlx::SqlitePool;

use super::{GraphSchema, Resolver, build_schema, loaders::BATCHES};
use crate::{
    accounts::{
        EventBus, LinkService, Owner, PlaidClientFactory, SimpleFinService, UpsertAccount,
        simplefin_types::UpsertSimpleFinConnectionParams, store as accounts_store,
    },
    admin::{Manager, Service as AdminService},
    auth::{ALL_SCOPES, Identity, Scope},
    clients::simplefin::SimpleFinClient,
    config::{Authorization, Config},
    database::dbtest,
    ids::{GlobalId, GlobalIdType},
    money::Cents,
    schema::{CreateRuleInput, TransactionUpdates},
    testutil::{
        store::{
            create_owner, linked_account, seed_evm_wallet, seed_manual_account, seed_plaid_account, seed_plaid_item,
        },
        transactions::transaction,
    },
    transactions::{Syncer, store as transactions_store},
    wealth::{
        AccountBalanceSnapshot, AssetDailyHolding, CreateRealEstate, ManualSyncAdapter, RealEstateDetails,
        RealEstateValuation, SyncerId, WealthService, store as wealth_store,
    },
};

pub(super) struct Fixture {
    pub(super) pool: SqlitePool,
    pub(super) owner: Owner,
    pub(super) plaid_account_id: i64,
    pub(super) plaid_connection_id: i64,
    pub(super) rule_id: i64,
    pub(super) tag_id: i64,
    pub(super) tagged_transaction_id: i64,
    pub(super) stock_asset_id: i64,
}

/// Owner, Plaid/manual/EVM/real-estate/SimpleFIN accounts, a held security, a tagged rule and
/// transaction: the Phase 5a scenario world every root query can be exercised against.
pub(super) async fn seed() -> Result<Fixture> {
    let pool = dbtest::open().await?;
    let owner = create_owner(&pool, "Alex").await?;
    let (_, plaid_connection) = seed_plaid_item(&pool, &owner, "item").await?;
    let plaid_account_id = seed_plaid_account(&pool, &owner, &plaid_connection, "checking").await?;
    seed_manual_account(&pool, &owner, "Cash").await?;
    seed_evm_wallet(&pool, &owner, "0x1111111111111111111111111111111111111111").await?;
    let now = "2026-01-02T12:00:00Z".parse()?;
    wealth_store::create_real_estate(
        &pool,
        CreateRealEstate {
            owner_id: owner.id,
            label: "Home".to_owned(),
            details: RealEstateDetails {
                street: Some("1 Main".to_owned()),
                city: Some("Austin".to_owned()),
                ..RealEstateDetails::default()
            },
            initial_valuation: Some(RealEstateValuation {
                value_usd: Cents(5_000_000),
                date: "2026-01-02".to_owned(),
                synced_at: now,
                source: SyncerId::Realestate,
            }),
        },
    )
    .await?;
    let token =
        accounts_store::create_simple_fin_access_token(&pool, "https://bridge.example", owner.id, "Bridge").await?;
    let (_, simplefin_connection_id) = accounts_store::link_simple_fin_connection(
        &pool,
        &UpsertSimpleFinConnectionParams {
            external_id: "bank".to_owned(),
            access_token_id: token.id,
            org_id: None,
            org_domain: Some("bank.example".to_owned()),
            org_url: None,
            sfin_url: None,
            logo_url: None,
            name: "Bank".to_owned(),
            owner_id: owner.id,
        },
    )
    .await?;
    accounts_store::upsert_account(
        &pool,
        &UpsertAccount {
            name: "Bank savings".to_owned(),
            ..linked_account(&owner, simplefin_connection_id, "savings")
        },
    )
    .await?;

    let stock_asset_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO assets (asset_type, identifier, classifier) VALUES ('SECURITY', 'VTI', 'PUBLIC') RETURNING id",
    )
    .fetch_one(&pool)
    .await?;
    sqlx::query("INSERT INTO asset_adapter_sources (asset_id, source_adapter, source_id) VALUES (?, 'plaid', 'sec-1')")
        .bind(stock_asset_id)
        .execute(&pool)
        .await?;
    seed_snapshot(&pool, plaid_account_id, stock_asset_id, "2026-01-02", 120.0).await?;
    sqlx::query(
        "INSERT INTO account_sync_state (account_id, last_balance_synced_at) VALUES (?, '2026-01-02T12:00:00Z')",
    )
    .bind(plaid_account_id)
    .execute(&pool)
    .await?;

    let tag = transactions_store::create_tag(&pool, "Household", "#AABBCC").await?;
    let tag_global_id = global_id(GlobalIdType::Tag, tag.id);
    let (rule, _) = transactions_store::create_rule(
        &pool,
        CreateRuleInput {
            merchant_pattern: Some("coffee".to_owned()),
            original_pattern: None,
            changes: TransactionUpdates {
                tag_ids: Some(vec![tag_global_id.clone()]),
                ..updates()
            },
            account_ids: Some(vec![global_id(GlobalIdType::Account, plaid_account_id)]),
            amount_min: None,
            amount_max: None,
            priority: None,
            apply_retroactively: None,
        },
    )
    .await?;
    let tagged_transaction_id = transaction(&pool, "coffee", plaid_account_id, 0, Cents(250), now).await?;
    transactions_store::update_transaction(
        &pool,
        tagged_transaction_id,
        &TransactionUpdates {
            tag_ids: Some(vec![tag_global_id]),
            ..updates()
        },
    )
    .await?;
    Ok(Fixture {
        pool,
        owner,
        plaid_account_id,
        plaid_connection_id: plaid_connection.id,
        rule_id: rule.id,
        tag_id: tag.id,
        tagged_transaction_id,
        stock_asset_id,
    })
}

pub(super) async fn seed_snapshot(
    pool: &SqlitePool,
    account_id: i64,
    asset_id: i64,
    date: &str,
    balance: f64,
) -> Result<()> {
    wealth_store::replace_account_balance_snapshot(
        pool,
        AccountBalanceSnapshot {
            account_id,
            wallet_address: String::new(),
            source: "plaid".to_owned(),
            date: date.to_owned(),
            synced_at: format!("{date}T12:00:00Z"),
            balance_usd: Cents::from_dollars(balance),
            raw_payload: None,
            holdings: vec![AssetDailyHolding {
                asset_id,
                asset: None,
                adapter_source: None,
                adapter_sources: Vec::new(),
                price_update: None,
                quantity: Some(2.0),
                price: Some(balance / 2.0),
                value_usd: balance,
                counts_toward_value: true,
                manual: false,
                line_type: String::new(),
                chain_id: String::new(),
                project_name: None,
                token_id: String::new(),
                identifier: String::new(),
                token_symbol: None,
                token_name: None,
                provider_price: None,
            }],
            flagged: false,
            flag_reason: String::new(),
        },
    )
    .await?;
    Ok(())
}

pub(super) fn updates() -> TransactionUpdates {
    TransactionUpdates {
        merchant_name: None,
        notes: None,
        is_recurring: None,
        is_hidden: None,
        category_id: None,
        tag_ids: None,
    }
}

impl Fixture {
    pub(super) fn resolver(&self) -> Resolver {
        resolver(self.pool.clone())
    }

    pub(super) fn schema(&self) -> GraphSchema {
        build_schema(self.resolver())
    }

    pub(super) async fn execute(&self, query: &str, scopes: Vec<Scope>) -> Result<(Value, Vec<ServerError>)> {
        self.execute_with(query, scopes, json!({})).await
    }

    pub(super) async fn execute_with(
        &self,
        query: &str,
        scopes: Vec<Scope>,
        variables: Value,
    ) -> Result<(Value, Vec<ServerError>)> {
        let response = self
            .schema()
            .execute(request(query, scopes).variables(Variables::from_json(variables)))
            .await;
        Ok((response.data.into_json()?, response.errors))
    }
}

pub(super) fn request(query: &str, scopes: Vec<Scope>) -> Request {
    Request::new(query.to_owned()).data(Identity::with_scopes(scopes))
}

pub(super) fn all_scopes() -> Vec<Scope> {
    ALL_SCOPES.to_vec()
}

pub(super) fn resolver(pool: SqlitePool) -> Resolver {
    let events = EventBus::default();
    let syncer = Arc::new(Syncer::new(pool.clone(), Vec::new()));
    let manager = Arc::new(Manager::new(pool.clone()));
    Resolver {
        wealth: Arc::new(WealthService::new(pool.clone(), None, || "UTC".to_owned())),
        linker: Arc::new(LinkService {
            pool: pool.clone(),
            clients: Arc::new(PlaidClientFactory::new(pool.clone())),
            syncer: syncer.clone(),
            events: events.clone(),
        }),
        simplefin: Arc::new(SimpleFinService {
            pool: pool.clone(),
            client: SimpleFinClient::new().unwrap(),
            events,
        }),
        admin: Arc::new(AdminService::new(pool.clone(), manager)),
        syncer,
        manual_snapshots: Arc::new(ManualSyncAdapter::new(pool.clone()).unwrap()),
        config: Arc::new(Config {
            config_file_path: None,
            db_path: PathBuf::from("/tmp/tallyo.db"),
            db_encryption_key: None,
            port: 8080,
            sync_off: false,
            authorization: Authorization {
                disable_all_auth: false,
                master_password: None,
            },
        }),
        pool,
    }
}

pub(super) fn global_id(typ: GlobalIdType, id: i64) -> async_graphql::ID {
    GlobalId::new(typ, id).encoded_string().into()
}

pub(super) fn path(error: &ServerError) -> String {
    error
        .path
        .iter()
        .map(|segment| match segment {
            PathSegment::Field(field) => field.clone(),
            PathSegment::Index(index) => index.to_string(),
        })
        .collect::<Vec<_>>()
        .join(".")
}

pub(super) fn code(error: &ServerError) -> String {
    error
        .extensions
        .as_ref()
        .and_then(|extensions| extensions.get("code"))
        .map(|code| code.to_string().trim_matches('"').to_owned())
        .unwrap_or_default()
}

pub(super) fn by_name<'a>(items: &'a Value, name: &str) -> &'a Value {
    items
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["name"] == name)
        .unwrap_or_else(|| panic!("no item named {name}: {items}"))
}

pub(super) async fn record_batches<T>(future: impl Future<Output = T>) -> (T, Vec<&'static str>) {
    BATCHES.with(|batches| batches.borrow_mut().clear());
    let output = future.await;
    (output, BATCHES.with(|batches| batches.borrow().clone()))
}
