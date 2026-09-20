use std::collections::HashMap;

use anyhow::{Context, Result};
use chrono::{NaiveDate, TimeZone, Utc};

use crate::{
    clients::plaid::{Holding, Security},
    money::Cents,
    wealth::{
        AccountBalanceSnapshot, Asset, AssetDailyHolding, AssetUpdate, BalanceReviewUpsert, PersistEvent, PersistSink,
        SnapshotDecision, SnapshotDraft, SnapshotProviderState, SyncAdapter, store,
    },
};

use super::plaid::{PlaidSyncAdapter, empty_anchor};

pub(super) const EMPTY_INVESTMENT_HOLDINGS_FLAG_REASON: &str =
    "Plaid returned zero holdings; carried forward the latest unflagged holdings with refreshed pricing";

pub(super) struct RecalibrationEntry {
    pub asset: Asset,
    pub institution_price: f64,
    pub source_id: String,
}

impl PlaidSyncAdapter {
    pub(super) async fn investment_holding_price(
        &self,
        asset: &Asset,
        holding: &Holding,
        security: &Security,
        date: &str,
    ) -> Result<(Option<f64>, bool)> {
        if let Some(price) = asset.forced_usd_price {
            return Ok((Some(price), false));
        }
        if holding.institution_price > 0.0 {
            return Ok((Some(holding.institution_price), true));
        }
        Ok((self.holding_price_fallback(asset, security, date).await?, false))
    }

    pub(super) async fn post_snapshot_recalibration(
        &self,
        entries: &[RecalibrationEntry],
        date: &str,
    ) -> HashMap<String, AssetUpdate> {
        let Ok(price_at) = date_at(date) else {
            return HashMap::new();
        };
        let mut updates = HashMap::new();
        for entry in entries {
            if entry.institution_price <= 0.0 {
                continue;
            }
            let tracking_multiplier = if entry.asset.tracking_ticker.is_some() {
                let raw_asset = Asset {
                    id: 0,
                    tracking_multiplier: 1.0,
                    current_price: None,
                    ..entry.asset.clone()
                };
                self.prices
                    .price_at(&raw_asset, price_at)
                    .await
                    .ok()
                    .filter(|price| *price > 0.0)
                    .map(|price| {
                        let multiplier = entry.institution_price / price;
                        if (multiplier - 1.0).abs() < 0.001 { 1.0 } else { multiplier }
                    })
            } else {
                None
            };
            updates.insert(
                entry.source_id.clone(),
                AssetUpdate {
                    asset_id: entry.asset.id,
                    price: entry.institution_price,
                    price_at,
                    tracking_multiplier,
                },
            );
        }
        updates
    }

    pub(super) async fn handle_empty_investment_holdings(
        &self,
        account_id: i64,
        balance: Option<f64>,
        sink: &dyn PersistSink,
        raw_payload: &str,
    ) -> Result<bool> {
        if balance == Some(0.0) {
            return sink
                .persist(PersistEvent::Snapshot(Box::new(SnapshotDraft {
                    snapshot: AccountBalanceSnapshot {
                        account_id,
                        wallet_address: String::new(),
                        source: self.source().to_string(),
                        date: sink.today().to_owned(),
                        synced_at: sink.now().to_rfc3339(),
                        balance_usd: Cents::default(),
                        raw_payload: Some(raw_payload.to_owned()),
                        holdings: Vec::new(),
                        flagged: false,
                        flag_reason: String::new(),
                    },
                    decision: SnapshotDecision::Clean,
                    anchor: empty_anchor(),
                    review: None,
                    provider_state: None,
                    carry_usd: Cents::default(),
                })))
                .await
                .map(|()| true);
        }

        let approved =
            crate::wealth::flagging::approved_review_matches(&self.pool, account_id, Cents::default()).await?;
        self.carry_forward_empty_investment_holdings(account_id, sink, raw_payload, !approved)
            .await
    }

    async fn holding_price_fallback(&self, asset: &Asset, security: &Security, date: &str) -> Result<Option<f64>> {
        let priced_asset = Asset {
            current_price: None,
            ..asset.clone()
        };
        let provider_price = self.prices.price_at(&priced_asset, date_at(date)?).await?;
        Ok([Some(provider_price), security.close_price, asset.current_price]
            .into_iter()
            .flatten()
            .find(|price| *price > 0.0))
    }

    async fn carry_forward_empty_investment_holdings(
        &self,
        account_id: i64,
        sink: &dyn PersistSink,
        raw_payload: &str,
        upsert_review: bool,
    ) -> Result<bool> {
        let prior = store::latest_unflagged_snapshot_with_holdings(&self.pool, account_id, sink.today()).await?;
        if !prior.found {
            return Ok(false);
        }
        let holdings = self
            .reprice_prior_investment_holdings(prior.holdings, sink.today())
            .await;
        let balance_usd = Cents::from_dollars(holdings.iter().map(|holding| holding.value_usd).sum::<f64>());
        let review = upsert_review.then(|| BalanceReviewUpsert {
            account_id,
            first_flagged_date: sink.today().to_owned(),
            latest_flagged_date: sink.today().to_owned(),
            flagged_snapshot_count: 1,
            provider_balance_usd: Cents::default(),
            carry_forward_balance_usd: balance_usd,
            flag_reason: EMPTY_INVESTMENT_HOLDINGS_FLAG_REASON.to_owned(),
        });
        sink.persist(PersistEvent::Snapshot(Box::new(SnapshotDraft {
            snapshot: AccountBalanceSnapshot {
                account_id,
                wallet_address: String::new(),
                source: self.source().to_string(),
                date: sink.today().to_owned(),
                synced_at: sink.now().to_rfc3339(),
                balance_usd,
                raw_payload: Some(raw_payload.to_owned()),
                holdings,
                flagged: true,
                flag_reason: EMPTY_INVESTMENT_HOLDINGS_FLAG_REASON.to_owned(),
            },
            decision: if upsert_review { SnapshotDecision::Flagged } else { SnapshotDecision::ApprovedCarryForward },
            anchor: empty_anchor(),
            review,
            provider_state: upsert_review.then(|| SnapshotProviderState {
                provider_balance_usd: Cents::default(),
                provider_holdings_json: "[]".to_owned(),
            }),
            carry_usd: balance_usd,
        })))
        .await
        .map(|()| true)
    }

    async fn reprice_prior_investment_holdings(
        &self,
        holdings: Vec<AssetDailyHolding>,
        date: &str,
    ) -> Vec<AssetDailyHolding> {
        let Ok(date) = date_at(date) else {
            return holdings;
        };
        let mut repriced = Vec::with_capacity(holdings.len());
        for holding in holdings {
            let fresh_price = match store::asset_by_id(&self.pool, holding.asset_id).await.ok().flatten() {
                Some(asset) => self
                    .prices
                    .price_at(&asset, date)
                    .await
                    .ok()
                    .filter(|price| *price > 0.0),
                None => None,
            };
            let price = fresh_price.or(holding.price);
            let value_usd = holding
                .quantity
                .zip(fresh_price)
                .map_or(holding.value_usd, |(quantity, price)| quantity * price);
            repriced.push(AssetDailyHolding {
                price,
                value_usd,
                ..holding
            });
        }
        repriced
    }
}

fn date_at(date: &str) -> Result<chrono::DateTime<Utc>> {
    let date = NaiveDate::parse_from_str(date, "%F").context("parse holdings price date")?;
    let midnight = date
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| anyhow::anyhow!("parse holdings price date"))?;
    Ok(Utc.from_utc_datetime(&midnight))
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::date_at;
    use crate::{
        accounts::PlaidClientFactory,
        clients::plaid::{Holding, Security},
        database::dbtest,
        wealth::{PlaidSyncAdapter, store},
    };

    #[tokio::test]
    async fn prices_forced_and_institution_values_before_any_provider_fallback() -> anyhow::Result<()> {
        let pool = dbtest::open().await?;
        let asset_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO assets (asset_type, identifier, classifier, last_price, price_connectivity) VALUES ('SECURITY', 'VTI', 'PUBLIC', 4, 'IGNORE') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        let mut asset = store::asset_by_id(&pool, asset_id).await?.unwrap();
        let adapter = PlaidSyncAdapter::new(pool.clone(), PlaidClientFactory::new(pool))?;
        let holding = Holding {
            institution_price: 15.0,
            ..Default::default()
        };
        let security = Security {
            close_price: Some(10.0),
            ..Default::default()
        };

        asset.forced_usd_price = Some(12.0);
        assert_eq!(
            adapter
                .investment_holding_price(&asset, &holding, &security, "2026-09-06")
                .await?,
            (Some(12.0), false)
        );
        asset.forced_usd_price = None;
        assert_eq!(
            adapter
                .investment_holding_price(&asset, &holding, &security, "2026-09-06")
                .await?,
            (Some(15.0), true)
        );
        assert!(
            adapter
                .investment_holding_price(&asset, &Holding::default(), &security, "not-a-date")
                .await
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn parses_valuation_dates_at_utc_midnight() {
        assert_eq!(
            date_at("2026-09-06").unwrap(),
            Utc.with_ymd_and_hms(2026, 9, 6, 0, 0, 0).unwrap()
        );
        assert!(date_at("not-a-date").is_err());
    }
}
