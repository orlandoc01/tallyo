use std::sync::Arc;

use tokio::sync::mpsc::Receiver;
use tokio_util::sync::CancellationToken;

use crate::{
    accounts::AccountsCreated,
    wealth::{ConnectionRef, SnapshotPersister},
};

use super::Syncer;

impl Syncer {
    pub async fn run_account_events(
        self: Arc<Self>,
        mut receiver: Receiver<AccountsCreated>,
        cancel: CancellationToken,
    ) {
        loop {
            let event = tokio::select! {
                _ = cancel.cancelled() => break,
                event = receiver.recv() => event,
            };
            let Some(event) = event else {
                break;
            };
            self.sync_account_created(event).await;
        }
    }

    pub(super) async fn sync_account_created(&self, event: AccountsCreated) {
        if self.tracking_disabled() {
            return;
        }
        let connection = ConnectionRef {
            connection_id: event.connection_id,
            source_table: event.provider,
            source_id: event.source_id,
        };
        let sink = SnapshotPersister::new(self.pool.clone());
        let Some(adapter) = self.adapters.iter().find(|adapter| adapter.handles(&connection)) else {
            tracing::warn!(provider = %event.provider, connection_id = event.connection_id, source_id = event.source_id, "no balance sync adapter for account event");
            return;
        };
        match adapter.sync_connection_into(connection, &sink).await {
            Ok(()) => self.sweep().await,
            Err(error) => {
                tracing::error!(source = %adapter.source(), %error, "balance sync account event failed");
            }
        }
    }
}
