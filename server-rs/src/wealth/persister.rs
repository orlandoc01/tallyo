use anyhow::{Context, Result, bail};
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use crate::utils::future::BoxFuture;

use super::{PersistEvent, PersistSink, SnapshotDecision, SnapshotDraft, SnapshotPersist, SnapshotRecovery, store};

#[derive(Clone)]
pub struct SnapshotPersister {
    pool: SqlitePool,
    today: String,
    now: DateTime<Utc>,
}

impl SnapshotPersister {
    pub fn new(pool: SqlitePool) -> Self {
        let now = Utc::now();
        Self {
            pool,
            today: now.format("%F").to_string(),
            now,
        }
    }

    pub fn with_run(&self, today: impl Into<String>, now: DateTime<Utc>) -> Self {
        Self {
            pool: self.pool.clone(),
            today: today.into(),
            now,
        }
    }

    async fn apply(&self, event: PersistEvent) -> Result<()> {
        match event {
            PersistEvent::Snapshot(draft) => {
                let synced_at = draft
                    .snapshot
                    .synced_at
                    .parse()
                    .with_context(|| format!("parse snapshot synced_at {:?}", draft.snapshot.synced_at))?;
                store::persist_snapshot(&self.pool, snapshot_persist(*draft, synced_at)?)
                    .await
                    .context("persist snapshot")
            }
            PersistEvent::Asset(update) => store::persist_asset_update(&self.pool, update)
                .await
                .context("persist asset update"),
        }
    }
}

impl PersistSink for SnapshotPersister {
    fn now(&self) -> DateTime<Utc> {
        self.now
    }

    fn today(&self) -> &str {
        &self.today
    }

    fn persist<'a>(&'a self, event: PersistEvent) -> BoxFuture<'a, Result<()>> {
        Box::pin(self.apply(event))
    }
}

pub(crate) fn snapshot_persist(draft: SnapshotDraft, synced_at: DateTime<Utc>) -> Result<SnapshotPersist> {
    let mut persist = SnapshotPersist {
        snapshot: draft.snapshot,
        synced_at,
        expire_review: false,
        recovery: None,
        review: None,
        provider_state: None,
    };
    match draft.decision {
        SnapshotDecision::Clean => {
            persist.expire_review = true;
            if draft.anchor.found {
                persist.recovery = Some(SnapshotRecovery {
                    account_id: persist.snapshot.account_id,
                    after_date: draft.anchor.date,
                    before_date: persist.snapshot.date.clone(),
                });
            }
        }
        SnapshotDecision::Flagged => {
            let Some(provider_state) = draft.provider_state else {
                bail!("flagged snapshot missing provider state");
            };
            persist.snapshot.balance_usd = draft.carry_usd;
            persist.snapshot.flagged = true;
            persist.review = draft.review;
            persist.provider_state = Some(provider_state);
        }
        SnapshotDecision::ApprovedCarryForward => {
            persist.snapshot.balance_usd = draft.carry_usd;
            persist.snapshot.flagged = true;
        }
    }
    Ok(persist)
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;
    use crate::{money::Cents, wealth::AccountBalanceSnapshot};

    #[test]
    fn flagged_snapshots_require_provider_state_and_carry_the_approved_balance() {
        let draft = SnapshotDraft {
            snapshot: AccountBalanceSnapshot {
                account_id: 1,
                wallet_address: String::new(),
                source: "test".to_owned(),
                date: "2026-06-01".to_owned(),
                synced_at: "2026-06-01T12:00:00Z".to_owned(),
                balance_usd: Cents(999),
                raw_payload: None,
                holdings: Vec::new(),
                flagged: false,
                flag_reason: String::new(),
            },
            decision: SnapshotDecision::Flagged,
            anchor: crate::wealth::LastUnflaggedBalanceResult {
                found: false,
                amount_usd: Cents::default(),
                date: String::new(),
            },
            review: None,
            provider_state: None,
            carry_usd: Cents(100),
        };

        assert_eq!(
            snapshot_persist(draft.clone(), Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap())
                .unwrap_err()
                .to_string(),
            "flagged snapshot missing provider state"
        );

        let persist = snapshot_persist(
            SnapshotDraft {
                provider_state: Some(super::super::SnapshotProviderState {
                    provider_balance_usd: Cents(999),
                    provider_holdings_json: "[]".to_owned(),
                }),
                ..draft
            },
            Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap(),
        )
        .unwrap();
        assert!(persist.snapshot.flagged);
        assert_eq!(persist.snapshot.balance_usd, Cents(100));
    }

    #[test]
    fn clean_snapshots_expire_reviews_and_recover_flagged_dates() {
        let persist = snapshot_persist(
            SnapshotDraft {
                decision: SnapshotDecision::Clean,
                anchor: crate::wealth::LastUnflaggedBalanceResult {
                    found: true,
                    amount_usd: Cents(50),
                    date: "2026-05-31".to_owned(),
                },
                ..draft(SnapshotDecision::Clean)
            },
            Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap(),
        )
        .unwrap();

        assert!(persist.expire_review);
        assert_eq!(
            persist.recovery,
            Some(SnapshotRecovery {
                account_id: 1,
                after_date: "2026-05-31".to_owned(),
                before_date: "2026-06-01".to_owned(),
            })
        );
    }

    #[test]
    fn approved_carry_forward_flags_the_snapshot_without_a_review() {
        let persist = snapshot_persist(
            draft(SnapshotDecision::ApprovedCarryForward),
            Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap(),
        )
        .unwrap();

        assert!(persist.snapshot.flagged);
        assert_eq!(persist.snapshot.balance_usd, Cents(100));
        assert!(!persist.expire_review);
        assert_eq!(persist.review, None);
    }

    #[tokio::test]
    async fn exposes_the_configured_run_and_contextualizes_persist_errors() {
        let persister = SnapshotPersister::new(crate::database::dbtest::open().await.unwrap())
            .with_run("2026-06-01", Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap());
        let error = persister
            .persist(PersistEvent::Snapshot(Box::new(SnapshotDraft {
                snapshot: AccountBalanceSnapshot {
                    synced_at: "not-a-timestamp".to_owned(),
                    ..draft(SnapshotDecision::Clean).snapshot
                },
                ..draft(SnapshotDecision::Clean)
            })))
            .await
            .unwrap_err();

        assert_eq!(persister.today(), "2026-06-01");
        assert_eq!(persister.now(), Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap());
        assert!(error.to_string().contains("parse snapshot synced_at"));
        persister
            .persist(PersistEvent::Asset(crate::wealth::AssetUpdate {
                asset_id: 999,
                price: 1.0,
                price_at: Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap(),
                tracking_multiplier: None,
            }))
            .await
            .unwrap();
    }

    fn draft(decision: SnapshotDecision) -> SnapshotDraft {
        SnapshotDraft {
            snapshot: AccountBalanceSnapshot {
                account_id: 1,
                wallet_address: String::new(),
                source: "test".to_owned(),
                date: "2026-06-01".to_owned(),
                synced_at: "2026-06-01T12:00:00Z".to_owned(),
                balance_usd: Cents(999),
                raw_payload: None,
                holdings: Vec::new(),
                flagged: false,
                flag_reason: String::new(),
            },
            decision,
            anchor: crate::wealth::LastUnflaggedBalanceResult {
                found: false,
                amount_usd: Cents::default(),
                date: String::new(),
            },
            review: None,
            provider_state: None,
            carry_usd: Cents(100),
        }
    }
}
