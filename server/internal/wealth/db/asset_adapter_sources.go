package wealthdb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/samber/lo"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/graph/model"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

func (s *Store) AssetAdapterSourcesByAssetIDs(ctx context.Context, assetIDs []int64) (map[int64][]*model.AssetAdapterSource, error) {
	rows, err := s.q.AssetAdapterSourcesByAssetIDs(ctx, dbgen.AssetAdapterSourcesByAssetIDsParams{AssetIds: assetIDs})
	if err != nil {
		return nil, fmt.Errorf("list asset adapter sources: %w", err)
	}

	toSourceByAssetID := func(row dbgen.AssetAdapterSourcesByAssetIDsRow) (int64, *model.AssetAdapterSource) {
		return row.AssetID, &model.AssetAdapterSource{
			SourceAdapter: wealth.SourceAdapterFromSyncerID(syncerids.ID(row.SourceAdapter)),
			SourceID:      row.SourceID,
		}
	}
	return lo.GroupByMap(rows, toSourceByAssetID), nil
}

func (s *Store) AssetByAdapterSource(ctx context.Context, source wealth.AdapterSource) (*model.Asset, error) {
	assetID, err := s.q.AssetAdapterSourceAssetID(ctx, dbgen.AssetAdapterSourceAssetIDParams{
		SourceAdapter: source.Adapter.Str(),
		SourceID:      source.SourceID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lookup adapter source: %w", err)
	}
	return assetByID(ctx, s.q, assetID)
}

func (s *Store) MergeAssetBySource(ctx context.Context, adapter syncerids.ID, sourceID string, targetAssetID int64) (*model.Asset, error) {
	var result *model.Asset
	if err := s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		duplicateAssetID, err := q.AssetAdapterSourceAssetID(ctx, dbgen.AssetAdapterSourceAssetIDParams{
			SourceAdapter: adapter.Str(),
			SourceID:      sourceID,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("no such adapter source %s:%s", adapter, sourceID)
		}
		if err != nil {
			return fmt.Errorf("lookup adapter source: %w", err)
		}
		if duplicateAssetID == targetAssetID {
			result, err = assetByID(ctx, q, targetAssetID)
			return err
		}

		duplicate, err := assetByID(ctx, q, duplicateAssetID)
		if err != nil {
			return err
		}
		if duplicate == nil {
			return fmt.Errorf("asset %d not found", duplicateAssetID)
		}

		target, err := assetByID(ctx, q, targetAssetID)
		if err != nil {
			return err
		}
		if target == nil {
			return fmt.Errorf("asset %d not found", targetAssetID)
		}
		if duplicate.AssetType != target.AssetType {
			return fmt.Errorf("cannot merge %s asset %d into %s asset %d", duplicate.AssetType, duplicateAssetID, target.AssetType, targetAssetID)
		}

		hasCollision, err := q.AssetMergeCollisionExists(ctx, dbgen.AssetMergeCollisionExistsParams{
			DuplicateAssetID: duplicateAssetID,
			TargetAssetID:    targetAssetID,
		})
		if err != nil {
			return fmt.Errorf("check asset merge collision: %w", err)
		}
		if hasCollision {
			return fmt.Errorf("cannot merge assets %d and %d because a snapshot or account/date holds both", duplicateAssetID, targetAssetID)
		}

		params := dbgen.UpdateAssetDailyHoldingsAssetIDParams{
			DuplicateAssetID: duplicateAssetID,
			TargetAssetID:    targetAssetID,
		}
		if err := q.UpdateAssetDailyHoldingsAssetID(ctx, params); err != nil {
			return fmt.Errorf("move asset holdings: %w", err)
		}
		if err := q.MoveAssetAnalysisReport(ctx, dbgen.MoveAssetAnalysisReportParams(params)); err != nil {
			return fmt.Errorf("move asset analysis report: %w", err)
		}
		if err := q.MoveAssetAdapterSources(ctx, dbgen.MoveAssetAdapterSourcesParams(params)); err != nil {
			return fmt.Errorf("move asset adapter sources: %w", err)
		}
		if err := q.DeleteAssetByID(ctx, dbgen.DeleteAssetByIDParams{ID: duplicateAssetID}); err != nil {
			return fmt.Errorf("delete duplicate asset: %w", err)
		}

		result = target
		return nil
	}); err != nil {
		return nil, err
	}
	return result, nil
}
