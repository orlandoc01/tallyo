use anyhow::Result;
use sqlx::{Executor, Sqlite};

use crate::{
    database::queries,
    portfolio::{AnalysisHolding, HoldingsFilter},
    schema::AssetClassifier,
    wealth::Asset,
};

pub(crate) async fn current_public_holdings(
    executor: impl Executor<'_, Database = Sqlite>,
    filter: &HoldingsFilter,
) -> Result<Vec<AnalysisHolding>> {
    let classifier = AssetClassifier::Public.to_string();
    queries::list_current_account_holdings(
        executor,
        queries::ListCurrentAccountHoldingsParams {
            owner_ids: optional_slice(&filter.owner_ids),
            account_ids: optional_slice(&filter.account_ids),
            account_subtypes: optional_slice(&filter.account_subtypes),
            classifier: Some(&classifier),
            classified_only: !filter.include_unclassified,
            ..Default::default()
        },
    )
    .await?
    .into_iter()
    .map(TryInto::try_into)
    .collect()
}

impl TryFrom<queries::ListCurrentAccountHoldingsRow> for AnalysisHolding {
    type Error = anyhow::Error;

    fn try_from(row: queries::ListCurrentAccountHoldingsRow) -> Result<Self> {
        Ok(Self {
            asset: Asset::try_from(row.assets)?,
            value_usd: row.value_usd_cents,
            percent: 0.0,
        })
    }
}

fn optional_slice<T>(values: &[T]) -> Option<&[T]> {
    (!values.is_empty()).then_some(values)
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::current_public_holdings;
    use crate::{database::dbtest, portfolio::HoldingsFilter};

    #[tokio::test]
    async fn filters_and_maps_current_public_holdings() -> Result<()> {
        let pool = dbtest::open().await?;
        sqlx::query("INSERT INTO owners (id, name) VALUES (1, 'Owner')")
            .execute(&pool)
            .await?;
        sqlx::query(
            "INSERT INTO accounts (id, external_id, owner_id, name, type, subtype) VALUES (1, 'invest', 1, 'Invest', 'INVESTMENT', '401k')",
        )
        .execute(&pool)
        .await?;
        let asset_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO assets (asset_type, identifier, classifier) VALUES ('SECURITY', 'VTI', 'PUBLIC') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        sqlx::query(
            "INSERT INTO account_balance_daily_snapshots (account_id, source, date, synced_at, balance_usd_cents, flagged) VALUES (1, 'test', '2026-09-06', '2026-09-06T12:00:00Z', 10000, 0)",
        )
        .execute(&pool)
        .await?;
        sqlx::query(
            "INSERT INTO asset_daily_holdings (snapshot_id, account_id, date, asset_id, value_usd_cents) VALUES (1, 1, '2026-09-06', ?, 10000)",
        )
        .bind(asset_id)
        .execute(&pool)
        .await?;

        let holdings = current_public_holdings(
            &pool,
            &HoldingsFilter {
                owner_ids: vec![1],
                account_subtypes: vec!["401k".to_owned()],
                account_ids: vec![1],
                include_unclassified: true,
            },
        )
        .await?;

        assert_eq!(holdings.len(), 1);
        assert_eq!(holdings[0].asset.id, asset_id);
        assert_eq!(holdings[0].asset.identifier, "VTI");
        assert_eq!(holdings[0].value_usd.0, 10000);
        assert!(
            current_public_holdings(
                &pool,
                &HoldingsFilter {
                    owner_ids: vec![999],
                    ..Default::default()
                },
            )
            .await?
            .is_empty()
        );
        Ok(())
    }
}
