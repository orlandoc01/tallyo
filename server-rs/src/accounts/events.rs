use std::sync::{Arc, Mutex};

use tokio::sync::mpsc::{self, Receiver, Sender};

use crate::accounts::types::SourceTable;

pub const ACCOUNTS_CREATED_BUFFER_SIZE: usize = 64;

type Subscribers = Vec<(String, Sender<AccountsCreated>)>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AccountsCreated {
    pub connection_id: i64,
    pub provider: SourceTable,
    pub source_id: i64,
}

#[derive(Clone, Default)]
pub struct EventBus {
    subscribers: Arc<Mutex<Subscribers>>,
}

impl EventBus {
    pub fn register_subscriber(&self, name: impl Into<String>) -> Receiver<AccountsCreated> {
        let (sender, receiver) = mpsc::channel(ACCOUNTS_CREATED_BUFFER_SIZE);
        self.subscribers
            .lock()
            .expect("event subscribers lock poisoned")
            .push((name.into(), sender));
        receiver
    }

    pub fn publish(&self, event: AccountsCreated) {
        self.subscribers
            .lock()
            .expect("event subscribers lock poisoned")
            .iter()
            .filter(|(_, sender)| sender.try_send(event).is_err())
            .for_each(|(name, _)| {
                tracing::warn!(subscriber = name, provider = %event.provider, connection_id = event.connection_id, source_id = event.source_id, "dropped accounts created event");
            });
    }
}

#[cfg(test)]
mod tests {
    use super::{ACCOUNTS_CREATED_BUFFER_SIZE, AccountsCreated, EventBus};
    use crate::accounts::SourceTable;

    #[tokio::test]
    async fn fans_out_and_drops_full_subscribers() {
        let bus = EventBus::default();
        let mut first = bus.register_subscriber("first");
        let mut second = bus.register_subscriber("second");
        let event = AccountsCreated {
            connection_id: 1,
            provider: SourceTable::PlaidItems,
            source_id: 2,
        };
        bus.publish(event);
        assert_eq!(first.recv().await, Some(event));
        assert_eq!(second.recv().await, Some(event));

        for source_id in 0..=ACCOUNTS_CREATED_BUFFER_SIZE {
            bus.publish(AccountsCreated {
                source_id: source_id as i64,
                ..event
            });
        }
        let received = (0..ACCOUNTS_CREATED_BUFFER_SIZE)
            .map(|_| first.try_recv().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(received.len(), ACCOUNTS_CREATED_BUFFER_SIZE);
        assert!(first.try_recv().is_err());
    }
}
