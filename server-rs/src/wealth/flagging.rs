use anyhow::Result;
use sqlx::SqlitePool;

use crate::{
    money::Cents,
    wealth::{
        AccountBalanceSnapshot, BalanceReviewUpsert, LastUnflaggedBalanceResult, LastUnflaggedSnapshotResult,
        PersistEvent, PersistSink, SnapshotDecision, SnapshotDraft, SnapshotProviderState,
        marshal_balance_review_provider_holdings, store,
    },
};

use super::sanity::{HOLDING_PRICE_DEVIATION_RATIO, holding_price_deviates};

pub const PROVIDER_BALANCE_TOLERANCE: f64 = 0.05;
pub const PROVIDER_ZERO_BALANCE_TOLERANCE: f64 = 0.01;

pub fn provider_balance_within_tolerance(provider_balance: f64, approved_provider_balance: f64) -> bool {
    if approved_provider_balance == 0.0 {
        return provider_balance.abs() <= PROVIDER_ZERO_BALANCE_TOLERANCE;
    }
    (provider_balance - approved_provider_balance).abs() / approved_provider_balance.abs() <= PROVIDER_BALANCE_TOLERANCE
}

pub async fn approved_review_matches(pool: &SqlitePool, account_id: i64, provider_balance_usd: Cents) -> Result<bool> {
    Ok(store::approved_balance_review_by_account(pool, account_id)
        .await?
        .is_some_and(|review| {
            provider_balance_within_tolerance(provider_balance_usd.dollars(), review.provider_balance_usd.dollars())
        }))
}

pub async fn emit_with_price_check(
    pool: &SqlitePool,
    sink: &dyn PersistSink,
    snapshot: AccountBalanceSnapshot,
) -> Result<()> {
    let anchor = store::latest_unflagged_snapshot_with_holdings(pool, snapshot.account_id, &snapshot.date).await?;
    let decision = holding_price_deviates(&anchor.holdings, &snapshot.holdings, HOLDING_PRICE_DEVIATION_RATIO);
    let draft = match decision {
        None => clean_snapshot(snapshot, &anchor),
        Some(reason) if approved_review_matches(pool, snapshot.account_id, snapshot.balance_usd).await? => {
            approved_carry_forward(snapshot, &anchor, reason)
        }
        Some(reason) => flagged_snapshot(snapshot, &anchor, reason)?,
    };
    sink.persist(PersistEvent::Snapshot(Box::new(draft))).await
}

pub fn clean_snapshot(snapshot: AccountBalanceSnapshot, anchor: &LastUnflaggedSnapshotResult) -> SnapshotDraft {
    SnapshotDraft {
        snapshot,
        decision: SnapshotDecision::Clean,
        anchor: anchor_from_snapshot(anchor),
        review: None,
        provider_state: None,
        carry_usd: Cents::default(),
    }
}

pub fn approved_carry_forward(
    snapshot: AccountBalanceSnapshot,
    anchor: &LastUnflaggedSnapshotResult,
    reason: String,
) -> SnapshotDraft {
    SnapshotDraft {
        snapshot: carried_snapshot(snapshot, anchor, reason),
        decision: SnapshotDecision::ApprovedCarryForward,
        anchor: anchor_from_snapshot(anchor),
        review: None,
        provider_state: None,
        carry_usd: anchor.amount_usd,
    }
}

pub fn flagged_snapshot(
    snapshot: AccountBalanceSnapshot,
    anchor: &LastUnflaggedSnapshotResult,
    reason: String,
) -> Result<SnapshotDraft> {
    let provider_state = SnapshotProviderState {
        provider_balance_usd: snapshot.balance_usd,
        provider_holdings_json: marshal_balance_review_provider_holdings(&snapshot.holdings)?,
    };
    let review = BalanceReviewUpsert {
        account_id: snapshot.account_id,
        first_flagged_date: snapshot.date.clone(),
        latest_flagged_date: snapshot.date.clone(),
        flagged_snapshot_count: 1,
        provider_balance_usd: snapshot.balance_usd,
        carry_forward_balance_usd: anchor.amount_usd,
        flag_reason: reason.clone(),
    };
    tracing::error!(
        source = snapshot.source,
        account_id = snapshot.account_id,
        new_usd = snapshot.balance_usd.dollars(),
        carry_usd = anchor.amount_usd.dollars(),
        %reason,
        "snapshot flagged, carrying forward prior balance"
    );
    Ok(SnapshotDraft {
        snapshot: carried_snapshot(snapshot, anchor, reason),
        decision: SnapshotDecision::Flagged,
        anchor: anchor_from_snapshot(anchor),
        review: Some(review),
        provider_state: Some(provider_state),
        carry_usd: anchor.amount_usd,
    })
}

fn anchor_from_snapshot(snapshot: &LastUnflaggedSnapshotResult) -> LastUnflaggedBalanceResult {
    LastUnflaggedBalanceResult {
        found: snapshot.found,
        amount_usd: snapshot.amount_usd,
        date: snapshot.date.clone(),
    }
}

fn carried_snapshot(
    mut snapshot: AccountBalanceSnapshot,
    anchor: &LastUnflaggedSnapshotResult,
    reason: String,
) -> AccountBalanceSnapshot {
    snapshot.balance_usd = anchor.amount_usd;
    snapshot.holdings = anchor.holdings.clone();
    snapshot.flagged = true;
    snapshot.flag_reason = reason;
    snapshot
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use anyhow::Result;
    use chrono::{DateTime, TimeZone, Utc};

    use crate::{
        database::dbtest,
        money::Cents,
        testutil::store::{create_owner, seed_manual_account},
        utils::future::BoxFuture,
        wealth::{
            AccountBalanceSnapshot, AssetDailyHolding, LastUnflaggedSnapshotResult, PersistEvent, PersistSink,
            SnapshotDecision, SnapshotPersister, store,
        },
    };

    use super::{
        PROVIDER_BALANCE_TOLERANCE, PROVIDER_ZERO_BALANCE_TOLERANCE, approved_carry_forward, clean_snapshot,
        emit_with_price_check, flagged_snapshot, provider_balance_within_tolerance,
    };

    #[test]
    fn preserves_provider_tolerance_boundaries() {
        let cases = [
            (105.0, 100.0, true),
            (105.01, 100.0, false),
            (0.01, 0.0, true),
            (0.011, 0.0, false),
            (100.0, -100.0, false),
        ];
        for (provider, approved, expected) in cases {
            assert_eq!(provider_balance_within_tolerance(provider, approved), expected);
        }
        assert_eq!(PROVIDER_BALANCE_TOLERANCE, 0.05);
        assert_eq!(PROVIDER_ZERO_BALANCE_TOLERANCE, 0.01);
    }

    #[test]
    fn decisions_keep_clean_data_and_carry_flagged_data() {
        let anchor = LastUnflaggedSnapshotResult {
            found: true,
            amount_usd: Cents(100),
            date: "2026-01-01".to_owned(),
            holdings: vec![holding("prior", 1.0)],
        };
        let snapshot = snapshot();
        assert_eq!(
            clean_snapshot(snapshot.clone(), &anchor).snapshot.balance_usd,
            Cents(999)
        );
        let approved = approved_carry_forward(snapshot.clone(), &anchor, "bad price".to_owned());
        assert_eq!(approved.snapshot.holdings, anchor.holdings);
        assert!(approved.snapshot.flagged);
        assert_eq!(approved.snapshot.flag_reason, "bad price");
        let flagged = flagged_snapshot(snapshot, &anchor, "bad price".to_owned()).unwrap();
        assert_eq!(flagged.carry_usd, Cents(100));
        assert_eq!(flagged.review.unwrap().provider_balance_usd, Cents(999));
        assert!(flagged.provider_state.is_some());
        assert!(flagged.snapshot.flagged);
        assert_eq!(flagged.snapshot.flag_reason, "bad price");
    }

    #[tokio::test]
    async fn price_checks_auto_carry_only_approved_provider_totals_and_leave_clean_views_clean() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = create_owner(&pool, "Owner").await?;
        let account = seed_manual_account(&pool, &owner, "Account").await?;
        store::replace_account_balance_snapshot(
            &pool,
            AccountBalanceSnapshot {
                account_id: account.id,
                date: "2026-09-05".to_owned(),
                synced_at: "2026-09-05T12:00:00Z".to_owned(),
                balance_usd: Cents(5000),
                holdings: vec![holding("USD", 1.0)],
                ..snapshot()
            },
        )
        .await?;
        let now = Utc.with_ymd_and_hms(2026, 9, 6, 12, 0, 0).unwrap();
        let persister = SnapshotPersister::new(pool.clone()).with_run("2026-09-06", now);
        emit_with_price_check(&pool, &persister, price_checked_snapshot(account.id, 104.0, 150.0)).await?;
        let review = store::in_review_balance_reviews(&pool).await?.pop().unwrap();
        store::approve_balance_review(&pool, review.id).await?;

        let sink = RecordingSink::new(now);
        emit_with_price_check(&pool, &sink, price_checked_snapshot(account.id, 104.0, 150.0)).await?;
        assert_eq!(sink.decision(), SnapshotDecision::ApprovedCarryForward);
        assert_eq!(sink.snapshot().snapshot.balance_usd, Cents(5000));
        assert!(sink.snapshot().snapshot.flagged);
        assert!(sink.snapshot().snapshot.flag_reason.contains("price USD"));

        let beyond_tolerance = RecordingSink::new(now);
        emit_with_price_check(
            &pool,
            &beyond_tolerance,
            price_checked_snapshot(account.id, 110.0, 150.0),
        )
        .await?;
        assert_eq!(beyond_tolerance.decision(), SnapshotDecision::Flagged);
        assert!(beyond_tolerance.snapshot().review.is_some());

        let clean = RecordingSink::new(now);
        emit_with_price_check(&pool, &clean, price_checked_snapshot(account.id, 100.0, 1.0)).await?;
        assert_eq!(clean.decision(), SnapshotDecision::Clean);
        assert!(!clean.snapshot().snapshot.flagged);
        Ok(())
    }

    fn snapshot() -> AccountBalanceSnapshot {
        AccountBalanceSnapshot {
            account_id: 1,
            wallet_address: String::new(),
            source: "test".to_owned(),
            date: "2026-01-02".to_owned(),
            synced_at: "2026-01-02T12:00:00Z".to_owned(),
            balance_usd: Cents(999),
            raw_payload: None,
            holdings: vec![holding("next", 999.0)],
            flagged: false,
            flag_reason: String::new(),
        }
    }

    fn holding(identifier: &str, value_usd: f64) -> AssetDailyHolding {
        AssetDailyHolding {
            asset_id: 1,
            asset: None,
            adapter_source: None,
            adapter_sources: Vec::new(),
            price_update: None,
            quantity: Some(1.0),
            price: Some(value_usd),
            value_usd,
            counts_toward_value: true,
            manual: false,
            line_type: String::new(),
            chain_id: String::new(),
            project_name: None,
            token_id: String::new(),
            identifier: identifier.to_owned(),
            token_symbol: None,
            token_name: None,
            provider_price: None,
        }
    }

    fn price_checked_snapshot(account_id: i64, balance_usd: f64, price: f64) -> AccountBalanceSnapshot {
        AccountBalanceSnapshot {
            account_id,
            date: "2026-09-06".to_owned(),
            synced_at: "2026-09-06T12:00:00Z".to_owned(),
            balance_usd: Cents::from_dollars(balance_usd),
            holdings: vec![AssetDailyHolding {
                price: Some(price),
                value_usd: balance_usd,
                ..holding("USD", balance_usd)
            }],
            ..snapshot()
        }
    }

    struct RecordingSink {
        now: DateTime<Utc>,
        events: Mutex<Vec<PersistEvent>>,
    }

    impl RecordingSink {
        fn new(now: DateTime<Utc>) -> Self {
            Self {
                now,
                events: Mutex::new(Vec::new()),
            }
        }

        fn decision(&self) -> SnapshotDecision {
            self.snapshot().decision
        }

        fn snapshot(&self) -> crate::wealth::SnapshotDraft {
            let events = self.events.lock().unwrap();
            let PersistEvent::Snapshot(snapshot) = &events[0] else {
                panic!("expected snapshot")
            };
            (**snapshot).clone()
        }
    }

    impl PersistSink for RecordingSink {
        fn now(&self) -> DateTime<Utc> {
            self.now
        }

        fn today(&self) -> &str {
            "2026-09-06"
        }

        fn persist<'a>(&'a self, event: PersistEvent) -> BoxFuture<'a, Result<()>> {
            self.events.lock().unwrap().push(event);
            Box::pin(async { Ok(()) })
        }
    }
}
