use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use sqlx::{Executor, Sqlite};

use crate::{
    database::{Timestamp, queries},
    portfolio::types::AssetStub,
};

pub(crate) async fn public_assets_needing_report(
    executor: impl Executor<'_, Database = Sqlite>,
    older_than: DateTime<Utc>,
) -> Result<Vec<AssetStub>> {
    queries::public_assets_for_analysis_report(
        executor,
        queries::PublicAssetsForAnalysisReportParams {
            older_than: Timestamp::from(older_than),
        },
    )
    .await?
    .into_iter()
    .map(TryInto::try_into)
    .collect()
}

impl TryFrom<queries::PublicAssetsForAnalysisReportRow> for AssetStub {
    type Error = anyhow::Error;

    fn try_from(row: queries::PublicAssetsForAnalysisReportRow) -> Result<Self> {
        Ok(Self {
            id: row.id,
            identifier: row.identifier,
            tracking_ticker: row.tracking_ticker,
            investment_connectivity: row
                .investment_connectivity
                .parse()
                .with_context(|| format!("parse investment connectivity {:?}", row.investment_connectivity))?,
        })
    }
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::public_assets_needing_report;
    use crate::{database::dbtest, schema::ConnectivityStatus};

    #[tokio::test]
    async fn returns_only_public_assets_with_stale_reports() -> Result<()> {
        let pool = dbtest::open().await?;
        sqlx::query(
            "INSERT INTO assets (asset_type, identifier, classifier) VALUES ('SECURITY', 'VTI', 'PUBLIC'), ('SECURITY', 'CASH', 'CASH')",
        )
        .execute(&pool)
        .await?;

        let assets = public_assets_needing_report(&pool, "2026-09-06T12:00:00Z".parse()?).await?;

        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0].identifier, "VTI");
        assert_eq!(assets[0].investment_connectivity, ConnectivityStatus::Healthy);
        Ok(())
    }
}
