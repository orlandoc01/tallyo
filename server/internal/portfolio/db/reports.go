package portfoliodb

import (
	"context"
	"time"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/portfolio"
)

func (s *Store) UpsertReport(ctx context.Context, report portfolio.AssetReport) error {
	fetchedAt := report.FetchedAt.UTC()
	if report.FetchedAt.IsZero() {
		fetchedAt = time.Now().UTC()
	}
	return s.q.UpsertAssetAnalysisReport(ctx, dbgen.UpsertAssetAnalysisReportParams{
		AssetID:                     report.AssetID,
		Category:                    report.Category,
		GroupName:                   report.Group,
		CashPosition:                report.CashPosition,
		StockPosition:               report.StockPosition,
		BondPosition:                report.BondPosition,
		PreferredPosition:           report.PreferredPosition,
		ConvertiblePosition:         report.ConvertiblePosition,
		OtherPosition:               report.OtherPosition,
		SectorRealEstate:            report.SectorRealEstate,
		SectorConsumerCyclical:      report.SectorConsumerCyclical,
		SectorBasicMaterials:        report.SectorBasicMaterials,
		SectorConsumerDefensive:     report.SectorConsumerDefensive,
		SectorTechnology:            report.SectorTechnology,
		SectorCommunicationServices: report.SectorCommunicationServices,
		SectorFinancialServices:     report.SectorFinancialServices,
		SectorUtilities:             report.SectorUtilities,
		SectorIndustrials:           report.SectorIndustrials,
		SectorEnergy:                report.SectorEnergy,
		SectorHealthcare:            report.SectorHealthcare,
		EquitySector:                report.EquitySector,
		FetchedAt:                   fetchedAt,
	})
}

func (s *Store) ReportsByAssetIDs(ctx context.Context, assetIDs []int64) (map[int64]portfolio.AssetReport, error) {
	if len(assetIDs) == 0 {
		return map[int64]portfolio.AssetReport{}, nil
	}
	rows, err := s.q.AssetAnalysisReportsByAssetIDs(ctx, dbgen.AssetAnalysisReportsByAssetIDsParams{AssetIds: assetIDs})
	toReportByAssetID := func(row dbgen.AssetAnalysisReportsByAssetIDsRow) (int64, portfolio.AssetReport) {
		report := reportFromRow(row.AssetAnalysisReport)
		return report.AssetID, report
	}
	return dbutil.AssociateRows(rows, err, toReportByAssetID)
}

func reportFromRow(row dbgen.AssetAnalysisReport) portfolio.AssetReport {
	return portfolio.AssetReport{
		AssetID:                     row.AssetID,
		Category:                    row.Category,
		Group:                       row.GroupName,
		CashPosition:                row.CashPosition,
		StockPosition:               row.StockPosition,
		BondPosition:                row.BondPosition,
		PreferredPosition:           row.PreferredPosition,
		ConvertiblePosition:         row.ConvertiblePosition,
		OtherPosition:               row.OtherPosition,
		SectorRealEstate:            row.SectorRealEstate,
		SectorConsumerCyclical:      row.SectorConsumerCyclical,
		SectorBasicMaterials:        row.SectorBasicMaterials,
		SectorConsumerDefensive:     row.SectorConsumerDefensive,
		SectorTechnology:            row.SectorTechnology,
		SectorCommunicationServices: row.SectorCommunicationServices,
		SectorFinancialServices:     row.SectorFinancialServices,
		SectorUtilities:             row.SectorUtilities,
		SectorIndustrials:           row.SectorIndustrials,
		SectorEnergy:                row.SectorEnergy,
		SectorHealthcare:            row.SectorHealthcare,
		EquitySector:                row.EquitySector,
		FetchedAt:                   row.FetchedAt,
	}
}
