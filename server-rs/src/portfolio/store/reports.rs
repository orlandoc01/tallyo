use std::collections::HashMap;

use anyhow::Result;
use sqlx::{Executor, Sqlite};

use crate::{database::queries, portfolio::types::AssetReport};

pub(crate) async fn upsert_report(executor: impl Executor<'_, Database = Sqlite>, report: &AssetReport) -> Result<()> {
    queries::upsert_asset_analysis_report(
        executor,
        queries::UpsertAssetAnalysisReportParams {
            asset_id: report.asset_id,
            category: &report.category,
            group_name: &report.group_name,
            cash_position: report.cash_position,
            stock_position: report.stock_position,
            bond_position: report.bond_position,
            preferred_position: report.preferred_position,
            convertible_position: report.convertible_position,
            other_position: report.other_position,
            sector_real_estate: report.sector_real_estate,
            sector_consumer_cyclical: report.sector_consumer_cyclical,
            sector_basic_materials: report.sector_basic_materials,
            sector_consumer_defensive: report.sector_consumer_defensive,
            sector_technology: report.sector_technology,
            sector_communication_services: report.sector_communication_services,
            sector_financial_services: report.sector_financial_services,
            sector_utilities: report.sector_utilities,
            sector_industrials: report.sector_industrials,
            sector_energy: report.sector_energy,
            sector_healthcare: report.sector_healthcare,
            equity_sector: report.equity_sector.as_deref(),
            fetched_at: report.fetched_at,
        },
    )
    .await
    .map_err(Into::into)
}

pub(crate) async fn reports_by_asset_ids(
    executor: impl Executor<'_, Database = Sqlite>,
    asset_ids: &[i64],
) -> Result<HashMap<i64, AssetReport>> {
    if asset_ids.is_empty() {
        return Ok(HashMap::new());
    }
    Ok(queries::asset_analysis_reports_by_asset_ids(
        executor,
        queries::AssetAnalysisReportsByAssetIDsParams { asset_ids },
    )
    .await?
    .into_iter()
    .map(|row| {
        let report = row.asset_analysis_reports;
        (report.asset_id, report)
    })
    .collect())
}

#[cfg(test)]
mod tests {
    use anyhow::Result;

    use super::{reports_by_asset_ids, upsert_report};
    use crate::{clients::yfinance::FundReport, database::dbtest, portfolio::types::AssetReport};

    #[tokio::test]
    async fn upserts_and_reads_asset_reports() -> Result<()> {
        let pool = dbtest::open().await?;
        let asset_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO assets (asset_type, identifier, classifier) VALUES ('SECURITY', 'VTI', 'PUBLIC') RETURNING id",
        )
        .fetch_one(&pool)
        .await?;
        let report = AssetReport::from((
            asset_id,
            "2026-09-06T12:00:00Z".parse()?,
            FundReport {
                category: "Large Blend".to_owned(),
                group: "US Equity".to_owned(),
                stock_position: 1.0,
                sector_technology: 0.25,
                ..Default::default()
            },
        ));

        upsert_report(&pool, &report).await?;
        let reports = reports_by_asset_ids(&pool, &[asset_id]).await?;

        assert!(reports_by_asset_ids(&pool, &[]).await?.is_empty());
        assert_eq!(reports[&asset_id].category, "Large Blend");
        assert_eq!(reports[&asset_id].sector_technology, 0.25);
        assert_eq!(reports[&asset_id].fetched_at, report.fetched_at);
        Ok(())
    }
}
