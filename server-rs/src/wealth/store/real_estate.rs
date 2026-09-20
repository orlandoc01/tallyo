use anyhow::{Context, Result, anyhow};
use rand::RngCore;
use sqlx::{Executor, Sqlite, SqlitePool};

use crate::{
    accounts::{
        Account, AccountType, ConnectionRecord, SourceTable,
        store::{account_by_id, connection_by_id, owner_by_id},
    },
    database::{self, queries},
    wealth::{CreateRealEstate, RealEstate, RealEstateDetails, UpdateRealEstate},
};

use super::{
    asset_additional::{RealEstateAdditional, merge_additional, real_estate_additional},
    assets::asset_additional_by_id,
    snapshots::persist_snapshot_in_transaction,
};

pub async fn create_real_estate(pool: &SqlitePool, input: CreateRealEstate) -> Result<(ConnectionRecord, Account)> {
    if owner_by_id(pool, input.owner_id)
        .await
        .context("lookup owner")?
        .is_none()
    {
        return Err(anyhow!("unknown owner id {}", input.owner_id));
    }
    let name = default_name(&input.label, &input.details);
    let external_id = random_id();
    let additional = details_json(&input.details)?;
    let (connection_id, account_id) = database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let asset_id = queries::insert_real_estate_asset(
                &mut **transaction,
                queries::InsertRealEstateAssetParams {
                    identifier: &external_id,
                    name: Some(&name),
                    additional: additional.as_deref(),
                },
            )
            .await
            .context("insert real estate asset")?
            .id;
            let connection_id = queries::upsert_connection(
                &mut **transaction,
                queries::UpsertConnectionParams {
                    source_table: &SourceTable::Assets.to_string(),
                    source_id: asset_id,
                    name: Some(&name),
                    owner_id: input.owner_id,
                },
            )
            .await
            .context("insert real estate connection")?
            .id;
            let account_id = queries::insert_linked_account(
                &mut **transaction,
                queries::InsertLinkedAccountParams {
                    external_id: &external_id,
                    connection_id: Some(connection_id),
                    owner_id: input.owner_id,
                    name: &name,
                    r#type: &AccountType::Property.to_string(),
                },
            )
            .await
            .context("insert real estate account")?
            .id;
            if let Some(valuation) = input.initial_valuation {
                persist_snapshot_in_transaction(
                    transaction,
                    valuation.persist(&RealEstate {
                        asset_id,
                        account_id,
                        connection_id,
                        owner_id: input.owner_id,
                        name: name.clone(),
                        details: input.details,
                    }),
                )
                .await
                .context("persist real estate valuation")?;
            }
            Ok((connection_id, account_id))
        })
    })
    .await?;
    let connection = connection_by_id(pool, connection_id)
        .await?
        .ok_or_else(|| anyhow!("connection {connection_id} not found"))?;
    let account = account_by_id(pool, account_id)
        .await?
        .ok_or_else(|| anyhow!("account {account_id} not found"))?;
    Ok((connection, account))
}

pub async fn update_real_estate(pool: &SqlitePool, input: UpdateRealEstate) -> Result<i64> {
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let real_estate = real_estate_by_connection_id(&mut **transaction, input.connection_id)
                .await?
                .ok_or_else(|| anyhow!("real estate for connection {} not found", input.connection_id))?;
            update_details(transaction, &real_estate, input.name.as_deref(), &input.details).await?;
            if let Some(valuation) = input.valuation {
                persist_snapshot_in_transaction(transaction, valuation.persist(&real_estate))
                    .await
                    .context("persist real estate valuation")?;
            }
            Ok(real_estate.account_id)
        })
    })
    .await
}

pub async fn real_estate_by_connection_id(
    executor: impl Executor<'_, Database = Sqlite>,
    connection_id: i64,
) -> Result<Option<RealEstate>> {
    queries::active_real_estate(
        executor,
        queries::ActiveRealEstateParams {
            connection_id: Some(connection_id),
            ..Default::default()
        },
    )
    .await?
    .into_iter()
    .next()
    .map(real_estate_from_row)
    .transpose()
}

pub async fn active_real_estate(executor: impl Executor<'_, Database = Sqlite>) -> Result<Vec<RealEstate>> {
    queries::active_real_estate(
        executor,
        queries::ActiveRealEstateParams {
            open_only: true,
            ..Default::default()
        },
    )
    .await?
    .into_iter()
    .map(real_estate_from_row)
    .collect()
}

pub async fn delete_real_estate(pool: &SqlitePool, connection_id: i64) -> Result<()> {
    database::with_tx(pool, |transaction| {
        Box::pin(async move {
            let real_estate = real_estate_by_connection_id(&mut **transaction, connection_id)
                .await?
                .ok_or_else(|| anyhow!("real estate for connection {connection_id} not found"))?;
            queries::delete_accounts_by_connection(
                &mut **transaction,
                queries::DeleteAccountsByConnectionParams {
                    connection_id: Some(connection_id),
                },
            )
            .await
            .context("delete real estate accounts")?;
            queries::delete_connection_by_id(
                &mut **transaction,
                queries::DeleteConnectionByIdParams { id: connection_id },
            )
            .await
            .context("delete real estate connection")?;
            queries::delete_asset_by_id(
                &mut **transaction,
                queries::DeleteAssetByIdParams {
                    id: real_estate.asset_id,
                },
            )
            .await
            .context("delete real estate asset")
        })
    })
    .await
}

async fn update_details(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    real_estate: &RealEstate,
    name: Option<&str>,
    details: &RealEstateDetails,
) -> Result<()> {
    if let Some(name) = name {
        queries::update_asset_base(
            &mut **transaction,
            queries::UpdateAssetBaseParams {
                name: Some(name),
                id: real_estate.asset_id,
                ..Default::default()
            },
        )
        .await
        .context("update real estate asset name")?;
        queries::update_account_fields(
            &mut **transaction,
            queries::UpdateAccountFieldsParams {
                set_name: true,
                name,
                id: real_estate.account_id,
                ..Default::default()
            },
        )
        .await
        .context("update real estate account name")?;
        queries::upsert_connection(
            &mut **transaction,
            queries::UpsertConnectionParams {
                source_table: &SourceTable::Assets.to_string(),
                source_id: real_estate.asset_id,
                name: Some(name),
                owner_id: real_estate.owner_id,
            },
        )
        .await
        .context("update real estate connection name")?;
    }
    let Some(incoming) = details_json(details)? else {
        return Ok(());
    };
    let current = asset_additional_by_id(&mut **transaction, real_estate.asset_id).await?;
    let merged = merge_additional(
        crate::schema::AssetType::RealEstate,
        current.as_deref(),
        Some(&incoming),
    )?;
    queries::update_asset_additional(
        &mut **transaction,
        queries::UpdateAssetAdditionalParams {
            additional: merged.as_deref(),
            id: real_estate.asset_id,
        },
    )
    .await
    .context("update real estate additional")
}

fn real_estate_from_row(row: queries::ActiveRealEstateRow) -> Result<RealEstate> {
    let details = row
        .additional
        .filter(|additional| !additional.is_empty())
        .map(|additional| serde_json::from_str::<RealEstateAdditional>(&additional))
        .transpose()
        .context("decode real estate additional")?
        .unwrap_or_default();
    Ok(RealEstate {
        asset_id: row.asset_id,
        account_id: row.account_id,
        connection_id: row.connection_id,
        owner_id: row.owner_id,
        name: row.name,
        details: RealEstateDetails {
            street: details.street,
            city: details.city,
            state: details.state,
            zip: details.zip,
            home_type: details.home_type,
        },
    })
}

fn default_name(label: &str, details: &RealEstateDetails) -> String {
    if label.is_empty() {
        details
            .street
            .as_deref()
            .filter(|street| !street.is_empty())
            .unwrap_or("Home")
            .to_owned()
    } else {
        label.to_owned()
    }
}

fn details_json(details: &RealEstateDetails) -> Result<Option<String>> {
    let json = serde_json::to_string(&real_estate_additional(details))?;
    Ok((json != "{}").then_some(json))
}

fn random_id() -> String {
    let mut bytes = [0_u8; 16];
    rand::rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}
