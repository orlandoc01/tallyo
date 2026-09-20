-- Used by internal/portfolio's background backfill/sync job (internal/portfolio/sync.go) to store fund/equity composition and sector data fetched from Morningstar.
-- name: UpsertAssetAnalysisReport :exec
INSERT INTO asset_analysis_reports (
  asset_id,
  category,
  group_name,
  cash_position,
  stock_position,
  bond_position,
  preferred_position,
  convertible_position,
  other_position,
  sector_real_estate,
  sector_consumer_cyclical,
  sector_basic_materials,
  sector_consumer_defensive,
  sector_technology,
  sector_communication_services,
  sector_financial_services,
  sector_utilities,
  sector_industrials,
  sector_energy,
  sector_healthcare,
  equity_sector,
  fetched_at
) VALUES (
  @asset_id,
  @category,
  @group_name,
  @cash_position,
  @stock_position,
  @bond_position,
  @preferred_position,
  @convertible_position,
  @other_position,
  @sector_real_estate,
  @sector_consumer_cyclical,
  @sector_basic_materials,
  @sector_consumer_defensive,
  @sector_technology,
  @sector_communication_services,
  @sector_financial_services,
  @sector_utilities,
  @sector_industrials,
  @sector_energy,
  @sector_healthcare,
  @equity_sector,
  @fetched_at
)
ON CONFLICT(asset_id) DO UPDATE SET
  category = excluded.category,
  group_name = excluded.group_name,
  cash_position = excluded.cash_position,
  stock_position = excluded.stock_position,
  bond_position = excluded.bond_position,
  preferred_position = excluded.preferred_position,
  convertible_position = excluded.convertible_position,
  other_position = excluded.other_position,
  sector_real_estate = excluded.sector_real_estate,
  sector_consumer_cyclical = excluded.sector_consumer_cyclical,
  sector_basic_materials = excluded.sector_basic_materials,
  sector_consumer_defensive = excluded.sector_consumer_defensive,
  sector_technology = excluded.sector_technology,
  sector_communication_services = excluded.sector_communication_services,
  sector_financial_services = excluded.sector_financial_services,
  sector_utilities = excluded.sector_utilities,
  sector_industrials = excluded.sector_industrials,
  sector_energy = excluded.sector_energy,
  sector_healthcare = excluded.sector_healthcare,
  equity_sector = excluded.equity_sector,
  fetched_at = excluded.fetched_at;

-- Used by internal/portfolio to resolve analysis reports for a set of assets when building the GraphQL analysis (portfolio.graphql) response.
-- name: AssetAnalysisReportsByAssetIDs :many
SELECT sqlc.embed(r)
FROM asset_analysis_reports r
WHERE r.asset_id IN (sqlc.slice('asset_ids'));

-- Used by internal/portfolio's background sync job to find public securities that are missing an analysis report or whose report has gone stale.
-- name: PublicAssetsForAnalysisReport :many
SELECT assets.id, assets.identifier, assets.tracking_ticker, assets.investment_connectivity
FROM assets
LEFT JOIN asset_analysis_reports r ON r.asset_id = assets.id
WHERE assets.asset_type = 'SECURITY'
  AND assets.classifier = 'PUBLIC'
  AND assets.investment_connectivity NOT IN ('IGNORE', 'NOT_FOUND')
  AND (r.asset_id IS NULL OR r.fetched_at < @older_than)
ORDER BY assets.identifier;
