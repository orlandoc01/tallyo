use std::collections::{HashMap, HashSet};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use crate::{
    accounts::{
        SimpleFinAccessTokenSecret, SimpleFinTokenSecretKind, SourceTable, new_upsert_simple_fin_connection_params,
        simplefin_types::fields_from_simplefin_account,
        store::{
            hidden_account_ids_by_connection, link_simple_fin_connection, set_simple_fin_connection_health,
            set_simple_fin_token_synced, simple_fin_connection_ids_by_external_id, simple_fin_token_secret_by_conn_id,
            simple_fin_token_secrets_due,
        },
    },
    clients::simplefin::{GetAccountsOpts, SimpleFinAccountSet, SimpleFinClient},
    transactions::{
        AccountDraft, ItemCounts, ItemReport, RemovedTransaction, SyncReport, TransactionSource, store::simplefin_sync,
    },
    utils::cron::next_after,
};

use super::{
    PersistEvent, SyncAdapter,
    persister::Persister,
    simplefin_helpers::{log_fetch_error, log_sync, start_date, transaction_from_simple_fin},
};

pub struct SimpleFinSync {
    pool: SqlitePool,
    client: SimpleFinClient,
}

impl SimpleFinSync {
    pub fn new(pool: SqlitePool, client: SimpleFinClient) -> Self {
        Self { pool, client }
    }

    async fn sync_due(&self, sink: &Persister) -> SyncReport {
        match simple_fin_token_secrets_due(&self.pool, SimpleFinTokenSecretKind::Sync, Utc::now()).await {
            Ok(tokens) => {
                let mut items = Vec::with_capacity(tokens.len());
                for token in tokens {
                    items.push(self.sync(token, sink).await);
                }
                SyncReport { items }
            }
            Err(error) => SyncReport {
                items: vec![ItemReport::failure(ItemCounts::default(), error)],
            },
        }
    }

    async fn sync_connection_into(&self, connection_id: i64, sink: &Persister) -> ItemReport {
        match simple_fin_token_secret_by_conn_id(&self.pool, connection_id).await {
            Ok(Some(token)) => self.sync(token, sink).await,
            Ok(None) => ItemReport::failure(
                ItemCounts::default(),
                anyhow::anyhow!("simplefin token for connection {connection_id} not found"),
            ),
            Err(error) => ItemReport::failure(ItemCounts::default(), error),
        }
    }

    async fn sync(&self, token: SimpleFinAccessTokenSecret, sink: &Persister) -> ItemReport {
        match self.sync_inner(token, sink).await {
            Ok(counts) => ItemReport::success(counts),
            Err(error) => ItemReport::failure(ItemCounts::default(), error),
        }
    }

    async fn sync_inner(&self, token: SimpleFinAccessTokenSecret, sink: &Persister) -> Result<ItemCounts> {
        let now = Utc::now();
        let start_date = start_date(token.last_synced_at.map(Into::into), now);
        let account_set = match self
            .client
            .get_accounts(
                &token.access_url,
                GetAccountsOpts {
                    start_date: Some(start_date),
                    pending: true,
                },
            )
            .await
        {
            Ok(account_set) => account_set,
            Err(error) => {
                log_fetch_error(&self.pool, token.id, start_date, &error).await;
                return Err(error);
            }
        };
        let connections = self.link_connections(&token, &account_set).await?;
        self.set_connection_health(&token, &account_set, &connections, now)
            .await;
        let partial = !account_set.errors.is_empty();
        let pending = simplefin_sync::pending_simple_fin_transaction_ids(&self.pool, token.id)
            .await?
            .into_iter()
            .collect::<HashSet<_>>();
        let SyncPage {
            events,
            fetched_ids,
            removed_ids,
        } = self
            .page(
                account_set,
                SyncPageContext {
                    token: &token,
                    connections,
                    pending,
                    partial,
                },
            )
            .await?;
        let counts = match sink.persist(events).await {
            Ok(counts) => counts,
            Err(error) => {
                self.log_sync(token.id, start_date, &fetched_ids, &removed_ids, Some(&error))
                    .await;
                return Err(error);
            }
        };
        if partial {
            return Ok(counts);
        }
        let next_sync_at = next_after(&token.sync_cron, now)?;
        set_simple_fin_token_synced(&self.pool, token.id, now, next_sync_at).await?;
        self.log_sync(token.id, start_date, &fetched_ids, &removed_ids, None)
            .await;
        Ok(counts)
    }

    async fn link_connections(
        &self,
        token: &SimpleFinAccessTokenSecret,
        account_set: &SimpleFinAccountSet,
    ) -> Result<HashMap<String, (i64, i64)>> {
        let mut connections = HashMap::with_capacity(account_set.connections.len());
        for connection in &account_set.connections {
            let params = new_upsert_simple_fin_connection_params(token.id, token.owner_id, connection);
            let (simple_fin_connection_id, connection_id) = link_simple_fin_connection(&self.pool, &params)
                .await
                .with_context(|| format!("link simplefin connection {}", connection.conn_id))?;
            connections.insert(connection.conn_id.clone(), (simple_fin_connection_id, connection_id));
        }
        Ok(connections)
    }

    async fn set_connection_health(
        &self,
        token: &SimpleFinAccessTokenSecret,
        account_set: &SimpleFinAccountSet,
        connections: &HashMap<String, (i64, i64)>,
        now: DateTime<Utc>,
    ) {
        for connection in &account_set.connections {
            let Some((connection_id, _)) = connections.get(&connection.conn_id) else {
                continue;
            };
            if let Err(error) = set_simple_fin_connection_health(&self.pool, *connection_id, "HEALTHY", None, now).await
            {
                tracing::warn!(token_id = token.id, connection_id, %error, "set simplefin connection health");
            }
        }
        let unresolved = account_set
            .errors
            .iter()
            .filter(|error| !connections.contains_key(&error.conn_id))
            .map(|error| error.conn_id.clone())
            .collect::<Vec<_>>();
        let resolved = match simple_fin_connection_ids_by_external_id(&self.pool, token.id, &unresolved).await {
            Ok(resolved) => resolved,
            Err(error) => {
                tracing::warn!(token_id = token.id, %error, "resolve simplefin error connections");
                HashMap::new()
            }
        };
        for error in &account_set.errors {
            let connection_id = connections
                .get(&error.conn_id)
                .map(|(connection_id, _)| *connection_id)
                .or_else(|| resolved.get(&error.conn_id).copied());
            let Some(connection_id) = connection_id else {
                continue;
            };
            if let Err(error) =
                set_simple_fin_connection_health(&self.pool, connection_id, "SYNC_ERROR", Some(&error.message), now)
                    .await
            {
                tracing::warn!(token_id = token.id, connection_id, %error, "set simplefin connection health");
            }
        }
    }

    async fn page(&self, account_set: SimpleFinAccountSet, context: SyncPageContext<'_>) -> Result<SyncPage> {
        let SyncPageContext {
            token,
            connections,
            pending,
            partial,
        } = context;
        let mut hidden_by_connection = HashMap::<i64, HashSet<String>>::new();
        let mut events = Vec::new();
        let mut fetched_ids = HashSet::new();
        for account in account_set.accounts {
            let Some((_, connection_id)) = connections.get(&account.conn_id) else {
                continue;
            };
            let fields = fields_from_simplefin_account(&account);
            events.push(PersistEvent::AccountUpsert(AccountDraft {
                external_id: fields.id,
                connection_id: *connection_id,
                owner_id: token.owner_id,
                name: fields.name,
                account_type: fields.account_type,
                subtype: None,
                mask: fields.mask,
                needs_review: fields.needs_review,
            }));
            if !hidden_by_connection.contains_key(connection_id) {
                let hidden = hidden_account_ids_by_connection(&self.pool, *connection_id).await?;
                hidden_by_connection.insert(*connection_id, hidden);
            }
            let hidden = hidden_by_connection
                .get(connection_id)
                .expect("inserted hidden accounts");
            for transaction in account.transactions {
                fetched_ids.insert(transaction.id.clone());
                events.push(PersistEvent::Upsert(transaction_from_simple_fin(
                    &account.id,
                    transaction,
                    hidden.contains(&account.id),
                )?));
            }
        }
        let removed_ids = if partial { Vec::new() } else { pending.difference(&fetched_ids).cloned().collect() };
        events.extend(removed_ids.iter().cloned().map(|external_id| {
            PersistEvent::Removal(RemovedTransaction {
                external_id,
                source: TransactionSource::Simplefin,
            })
        }));
        Ok(SyncPage {
            events,
            fetched_ids: fetched_ids.into_iter().collect(),
            removed_ids,
        })
    }

    async fn log_sync(
        &self,
        token_id: i64,
        start_date: DateTime<Utc>,
        fetched_ids: &[String],
        removed_ids: &[String],
        error: Option<&anyhow::Error>,
    ) {
        if let Err(log_error) = log_sync(&self.pool, token_id, start_date, fetched_ids, removed_ids, error).await {
            tracing::warn!(token_id, %log_error, "log simplefin sync");
        }
    }
}

impl SyncAdapter for SimpleFinSync {
    fn handles(&self, provider: SourceTable) -> bool {
        provider == SourceTable::SimpleFinConnections
    }

    fn sync_due<'a>(&'a self, sink: &'a Persister) -> crate::utils::future::BoxFuture<'a, SyncReport> {
        Box::pin(async move { self.sync_due(sink).await })
    }

    fn sync_connection_into<'a>(
        &'a self,
        source_id: i64,
        sink: &'a Persister,
    ) -> crate::utils::future::BoxFuture<'a, ItemReport> {
        Box::pin(async move { self.sync_connection_into(source_id, sink).await })
    }
}

struct SyncPage {
    events: Vec<PersistEvent>,
    fetched_ids: Vec<String>,
    removed_ids: Vec<String>,
}

struct SyncPageContext<'a> {
    token: &'a SimpleFinAccessTokenSecret,
    connections: HashMap<String, (i64, i64)>,
    pending: HashSet<String>,
    partial: bool,
}
