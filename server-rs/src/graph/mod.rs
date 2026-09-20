mod accounts;
mod budgets;
mod categories;
mod configuration;
mod connections;
mod extension;
mod guards;
mod ids;
mod loaders;
mod node;
mod plaid;
mod portfolio;
mod real_estate;
mod reference;
mod roots;
mod rules;
mod simplefin;
mod snapshots;
mod spending;
mod tags;
mod transactions;
mod users;
mod wealth;

use std::sync::Arc;

use async_graphql::{Context, EmptySubscription, Schema, dataloader::Loader};
use sqlx::SqlitePool;

pub use guards::{DynamicScopeGuard, ScopeGuard, require_scope};
pub use loaders::Loaders;
pub use plaid::HydratedPlaidItem;
pub use rules::HydratedRule;

use crate::{
    accounts::{LinkService, SimpleFinService},
    admin,
    apierror::{ApiError, Code, INTERNAL_MESSAGE},
    auth::Scope,
    config::Config,
    schema::{Mutation, Query, SCOPES},
    transactions::Syncer,
    wealth::{ManualSyncAdapter, WealthService},
};

pub type GraphSchema = Schema<Query, Mutation, EmptySubscription>;

pub const MAX_COMPLEXITY: usize = 500;

pub fn build_schema(resolver: Resolver) -> GraphSchema {
    Schema::build(Query, Mutation, EmptySubscription)
        .data(resolver)
        .extension(extension::GraphExtension)
        .limit_complexity(MAX_COMPLEXITY)
        .disable_introspection()
        .finish()
}

/// Go's `graph.OperationScope`: the scope a root field requires, from the generated table.
pub fn operation_scope(type_name: &str, field_name: &str) -> Result<Scope, ApiError> {
    SCOPES
        .iter()
        .find_map(|(typ, field, scope)| (*typ == type_name && *field == field_name).then_some(*scope))
        .and_then(|scope| scope.parse().ok())
        .ok_or_else(|| {
            tracing::error!(type_name, field_name, "schema field has no parseable @requiresScope");
            ApiError::new(INTERNAL_MESSAGE, Code::Internal)
        })
}

#[derive(Clone)]
pub struct Resolver {
    pub pool: SqlitePool,
    pub wealth: Arc<WealthService>,
    pub linker: Arc<LinkService>,
    pub simplefin: Arc<SimpleFinService>,
    pub admin: Arc<admin::Service>,
    pub syncer: Arc<Syncer>,
    pub manual_snapshots: Arc<ManualSyncAdapter>,
    pub config: Arc<Config>,
}

async fn load<K>(ctx: &Context<'_>, key: K) -> async_graphql::Result<Option<<Resolver as Loader<K>>::Value>>
where
    K: Send + Sync + std::hash::Hash + Eq + Clone + 'static,
    Resolver: Loader<K, Error = async_graphql::Error>,
{
    ctx.data::<Loaders>()?.load_one(key).await
}

#[cfg(test)]
mod tests;
