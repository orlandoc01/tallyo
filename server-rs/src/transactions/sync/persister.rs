use anyhow::Result;
use sqlx::{Sqlite, SqlitePool, Transaction};

use crate::{
    accounts::{UpsertAccount, store::upsert_account},
    database,
    transactions::{
        AccountDraft, ItemCounts,
        store::{recurring_write, sync},
    },
};

use super::{PersistEvent, llm_worker::LlmWorker};

pub struct Persister {
    pool: SqlitePool,
    llm: std::sync::Arc<LlmWorker>,
}

impl Persister {
    pub(super) fn new(pool: SqlitePool, llm: std::sync::Arc<LlmWorker>) -> Self {
        Self { pool, llm }
    }

    pub(crate) async fn persist(&self, events: Vec<PersistEvent>) -> Result<ItemCounts> {
        let categorizer = self.llm.staging_guard().await;
        let stage_for_llm = categorizer.is_some();
        database::with_tx(&self.pool, |transaction| {
            Box::pin(async move {
                let mut counts = ItemCounts::default();
                for event in events {
                    Self::apply(transaction, event, stage_for_llm, &mut counts).await?;
                }
                Ok(counts)
            })
        })
        .await
    }

    async fn apply(
        transaction: &mut Transaction<'_, Sqlite>,
        event: PersistEvent,
        stage_for_llm: bool,
        counts: &mut ItemCounts,
    ) -> Result<()> {
        match event {
            PersistEvent::AccountUpsert(draft) => {
                let account = account(draft);
                upsert_account(&mut **transaction, &account).await?;
                counts.accounts_upserted += 1;
            }
            PersistEvent::Upsert(mut draft) => {
                draft.stage_for_llm = stage_for_llm;
                if sync::upsert_synced_transaction(transaction, &draft).await? {
                    counts.added += 1;
                } else {
                    counts.modified += 1;
                }
            }
            PersistEvent::Removal(removal) => {
                sync::delete_synced_transaction(transaction, removal.source, &removal.external_id).await?;
                counts.removed += 1;
            }
            PersistEvent::Recurring(charge) => {
                let charge_id = recurring_write::upsert_recurring_charge(transaction, &charge).await?;
                recurring_write::replace_charge_transactions(transaction, charge_id, &charge.transaction_ids).await?;
            }
            PersistEvent::MarkRecurring { source_id } => {
                recurring_write::mark_recurring_from_streams(transaction, source_id).await?;
            }
        }
        Ok(())
    }
}

fn account(draft: AccountDraft) -> UpsertAccount {
    UpsertAccount {
        external_id: draft.external_id,
        connection_id: Some(draft.connection_id),
        owner_id: draft.owner_id,
        name: draft.name,
        account_type: draft.account_type,
        subtype: draft.subtype,
        mask: draft.mask,
        notes: None,
        closed: false,
        hidden: false,
        needs_review: draft.needs_review,
    }
}
