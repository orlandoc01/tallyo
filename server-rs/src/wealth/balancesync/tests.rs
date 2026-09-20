use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use anyhow::Result;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::{PortfolioSyncer, Syncer};
use crate::{
    accounts::{AccountsCreated, SourceTable},
    utils::future::BoxFuture,
    wealth::{ConnectionRef, PersistSink, SyncAdapter, SyncerId},
};

struct Adapter {
    handles: bool,
    due_calls: AtomicUsize,
    event_calls: AtomicUsize,
}

impl SyncAdapter for Adapter {
    fn source(&self) -> SyncerId {
        SyncerId::Manual
    }
    fn handles(&self, _: &ConnectionRef) -> bool {
        self.handles
    }
    fn sync_due<'a>(&'a self, _: Arc<dyn PersistSink>) -> BoxFuture<'a, Result<()>> {
        Box::pin(async move {
            self.due_calls.fetch_add(1, Ordering::Relaxed);
            Ok(())
        })
    }
    fn sync_connection_into<'a>(&'a self, _: ConnectionRef, _: &'a dyn PersistSink) -> BoxFuture<'a, Result<()>> {
        Box::pin(async move {
            self.event_calls.fetch_add(1, Ordering::Relaxed);
            Ok(())
        })
    }
}

struct Portfolio(AtomicUsize);

impl PortfolioSyncer for Portfolio {
    fn sync<'a>(&'a self) -> BoxFuture<'a, Result<()>> {
        Box::pin(async move {
            self.0.fetch_add(1, Ordering::Relaxed);
            Ok(())
        })
    }
}

#[tokio::test]
async fn syncs_adapters_sequentially_and_routes_only_the_first_matching_event_adapter() -> Result<()> {
    let pool = crate::database::dbtest::open().await?;
    let first = Arc::new(Adapter {
        handles: true,
        due_calls: AtomicUsize::new(0),
        event_calls: AtomicUsize::new(0),
    });
    let second = Arc::new(Adapter {
        handles: true,
        due_calls: AtomicUsize::new(0),
        event_calls: AtomicUsize::new(0),
    });
    let portfolio = Arc::new(Portfolio(AtomicUsize::new(0)));
    let syncer = Syncer::new(pool, vec![first.clone(), second.clone()], Some(portfolio.clone()));

    syncer.sync_due().await;
    assert_eq!(first.due_calls.load(Ordering::Relaxed), 1);
    assert_eq!(second.due_calls.load(Ordering::Relaxed), 1);
    assert_eq!(portfolio.0.load(Ordering::Relaxed), 1);
    syncer
        .sync_account_created(AccountsCreated {
            connection_id: 1,
            provider: SourceTable::PlaidItems,
            source_id: 2,
        })
        .await;
    assert_eq!(first.event_calls.load(Ordering::Relaxed), 1);
    assert_eq!(second.event_calls.load(Ordering::Relaxed), 0);
    assert_eq!(portfolio.0.load(Ordering::Relaxed), 1);
    syncer.update_tracking_disabled(true);
    syncer.sync_due().await;
    assert_eq!(first.due_calls.load(Ordering::Relaxed), 1);
    syncer
        .sync_account_created(AccountsCreated {
            connection_id: 1,
            provider: SourceTable::PlaidItems,
            source_id: 2,
        })
        .await;
    assert_eq!(first.event_calls.load(Ordering::Relaxed), 1);
    Ok(())
}

#[tokio::test]
async fn consumes_account_events_until_the_sender_closes() -> Result<()> {
    let pool = crate::database::dbtest::open().await?;
    let adapter = Arc::new(Adapter {
        handles: true,
        due_calls: AtomicUsize::new(0),
        event_calls: AtomicUsize::new(0),
    });
    let syncer = Arc::new(Syncer::new(pool, vec![adapter.clone()], None));
    let (sender, receiver) = mpsc::channel(1);
    sender
        .send(AccountsCreated {
            connection_id: 1,
            provider: SourceTable::PlaidItems,
            source_id: 2,
        })
        .await?;
    drop(sender);
    syncer.run_account_events(receiver, CancellationToken::new()).await;
    assert_eq!(adapter.event_calls.load(Ordering::Relaxed), 1);
    Ok(())
}

#[tokio::test]
async fn routes_past_adapter_handle_errors_and_stops_on_cancellation() -> Result<()> {
    let pool = crate::database::dbtest::open().await?;
    let failing = Arc::new(Adapter {
        handles: false,
        due_calls: AtomicUsize::new(0),
        event_calls: AtomicUsize::new(0),
    });
    let handled = Arc::new(Adapter {
        handles: true,
        due_calls: AtomicUsize::new(0),
        event_calls: AtomicUsize::new(0),
    });
    let syncer = Arc::new(Syncer::new(pool, vec![failing, handled.clone()], None));
    syncer
        .sync_account_created(AccountsCreated {
            connection_id: 1,
            provider: SourceTable::PlaidItems,
            source_id: 2,
        })
        .await;
    assert_eq!(handled.event_calls.load(Ordering::Relaxed), 1);

    let (_sender, receiver) = mpsc::channel(1);
    let cancel = CancellationToken::new();
    let task = tokio::spawn({
        let syncer = Arc::clone(&syncer);
        let cancel = cancel.clone();
        async move { syncer.run_account_events(receiver, cancel).await }
    });
    cancel.cancel();
    task.await?;
    Ok(())
}
