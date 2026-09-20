use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

use crate::{
    apierror::ApiError,
    ids::Date,
    money::Cents,
    schema::{AssetsInput, Granularity, LinkRealEstateInput, MergeAssetInput, NetWorthRange, UpdateRealEstateInput},
};

use super::{
    AccountFilter, Asset, AssetClassifier, AssetQuote, ClassifierBreakdown, CreateRealEstate, HistoricalNetWorthReport,
    LiabilityAccountBalance, LinkRealEstatePayload, NetWorthReport, RealEstateDetails, RealEstateValuation,
    UpdateRealEstate, holding, liabilities, series, series_breakdown, store,
    timezone::{local_date, local_day_window, timezone_or_utc},
};

pub const MAX_HISTORICAL_NET_WORTH_POINTS: usize = 400;

pub struct WealthService {
    pub(super) pool: SqlitePool,
    pub(super) price_provider: Option<super::YahooPriceProvider>,
    pub(super) timezone: Box<dyn Fn() -> String + Send + Sync>,
}

impl WealthService {
    pub fn new(
        pool: SqlitePool,
        price_provider: Option<super::YahooPriceProvider>,
        timezone: impl Fn() -> String + Send + Sync + 'static,
    ) -> Self {
        Self {
            pool,
            price_provider,
            timezone: Box::new(timezone),
        }
    }

    pub async fn net_worth(&self, filter: AccountFilter, as_of_date: Option<Date>) -> Result<NetWorthReport> {
        let timezone = (self.timezone)();
        // Today's history point is the live position, so a request for today
        // must not switch to the snapshot window (which would keep accounts
        // closed after their final sync today).
        let today = local_date(Utc::now(), &timezone);
        let as_of = as_of_date
            .as_ref()
            .filter(|date| date.as_str() != today)
            .map(|date| local_day_window(date, &timezone))
            .transpose()?;
        let report_date = match as_of_date {
            Some(date) => Some(date),
            None => store::account_balance_snapshot_timestamp_range(&self.pool, &filter)
                .await?
                .latest
                .map(|timestamp| Date::new(local_date(timestamp, &timezone)))
                .transpose()?,
        };
        let position = self.current_position(AccountFilter { as_of, ..filter }).await?;
        Ok(NetWorthReport {
            as_of_date: report_date,
            current_net_worth_usd: position.assets - position.liabilities,
            current_assets_usd: position.assets,
            current_liabilities_usd: position.liabilities,
            classifier_breakdown: classifier_breakdown(position.asset_holdings, position.assets),
            liability_breakdown: liabilities::liability_breakdown(position.liability_balances, position.liabilities),
        })
    }

    pub async fn historical_net_worth(
        &self,
        filter: AccountFilter,
        range: NetWorthRange,
        granularity: Option<Granularity>,
    ) -> Result<HistoricalNetWorthReport> {
        let position = self.current_position(filter.clone()).await?;
        let timestamp_range = store::account_balance_snapshot_timestamp_range(&self.pool, &filter).await?;
        let timezone = (self.timezone)();
        let now = Utc::now().with_timezone(&timezone_or_utc(&timezone));
        let dates = series::sample_dates(range, granularity, timestamp_range.earliest, now);
        if dates.len() > MAX_HISTORICAL_NET_WORTH_POINTS {
            return Err(ApiError::bad_input(format!(
                "historical net worth range produces {} points (max {}); choose a coarser granularity",
                dates.len(),
                MAX_HISTORICAL_NET_WORTH_POINTS
            ))
            .into());
        }
        let (start_time, end_time) = series_window(&dates);
        let snapshot_values =
            store::account_balance_snapshot_values(&self.pool, &start_time, &end_time, &filter).await?;
        let classifier_values = store::classifier_snapshot_values(&self.pool, &start_time, &end_time, &filter).await?;
        Ok(HistoricalNetWorthReport {
            series: series::net_worth_series(
                &dates,
                now,
                position.assets,
                position.liabilities,
                &snapshot_values,
                &timezone,
            ),
            classifier_series: series_breakdown::classifier_history_series(classifier_values, &dates, &timezone),
            liability_series: series_breakdown::liability_history_series(snapshot_values, &dates, &timezone),
        })
    }

    pub async fn quote(&self, ticker: impl AsRef<str>) -> Result<AssetQuote> {
        let ticker = ticker.as_ref().trim().to_ascii_uppercase();
        let as_of = Utc::now();
        let asset = Asset {
            id: 0,
            asset_type: crate::schema::AssetType::Security,
            identifier: ticker.clone(),
            name: None,
            classifier: AssetClassifier::Public,
            current_price: None,
            forced_usd_price: None,
            tracking_ticker: None,
            tracking_multiplier: 1.0,
            price_connectivity: crate::schema::ConnectivityStatus::Healthy,
            investment_connectivity: crate::schema::ConnectivityStatus::Healthy,
        };
        Ok(AssetQuote {
            price_usd: self
                .price_provider
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("price provider unavailable"))?
                .price_at(&asset, as_of)
                .await
                .map_err(|error| anyhow::anyhow!("fetch price for {ticker:?}: {error}"))?,
            ticker,
            as_of,
        })
    }

    pub async fn accounts_last_synced_at(
        &self,
        account_ids: &[i64],
    ) -> Result<std::collections::HashMap<i64, DateTime<Utc>>> {
        store::account_last_balance_synced_at_for_accounts(&self.pool, account_ids).await
    }

    pub async fn assets(&self, input: AssetsInput) -> Result<Vec<Asset>> {
        store::all_assets(&self.pool, input).await
    }

    pub async fn merge_asset(&self, input: MergeAssetInput) -> Result<Asset> {
        let asset_id =
            crate::ids::GlobalId::decode(input.asset_id.as_str())?.i64_of_type(crate::ids::GlobalIdType::Asset)?;
        store::merge_asset_by_source(&self.pool, input.source_adapter.into(), &input.source_id, asset_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("asset {asset_id} not found"))
    }

    pub async fn link_real_estate(&self, input: LinkRealEstateInput) -> Result<LinkRealEstatePayload> {
        let now = Utc::now();
        let valuation_usd = input.manual_valuation_usd;
        let (connection, account) = store::create_real_estate(
            &self.pool,
            CreateRealEstate {
                owner_id: crate::ids::GlobalId::decode(input.owner_id.as_str())?
                    .i64_of_type(crate::ids::GlobalIdType::Owner)?,
                label: input.label.unwrap_or_default(),
                details: RealEstateDetails {
                    street: input.street,
                    city: input.city,
                    state: input.state,
                    zip: input.zip,
                    home_type: input.home_type,
                },
                initial_valuation: Some(RealEstateValuation {
                    value_usd: valuation_usd,
                    date: now.format("%F").to_string(),
                    synced_at: now,
                    source: super::SyncerId::Realestate,
                }),
            },
        )
        .await?;
        Ok(LinkRealEstatePayload {
            connection: connection.connection,
            account,
            valuation_usd,
        })
    }

    pub async fn update_real_estate(&self, input: UpdateRealEstateInput) -> Result<crate::accounts::Account> {
        let now = Utc::now();
        let account_id = store::update_real_estate(
            &self.pool,
            UpdateRealEstate {
                connection_id: crate::ids::GlobalId::decode(input.connection_id.as_str())?
                    .i64_of_type(crate::ids::GlobalIdType::Connection)?,
                name: input.name,
                details: RealEstateDetails {
                    street: input.street,
                    city: input.city,
                    state: input.state,
                    zip: input.zip,
                    home_type: input.home_type,
                },
                valuation: input.valuation_usd.map(|value_usd| RealEstateValuation {
                    value_usd,
                    date: now.format("%F").to_string(),
                    synced_at: now,
                    source: super::SyncerId::Realestate,
                }),
            },
        )
        .await?;
        crate::accounts::store::account_by_id(&self.pool, account_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("account {account_id} not found"))
    }

    pub async fn unlink_real_estate(&self, connection_id: impl AsRef<str>) -> Result<bool> {
        let connection_id =
            crate::ids::GlobalId::decode(connection_id.as_ref())?.i64_of_type(crate::ids::GlobalIdType::Connection)?;
        store::delete_real_estate(&self.pool, connection_id).await?;
        Ok(true)
    }

    async fn current_position(&self, mut filter: AccountFilter) -> Result<CurrentPosition> {
        filter.exclude_liabilities = true;
        let asset_holdings = store::current_holdings(&self.pool, &filter).await?;
        let liability_balances = store::latest_liability_account_balances(&self.pool, &filter).await?;
        let assets = asset_holdings.iter().map(|holding| holding.value_usd).sum();
        let liabilities = liability_balances.iter().map(|balance| balance.balance_usd).sum();
        Ok(CurrentPosition {
            asset_holdings,
            liability_balances,
            assets,
            liabilities,
        })
    }
}

struct CurrentPosition {
    asset_holdings: Vec<super::CurrentHolding>,
    liability_balances: Vec<LiabilityAccountBalance>,
    assets: Cents,
    liabilities: Cents,
}

const CLASSIFIER_ORDER: [AssetClassifier; 6] = [
    AssetClassifier::Cash,
    AssetClassifier::Public,
    AssetClassifier::CompanyEquity,
    AssetClassifier::Cryptocurrency,
    AssetClassifier::Stablecoin,
    AssetClassifier::RealEstate,
];

fn classifier_breakdown(holdings: Vec<super::CurrentHolding>, total_assets: Cents) -> Vec<ClassifierBreakdown> {
    CLASSIFIER_ORDER
        .into_iter()
        .filter_map(|classifier| {
            let holdings: Vec<_> = holdings
                .iter()
                .filter(|holding| holding.asset.classifier == classifier)
                .collect();
            let value_usd: Cents = holdings.iter().map(|holding| holding.value_usd).sum();
            (!holdings.is_empty()).then(|| ClassifierBreakdown {
                classifier,
                label: classifier_label(classifier).to_owned(),
                value_usd,
                percent_of_assets: if total_assets != Cents::default() {
                    value_usd.dollars() / total_assets.dollars() * 100.0
                } else {
                    0.0
                },
                asset_count: holdings
                    .iter()
                    .map(|holding| holding.asset.id)
                    .collect::<std::collections::HashSet<_>>()
                    .len() as i32,
                holdings: holding::holding_rollups(holdings.into_iter().cloned().collect()),
            })
        })
        .collect()
}

fn classifier_label(classifier: AssetClassifier) -> &'static str {
    match classifier {
        AssetClassifier::Cash => "Cash & Equivalents",
        AssetClassifier::Public => "Public Assets",
        AssetClassifier::CompanyEquity => "Company Equity",
        AssetClassifier::Cryptocurrency => "Cryptocurrency",
        AssetClassifier::Stablecoin => "Stablecoin",
        AssetClassifier::RealEstate => "Real Estate",
    }
}

fn series_window(dates: &[DateTime<chrono_tz::Tz>]) -> (String, String) {
    let start = super::timezone::start_of_day(dates[0]).with_timezone(&Utc);
    let end = super::timezone::start_of_day(*dates.last().expect("dates are non-empty"))
        .checked_add_days(chrono::Days::new(1))
        .expect("next day must be representable")
        .with_timezone(&Utc);
    (start.to_rfc3339(), end.to_rfc3339())
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use chrono::{Days, TimeZone, Utc};
    use chrono_tz::America::New_York;

    use super::{AccountFilter, WealthService, classifier_breakdown, classifier_label, series_window};
    use crate::{
        accounts::{Account, AccountType, Owner},
        database::dbtest,
        ids::GlobalId,
        money::Cents,
        schema::{
            AssetClassifier, AssetSourceAdapter, AssetType, AssetsInput, ConnectivityStatus, Granularity,
            LinkRealEstateInput, MergeAssetInput, NetWorthRange, UpdateRealEstateInput,
        },
        wealth::{Asset, CurrentHolding},
    };

    #[tokio::test]
    async fn serves_empty_reports_and_real_estate_lifecycle() -> Result<()> {
        let pool = dbtest::open().await?;
        let owner = crate::testutil::store::create_owner(&pool, "Owner").await?;
        let service = WealthService::new(pool, None, || "America/New_York".to_owned());

        let report = service.net_worth(AccountFilter::default(), None).await?;
        assert_eq!(report.current_net_worth_usd, Cents::default());
        assert_eq!(report.as_of_date, None);
        assert!(
            service
                .historical_net_worth(
                    AccountFilter::default(),
                    NetWorthRange::OneMonth,
                    Some(Granularity::Monthly)
                )
                .await?
                .series
                .len()
                >= 2
        );
        assert!(service.accounts_last_synced_at(&[]).await?.is_empty());
        assert!(
            service
                .assets(AssetsInput {
                    asset_type: None,
                    price_connectivity: None,
                    include_historical: None,
                    search: None,
                    investment_connectivity: None,
                })
                .await?
                .is_empty()
        );
        assert_eq!(
            service.quote(" vti ").await.unwrap_err().to_string(),
            "price provider unavailable"
        );

        let linked = service
            .link_real_estate(LinkRealEstateInput {
                street: Some("1 Main Street".to_owned()),
                city: Some("New York".to_owned()),
                state: Some("NY".to_owned()),
                zip: Some("10001".to_owned()),
                home_type: Some("Condo".to_owned()),
                owner_id: GlobalId::new(crate::ids::GlobalIdType::Owner, owner.id)
                    .encoded_string()
                    .into(),
                label: Some("Home".to_owned()),
                manual_valuation_usd: Cents(25_000),
            })
            .await?;
        let account = service
            .update_real_estate(UpdateRealEstateInput {
                connection_id: GlobalId::new(crate::ids::GlobalIdType::Connection, linked.connection.id)
                    .encoded_string()
                    .into(),
                name: Some("Updated Home".to_owned()),
                street: None,
                city: None,
                state: None,
                zip: None,
                home_type: None,
                valuation_usd: Some(Cents(30_000)),
            })
            .await?;
        assert_eq!(account.id, linked.account.id);
        assert_eq!(account.name, "Updated Home");
        assert!(
            service
                .unlink_real_estate(
                    GlobalId::new(crate::ids::GlobalIdType::Connection, linked.connection.id).encoded_string()
                )
                .await?
        );
        Ok(())
    }

    // A dated report must agree with the history point for that date: early
    // points forward-fill from the latest pre-range snapshot, and today's
    // point is the live position (closed accounts excluded).
    #[tokio::test]
    async fn focused_reports_match_the_history_series() -> Result<()> {
        let pool = dbtest::open().await?;
        let now = Utc::now();
        let old = now - Days::new(60);
        let stamp = |timestamp: chrono::DateTime<Utc>| timestamp.format("%Y-%m-%dT%H:%M:%SZ").to_string();
        sqlx::query("INSERT INTO owners (id, name) VALUES (1, 'Owner')")
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO accounts (id, external_id, owner_id, name, type, is_closed) VALUES (1, 'open', 1, 'Open', 'CHECKING', 0), (2, 'closed', 1, 'Closed', 'CHECKING', 1)")
            .execute(&pool)
            .await?;
        let asset_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO assets (asset_type, identifier, classifier) VALUES ('SECURITY', 'VTI', 'PUBLIC') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        sqlx::query("INSERT INTO account_balance_daily_snapshots (id, account_id, source, date, synced_at, balance_usd_cents, flagged) VALUES (1, 1, 'test', ?1, ?2, 20000, 0), (2, 2, 'test', ?3, ?4, 10000, 0)")
            .bind(old.format("%F").to_string())
            .bind(stamp(old))
            .bind(now.format("%F").to_string())
            .bind(stamp(now))
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO asset_daily_holdings (snapshot_id, account_id, date, asset_id, value_usd_cents) VALUES (1, 1, ?1, ?3, 20000), (2, 2, ?2, ?3, 10000)")
            .bind(old.format("%F").to_string())
            .bind(now.format("%F").to_string())
            .bind(asset_id)
            .execute(&pool)
            .await?;
        let service = WealthService::new(pool, None, || "UTC".to_owned());

        let history = service
            .historical_net_worth(
                AccountFilter::default(),
                NetWorthRange::OneMonth,
                Some(Granularity::Weekly),
            )
            .await?;
        let first = history.series.first().unwrap();
        let last = history.series.last().unwrap();
        assert_eq!(
            first.total_assets_usd,
            Cents(20000),
            "anchored from the pre-range snapshot"
        );
        assert_eq!(
            last.total_assets_usd,
            Cents(20000),
            "today is the live position without closed accounts"
        );
        assert_eq!(history.classifier_series[0].value_usd, Cents(20000));

        let focused_first = service
            .net_worth(AccountFilter::default(), Some(first.date.clone()))
            .await?;
        assert_eq!(focused_first.current_assets_usd, first.total_assets_usd);
        assert_eq!(focused_first.as_of_date.as_ref(), Some(&first.date));
        let focused_today = service
            .net_worth(AccountFilter::default(), Some(last.date.clone()))
            .await?;
        assert_eq!(focused_today.current_assets_usd, last.total_assets_usd);
        assert_eq!(focused_today.as_of_date.as_ref(), Some(&last.date));
        assert_eq!(
            service
                .net_worth(AccountFilter::default(), None)
                .await?
                .current_assets_usd,
            Cents(20000)
        );
        Ok(())
    }

    #[tokio::test]
    async fn rejects_wrong_global_ids_before_store_operations() -> Result<()> {
        let service = WealthService::new(dbtest::open().await?, None, || "UTC".to_owned());
        let owner_id: async_graphql::ID = GlobalId::new(crate::ids::GlobalIdType::Owner, 1)
            .encoded_string()
            .into();

        assert!(
            service
                .merge_asset(MergeAssetInput {
                    source_adapter: AssetSourceAdapter::Plaid,
                    source_id: "source".to_owned(),
                    asset_id: owner_id.clone(),
                })
                .await
                .is_err()
        );
        assert!(
            service
                .update_real_estate(UpdateRealEstateInput {
                    connection_id: owner_id.clone(),
                    name: None,
                    street: None,
                    city: None,
                    state: None,
                    zip: None,
                    home_type: None,
                    valuation_usd: None,
                })
                .await
                .is_err()
        );
        assert!(service.unlink_real_estate(owner_id).await.is_err());
        Ok(())
    }

    #[test]
    fn groups_classifiers_in_display_order_and_samples_full_days() {
        let breakdown = classifier_breakdown(
            vec![
                holding(1, AssetClassifier::Cash, 500),
                holding(1, AssetClassifier::Cash, 250),
                holding(2, AssetClassifier::Public, 250),
            ],
            Cents(1_000),
        );
        let dates = [
            New_York.with_ymd_and_hms(2026, 6, 19, 15, 30, 0).unwrap(),
            New_York.with_ymd_and_hms(2026, 6, 20, 15, 30, 0).unwrap(),
        ];

        assert_eq!(breakdown.len(), 2);
        assert_eq!(breakdown[0].classifier, AssetClassifier::Cash);
        assert_eq!(breakdown[0].asset_count, 1);
        assert_eq!(breakdown[0].percent_of_assets, 75.0);
        assert_eq!(breakdown[1].label, "Public Assets");
        assert_eq!(
            [
                AssetClassifier::Cash,
                AssetClassifier::Public,
                AssetClassifier::CompanyEquity,
                AssetClassifier::Cryptocurrency,
                AssetClassifier::Stablecoin,
                AssetClassifier::RealEstate,
            ]
            .map(classifier_label),
            [
                "Cash & Equivalents",
                "Public Assets",
                "Company Equity",
                "Cryptocurrency",
                "Stablecoin",
                "Real Estate",
            ]
        );
        assert_eq!(
            series_window(&dates),
            (
                "2026-06-19T04:00:00+00:00".to_owned(),
                "2026-06-21T04:00:00+00:00".to_owned()
            )
        );
    }

    fn holding(asset_id: i64, classifier: AssetClassifier, value_usd: i64) -> CurrentHolding {
        CurrentHolding {
            account: Account {
                id: asset_id,
                owner: Owner {
                    id: 1,
                    ..Default::default()
                },
                name: "Account".to_owned(),
                r#type: AccountType::Investment,
                subtype: None,
                mask: None,
                notes: None,
                closed: false,
                hidden: false,
                needs_review: false,
                manual: false,
                created_at: Utc::now(),
                updated_at: Utc::now(),
            },
            asset: Asset {
                id: asset_id,
                asset_type: AssetType::Security,
                identifier: format!("Asset {asset_id}"),
                name: None,
                classifier,
                current_price: None,
                forced_usd_price: None,
                tracking_ticker: None,
                tracking_multiplier: 1.0,
                price_connectivity: ConnectivityStatus::Healthy,
                investment_connectivity: ConnectivityStatus::Healthy,
            },
            quantity: Some(1.0),
            value_usd: Cents(value_usd),
            manual: false,
            snapshot_date: crate::ids::Date::new("2026-06-19").unwrap(),
        }
    }
}
