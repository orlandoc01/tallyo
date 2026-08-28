package wealthdb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"
	"tallyo/internal/wealth"

	"github.com/samber/lo"
)

func (s *Store) UpsertAsset(ctx context.Context, asset wealth.AssetUpsert) (*model.Asset, error) {
	var result *model.Asset
	if err := s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		upserted, err := upsertAsset(ctx, q, asset)
		if err != nil {
			return err
		}
		result = upserted
		return nil
	}); err != nil {
		return nil, err
	}
	return result, nil
}

// upsertAsset inserts or updates an asset row using the supplied queries handle,
// so callers can run it inside their own transaction (e.g. atomically with the
// holdings that reference it). User-edited rows keep their editable fields via
// the ON CONFLICT COALESCE in UpsertAssetRow.
func upsertAsset(ctx context.Context, q *dbgen.Queries, asset wealth.AssetUpsert) (*model.Asset, error) {
	multiplier := lo.Ternary(asset.TrackingMultiplier != 0, asset.TrackingMultiplier, 1)
	asset.TrackingTicker, asset.TrackingMultiplier = wealth.NormalizeTracking(asset.Identifier, asset.TrackingTicker, multiplier)

	if asset.AdapterSource != nil && asset.AdapterSource.SourceID != "" {
		assetID, err := q.AssetAdapterSourceAssetID(ctx, dbgen.AssetAdapterSourceAssetIDParams{
			SourceAdapter: asset.AdapterSource.Adapter.Str(),
			SourceID:      asset.AdapterSource.SourceID,
		})
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("lookup asset adapter source: %w", err)
		}
		if err == nil {
			if asset.AssetType == model.AssetTypeCrypto {
				existing, err := assetAdditionalByID(ctx, q, assetID)
				if err != nil {
					return nil, fmt.Errorf("read crypto asset additional: %w", err)
				}
				incoming, err := additionalFromUpsert(asset)
				if err != nil {
					return nil, err
				}
				if _, err := mergeAssetAdditional(ctx, q, assetID, asset.AssetType, existing, incoming); err != nil {
					return nil, err
				}
			}
			if asset.LastPrice != nil {
				lastPriceAt := lo.FromPtrOr(asset.LastPriceAt, time.Now()).UTC()
				if _, err := q.UpdateAssetPrice(ctx, dbgen.UpdateAssetPriceParams{LastPrice: asset.LastPrice, LastPriceAt: &lastPriceAt, ID: assetID}); err != nil {
					return nil, fmt.Errorf("update tracked asset price: %w", err)
				}
			}
			return assetByID(ctx, q, assetID)
		}
	}

	// If a row already exists and the user has manually edited it, strip the
	// user-editable fields so the ON CONFLICT COALESCE preserves them.
	assetType := string(asset.AssetType)
	existing, err := assetRow(ctx, q, dbgen.AssetsParams{AssetType: &assetType, Identifier: &asset.Identifier})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("lookup asset edit state: %w", err)
	}
	if err == nil && existing.Asset.UserEdited {
		asset.Name = nil
		asset.CUSIP = nil
		asset.ISIN = nil
	}
	additional, err := additionalFromUpsert(asset)
	if err != nil {
		return nil, err
	}

	upserted, err := q.UpsertAssetRow(ctx, dbgen.UpsertAssetRowParams{
		AssetType:          string(asset.AssetType),
		Identifier:         asset.Identifier,
		Name:               asset.Name,
		Classifier:         string(asset.Classifier),
		ForcedUsdPrice:     asset.ForcedUSDPrice,
		TrackingTicker:     asset.TrackingTicker,
		TrackingMultiplier: asset.TrackingMultiplier,
		Additional:         additional,
		UserEdited:         asset.UserEdited,
		UserCreated:        asset.UserCreated,
		LastPrice:          asset.LastPrice,
		LastPriceAt:        dbutil.UTCTimePtr(asset.LastPriceAt),
	})
	if err != nil {
		return nil, fmt.Errorf("upsert asset: %w", err)
	}
	mergedAdditional, err := mergeAssetAdditional(ctx, q, upserted.ID, asset.AssetType, upserted.Additional, additional)
	if err != nil {
		return nil, err
	}
	upserted.Additional = mergedAdditional
	if asset.AdapterSource != nil && asset.AdapterSource.SourceID != "" {
		if err := q.InsertAssetAdapterSource(ctx, dbgen.InsertAssetAdapterSourceParams{
			AssetID:       upserted.ID,
			SourceAdapter: asset.AdapterSource.Adapter.Str(),
			SourceID:      asset.AdapterSource.SourceID,
		}); err != nil {
			return nil, fmt.Errorf("insert asset adapter source: %w", err)
		}
	}
	return assetFromRow(upserted)
}

func mergeAssetAdditional(
	ctx context.Context,
	q *dbgen.Queries,
	assetID int64,
	assetType model.AssetType,
	existing *string,
	incoming *string,
) (*string, error) {
	merged, err := mergeAdditional(assetType, existing, incoming)
	if err != nil {
		return nil, err
	}
	if err := q.UpdateAssetAdditional(ctx, dbgen.UpdateAssetAdditionalParams{Additional: merged, ID: assetID}); err != nil {
		return nil, fmt.Errorf("update asset additional: %w", err)
	}
	return merged, nil
}

func (s *Store) UpdateAssetPrice(ctx context.Context, assetID int64, price float64, priceAt time.Time) error {
	priceAtUTC := priceAt.UTC()
	_, err := s.q.UpdateAssetPrice(ctx, dbgen.UpdateAssetPriceParams{LastPrice: &price, LastPriceAt: &priceAtUTC, ID: assetID})
	return err
}

func (s *Store) PersistAssetUpdate(ctx context.Context, update wealth.AssetUpdate) error {
	return s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		return applyAssetUpdate(ctx, q, update.AssetID, update)
	})
}

func (s *Store) UpdateAssetPriceConnectivity(ctx context.Context, assetID int64, status model.ConnectivityStatus) error {
	priceConnectivity := string(status)
	return s.q.UpdateAssetConnectivity(ctx, dbgen.UpdateAssetConnectivityParams{PriceConnectivity: &priceConnectivity, ID: assetID})
}

func (s *Store) UpdateAssetInvestmentConnectivity(ctx context.Context, assetID int64, status model.ConnectivityStatus) error {
	investmentConnectivity := string(status)
	return s.q.UpdateAssetConnectivity(ctx, dbgen.UpdateAssetConnectivityParams{InvestmentConnectivity: &investmentConnectivity, ID: assetID})
}

func (s *Store) AssetByID(ctx context.Context, id int64) (*model.Asset, error) {
	return assetByID(ctx, s.q, id)
}

func (s *Store) AssetByKey(ctx context.Context, assetType model.AssetType, identifier string) (*model.Asset, error) {
	asset, err := assetByKey(ctx, s.q, string(assetType), identifier)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return asset, err
}

func (s *Store) AssetsByIDs(ctx context.Context, ids []int64) (map[int64]*model.Asset, error) {
	if len(ids) == 0 {
		return map[int64]*model.Asset{}, nil
	}
	rows, err := s.q.Assets(ctx, dbgen.AssetsParams{Ids: ids})
	if err != nil {
		return nil, err
	}
	fromRow := func(row dbgen.AssetsRow) (*model.Asset, error) { return assetFromRow(row.Asset) }
	assets, err := u.MapErr(rows, fromRow)
	if err != nil {
		return nil, err
	}
	toID := func(asset *model.Asset) (int64, *model.Asset) { return asset.ID.Int64(), asset }
	return lo.Associate(assets, toID), nil
}

func assetByID(ctx context.Context, q *dbgen.Queries, id int64) (*model.Asset, error) {
	row, err := assetRow(ctx, q, dbgen.AssetsParams{ID: &id})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return assetFromRow(row.Asset)
}

func assetByKey(ctx context.Context, q *dbgen.Queries, assetType, identifier string) (*model.Asset, error) {
	row, err := assetRow(ctx, q, dbgen.AssetsParams{AssetType: &assetType, Identifier: &identifier})
	if err != nil {
		return nil, err
	}
	return assetFromRow(row.Asset)
}

func assetAdditionalByID(ctx context.Context, q *dbgen.Queries, id int64) (*string, error) {
	row, err := assetRow(ctx, q, dbgen.AssetsParams{ID: &id})
	return row.Asset.Additional, err
}

func assetRow(ctx context.Context, q *dbgen.Queries, params dbgen.AssetsParams) (dbgen.AssetsRow, error) {
	return dbutil.FirstRow(q.Assets(ctx, params))
}

func (s *Store) UpdateAsset(ctx context.Context, input model.UpdateAssetInput) (*model.Asset, error) {
	assetID := input.ID.Int64()
	existing, err := s.AssetByID(ctx, assetID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, fmt.Errorf("asset %d not found", assetID)
	}

	identifierChanged := input.Identifier != nil && *input.Identifier != existing.Identifier
	forcedPrice, err := updateAssetForcedPrice(input)
	if err != nil {
		return nil, err
	}
	effectiveTickerChanged := effectiveTickerChanged(existing, input)
	if err := s.WithTx(ctx, func(tx *sql.Tx, q *dbgen.Queries) error {
		if err := q.UpdateAssetBase(ctx, dbgen.UpdateAssetBaseParams{
			Name:                   input.Name,
			Identifier:             input.Identifier,
			Classifier:             nullableEnumString(input.Classifier),
			ForcedPriceSet:         forcedPrice.Set,
			ForcedPriceValue:       forcedPrice.Value,
			ForcedPriceClear:       forcedPrice.Clear,
			TrackingTicker:         input.TrackingTicker,
			TrackingMultiplier:     input.TrackingMultiplier,
			ClearMarketPrice:       identifierChanged,
			PriceConnectivity:      nullableEnumString(input.PriceConnectivity),
			EffectiveTickerChanged: effectiveTickerChanged,
			InvestmentConnectivity: nullableEnumString(input.InvestmentConnectivity),
			ID:                     assetID,
		}); err != nil {
			if dbutil.IsUniqueConstraintViolation(err) {
				return fmt.Errorf("an asset with identifier %q already exists for type %q", lo.FromPtrOr(input.Identifier, "<none>"), existing.AssetType)
			}
			return fmt.Errorf("update asset base: %w", err)
		}

		if effectiveTickerChanged {
			// A stale report can otherwise survive under the old ticker's
			// classification, or keep excluding the asset from portfolio
			// analysis after a prior NOT_FOUND connectivity is cleared above.
			if err := q.DeleteAssetAnalysisReportByAssetID(ctx, dbgen.DeleteAssetAnalysisReportByAssetIDParams{AssetID: assetID}); err != nil {
				return fmt.Errorf("delete stale asset analysis report: %w", err)
			}
		}

		return updateAssetAdditional(ctx, tx, assetID, existing.AssetType, input)
	}); err != nil {
		return nil, err
	}

	return s.AssetByID(ctx, assetID)
}

// effectiveTickerChanged reports whether this update changes the ticker
// portfolio sync uses to fetch analysis data (the tracking ticker, falling
// back to the identifier). An identifier edit alone does not change it while
// an unchanged custom tracker remains active.
func effectiveTickerChanged(existing *model.Asset, input model.UpdateAssetInput) bool {
	newIdentifier := lo.FromPtrOr(input.Identifier, existing.Identifier)
	newTicker := existing.TrackingTicker
	if input.TrackingTicker != nil {
		newTicker = lo.EmptyableToPtr(*input.TrackingTicker)
	}
	return effectivePortfolioTicker(existing.Identifier, existing.TrackingTicker) != effectivePortfolioTicker(newIdentifier, newTicker)
}

// effectivePortfolioTicker mirrors the trim/case normalization portfolio sync
// applies when resolving the ticker to fetch analysis data for (see
// internal/portfolio.ReportSyncer.syncAsset).
func effectivePortfolioTicker(identifier string, trackingTicker *string) string {
	ticker := strings.TrimSpace(strings.ToUpper(lo.FromPtr(trackingTicker)))
	return lo.Ternary(ticker != "", ticker, strings.TrimSpace(strings.ToUpper(identifier)))
}

type forcedPriceUpdate struct {
	Value *float64
	Set   bool
	Clear bool
}

func updateAssetForcedPrice(input model.UpdateAssetInput) (forcedPriceUpdate, error) {
	if input.ForcePrice == nil {
		return forcedPriceUpdate{Value: input.ForcedUsdPrice, Set: input.ForcedUsdPrice != nil}, nil
	}
	if !*input.ForcePrice {
		return forcedPriceUpdate{Clear: true}, nil
	}
	if input.ForcedUsdPrice == nil {
		return forcedPriceUpdate{}, errors.New("forcedUsdPrice is required when forcePrice is true")
	}
	return forcedPriceUpdate{Value: input.ForcedUsdPrice, Set: true}, nil
}

func nullableEnumString[T ~string](value *T) *string {
	if value == nil {
		return nil
	}
	converted := string(*value)
	return &converted
}

func updateAssetAdditional(ctx context.Context, tx *sql.Tx, assetID int64, assetType model.AssetType, input model.UpdateAssetInput) error {
	q := dbgen.New(tx)
	switch assetType {
	case model.AssetTypeSecurity:
		if input.Security == nil {
			return nil
		}
		existing, err := assetAdditionalByID(ctx, q, assetID)
		if err != nil {
			return fmt.Errorf("read security additional: %w", err)
		}
		incoming, err := marshalAdditional(SecurityAdditional{CUSIP: input.Security.Cusip, ISIN: input.Security.Isin})
		if err != nil {
			return err
		}
		merged, err := mergeAdditional(assetType, existing, incoming)
		if err != nil {
			return err
		}
		return q.UpdateAssetAdditional(ctx, dbgen.UpdateAssetAdditionalParams{Additional: merged, ID: assetID})
	case model.AssetTypeCrypto:
		// Crypto assets have no updatable fields via UpdateAssetInput —
		// the classifier on the assets table is the subtype, set directly.
		return nil
	default:
		return nil
	}
}

func (s *Store) RevalueLatestAssetHoldings(ctx context.Context, assetID int64, price float64) error {
	return s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		snapshotIDs, err := q.LatestSnapshotIDsForAsset(ctx, dbgen.LatestSnapshotIDsForAssetParams{AssetID: assetID})
		if err != nil {
			return fmt.Errorf("list latest snapshots for asset: %w", err)
		}
		if len(snapshotIDs) == 0 {
			return nil
		}
		if err := q.RevalueAssetHoldingsBySnapshotIDs(ctx, dbgen.RevalueAssetHoldingsBySnapshotIDsParams{
			Price:       &price,
			AssetID:     assetID,
			SnapshotIds: snapshotIDs,
		}); err != nil {
			return fmt.Errorf("revalue latest holdings: %w", err)
		}
		if err := q.RecalculateSnapshotBalancesByIDs(ctx, dbgen.RecalculateSnapshotBalancesByIDsParams{SnapshotIds: snapshotIDs}); err != nil {
			return fmt.Errorf("recalculate latest snapshot balances: %w", err)
		}
		return nil
	})
}

// SweepUnreferencedAssets deletes catalog rows that nothing references and the
// user never edited (any type — see DeleteUnreferencedAssets). It returns the
// number of assets removed. Intended as a periodic, type-agnostic fallback that
// cleans up junk a provider sync left behind. Held, manually tracked, analyzed,
// and user-edited assets are preserved.
func (s *Store) SweepUnreferencedAssets(ctx context.Context) (int64, error) {
	return s.q.DeleteUnreferencedAssets(ctx)
}
