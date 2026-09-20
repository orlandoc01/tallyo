use std::collections::HashMap;

use anyhow::Result;
use sqlx::SqlitePool;

use crate::{
    accounts::{
        AccountsCreated, CreateSimpleFinAccessTokenPayload, EventBus, SimpleFinAccessToken, UpsertAccount,
        simplefin_types::{fields_from_simplefin_account, new_upsert_simple_fin_connection_params},
    },
    apierror::ApiError,
    clients::simplefin::{GetAccountsOpts, SimpleFinClient},
};

use super::store::{
    create_simple_fin_access_token, delete_simple_fin_access_token, owner_by_id, reset_simple_fin_token_synced_at,
    simple_fin_access_token_by_id, simple_fin_connections_by_token_ids, upsert_account,
};

pub struct SimpleFinService {
    pub pool: SqlitePool,
    pub client: SimpleFinClient,
    pub events: EventBus,
}

impl SimpleFinService {
    pub async fn create_access_token(
        &self,
        setup_token: &str,
        owner_id: i64,
        label: &str,
    ) -> Result<CreateSimpleFinAccessTokenPayload> {
        let owner = owner_by_id(&self.pool, owner_id)
            .await?
            .ok_or_else(|| ApiError::bad_input(format!("invalid owner id {owner_id}")))?;
        let access_url = self.client.claim(setup_token).await?;
        let token = create_simple_fin_access_token(&self.pool, &access_url, owner_id, label).await?;
        let account_set = match self
            .client
            .get_accounts(
                &access_url,
                GetAccountsOpts {
                    pending: true,
                    ..Default::default()
                },
            )
            .await
        {
            Ok(account_set) => account_set,
            Err(error) => {
                tracing::warn!(%error, "initial simplefin fetch failed; token saved but no accounts yet");
                return Ok(CreateSimpleFinAccessTokenPayload {
                    access_token: token,
                    connections: Vec::new(),
                    accounts: Vec::new(),
                });
            }
        };
        let mut connections_by_external_id = HashMap::with_capacity(account_set.connections.len());
        for connection in &account_set.connections {
            let params = new_upsert_simple_fin_connection_params(token.id, owner_id, connection);
            let (simple_fin_connection_id, connection_id) =
                super::store::link_simple_fin_connection(&self.pool, &params).await?;
            connections_by_external_id.insert(connection.conn_id.clone(), (simple_fin_connection_id, connection_id));
        }
        for simple_fin_account in &account_set.accounts {
            let Some((_, connection_id)) = connections_by_external_id.get(&simple_fin_account.conn_id) else {
                tracing::warn!(
                    conn_id = simple_fin_account.conn_id,
                    "skipping simplefin account: connection not found"
                );
                continue;
            };
            let fields = fields_from_simplefin_account(simple_fin_account);
            upsert_account(
                &self.pool,
                &UpsertAccount {
                    external_id: fields.id,
                    connection_id: Some(*connection_id),
                    owner_id: owner.id,
                    name: fields.name,
                    account_type: fields.account_type,
                    subtype: None,
                    mask: fields.mask,
                    notes: None,
                    closed: false,
                    hidden: false,
                    needs_review: fields.needs_review,
                },
            )
            .await?;
        }
        let connections = simple_fin_connections_by_token_ids(&self.pool, &[token.id]).await?;
        let connections = connections.get(&token.id).cloned().unwrap_or_default();
        if let Some(connection) = connections.first() {
            self.events.publish(AccountsCreated {
                connection_id: connection.connection_id,
                provider: crate::accounts::SourceTable::SimpleFinConnections,
                source_id: connection.connection.id,
            });
        }
        let connections = connections
            .into_iter()
            .map(|record| record.connection)
            .collect::<Vec<_>>();
        let accounts = connections
            .iter()
            .flat_map(|connection| connection.accounts.clone())
            .collect();
        Ok(CreateSimpleFinAccessTokenPayload {
            access_token: token,
            connections,
            accounts,
        })
    }

    pub async fn delete_access_token(&self, id: i64) -> Result<()> {
        delete_simple_fin_access_token(&self.pool, id).await
    }

    pub async fn reset_sync(&self, id: i64) -> Result<Option<SimpleFinAccessToken>> {
        reset_simple_fin_token_synced_at(&self.pool, id).await?;
        simple_fin_access_token_by_id(&self.pool, id).await
    }
}

#[cfg(test)]
mod tests {

    use anyhow::Result;
    use serde_json::json;
    use wiremock::MockServer;

    use crate::{
        accounts::{EventBus, SimpleFinService},
        clients::simplefin::SimpleFinClient,
        database::dbtest,
        testutil::{simplefin_mock, store::create_owner},
    };

    #[tokio::test]
    async fn claims_a_token_and_links_simplefin_accounts() -> Result<()> {
        let server = MockServer::start().await;
        let access_url = simplefin_mock::access_url(&server);
        simplefin_mock::mount_claim(&server, &access_url).await;
        simplefin_mock::mount_accounts(
            &server,
            json!({
                "connections":[{"conn_id":"bank","name":"Bank","org_url":"https://bank.example"}],
                "accounts":[
                    {"id":"unknown","conn_id":"bank","name":"Mystery"},
                    {"id":"checking","conn_id":"bank","name":"Joint Checking"}
                ]
            }),
        )
        .await;
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "alex").await?;
        let events = EventBus::default();
        let mut subscriber = events.register_subscriber("test");
        let service = SimpleFinService {
            pool,
            client: SimpleFinClient::new()?,
            events,
        };
        let payload = service
            .create_access_token(&simplefin_mock::setup_token(&server), owner.id, "Bridge")
            .await?;
        assert_eq!(payload.connections.len(), 1);
        assert_eq!(payload.accounts.len(), 2);
        assert!(
            payload
                .accounts
                .iter()
                .any(|account| account.name == "Mystery" && account.needs_review)
        );
        assert_eq!(
            subscriber.recv().await.unwrap().provider,
            crate::accounts::SourceTable::SimpleFinConnections
        );
        service.reset_sync(payload.access_token.id).await?;
        service.delete_access_token(payload.access_token.id).await?;
        Ok(())
    }
}
