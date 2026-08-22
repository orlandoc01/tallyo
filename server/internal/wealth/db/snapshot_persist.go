package wealthdb

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/samber/lo"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/money"
	"tallyo/internal/wealth"
)

func (s *Store) ReplaceAccountBalanceSnapshot(ctx context.Context, snapshot wealth.AccountBalanceSnapshot) error {
	return s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		_, err := s.replaceAccountBalanceSnapshot(ctx, q, snapshot)
		return err
	})
}

func (s *Store) PersistSnapshot(ctx context.Context, persist wealth.SnapshotPersist) error {
	return s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		return s.persistSnapshot(ctx, q, persist)
	})
}

func (s *Store) persistSnapshot(ctx context.Context, q *dbgen.Queries, persist wealth.SnapshotPersist) error {
	replaced, err := s.replaceAccountBalanceSnapshot(ctx, q, persist.Snapshot)
	if err != nil {
		return err
	}
	if !replaced.inserted {
		return markAccountBalanceSynced(ctx, q, persist.Snapshot.AccountID, persist.SyncedAt)
	}
	if persist.ProviderState != nil {
		if err := insertSnapshotProviderState(ctx, q, replaced.snapshotID, *persist.ProviderState); err != nil {
			return err
		}
	}
	if persist.Recovery != nil {
		if err := validateSnapshotDate("recovery after date", persist.Recovery.AfterDate); err != nil {
			return err
		}
		if err := validateSnapshotDate("recovery before date", persist.Recovery.BeforeDate); err != nil {
			return err
		}
		if err := q.UnflagSnapshotsBetweenDates(ctx, dbgen.UnflagSnapshotsBetweenDatesParams{
			AccountID:  persist.Recovery.AccountID,
			AfterDate:  persist.Recovery.AfterDate,
			BeforeDate: persist.Recovery.BeforeDate,
			Inclusive:  false,
		}); err != nil {
			return fmt.Errorf("unflag recovered snapshots: %w", err)
		}
		if err := q.DeleteSnapshotProviderStatesBetweenDates(ctx, dbgen.DeleteSnapshotProviderStatesBetweenDatesParams{
			AccountID:  persist.Recovery.AccountID,
			AfterDate:  &persist.Recovery.AfterDate,
			BeforeDate: &persist.Recovery.BeforeDate,
			Inclusive:  false,
		}); err != nil {
			return fmt.Errorf("delete recovered provider states: %w", err)
		}
	}
	if persist.ExpireReview {
		if err := q.DeleteBalanceReviewsByAccountID(ctx, dbgen.DeleteBalanceReviewsByAccountIDParams{AccountID: persist.Snapshot.AccountID}); err != nil {
			return fmt.Errorf("delete clean balance review: %w", err)
		}
		if err := q.DeleteSnapshotProviderStatesBetweenDates(ctx, dbgen.DeleteSnapshotProviderStatesBetweenDatesParams{AccountID: persist.Snapshot.AccountID}); err != nil {
			return fmt.Errorf("delete clean provider states: %w", err)
		}
	}
	if persist.Review != nil {
		reviewID, err := upsertBalanceReview(ctx, q, *persist.Review)
		if err != nil {
			return fmt.Errorf("upsert balance review: %w", err)
		}
		if err := q.RecountBalanceReviewFlaggedSnapshots(ctx, dbgen.RecountBalanceReviewFlaggedSnapshotsParams{ID: reviewID}); err != nil {
			return fmt.Errorf("recount flagged snapshots: %w", err)
		}
	}
	if err := markAccountBalanceSynced(ctx, q, persist.Snapshot.AccountID, persist.SyncedAt); err != nil {
		return fmt.Errorf("mark balance synced: %w", err)
	}
	return nil
}

type snapshotReplaceResult struct {
	snapshotID int64
	inserted   bool
}

func (s *Store) replaceAccountBalanceSnapshot(
	ctx context.Context,
	q *dbgen.Queries,
	snapshot wealth.AccountBalanceSnapshot,
) (snapshotReplaceResult, error) {
	closed, err := q.AccountIsClosed(ctx, dbgen.AccountIsClosedParams{ID: snapshot.AccountID})
	if err != nil {
		return snapshotReplaceResult{}, fmt.Errorf("load snapshot account: %w", err)
	}
	if closed {
		s.Log.Debug(
			"skip closed account balance snapshot",
			"account_id",
			snapshot.AccountID,
			"source",
			snapshot.Source,
			"date",
			snapshot.Date,
		)
		return snapshotReplaceResult{}, nil
	}
	syncedAt, err := parseSnapshotTimestamp("account balance snapshot synced_at", snapshot.SyncedAt)
	if err != nil {
		return snapshotReplaceResult{}, err
	}
	flagReason := lo.EmptyableToPtr(snapshot.FlagReason)
	snapshotID, err := q.InsertAccountBalanceSnapshot(ctx, dbgen.InsertAccountBalanceSnapshotParams{
		AccountID:       snapshot.AccountID,
		Source:          snapshot.Source,
		Date:            snapshot.Date,
		SyncedAt:        syncedAt,
		BalanceUsdCents: snapshot.BalanceUSD,
		RawPayload:      snapshot.RawPayload,
		Flagged:         snapshot.Flagged,
		FlagReason:      flagReason,
	})
	if err != nil {
		return snapshotReplaceResult{}, fmt.Errorf("insert account balance snapshot: %w", err)
	}
	for _, holding := range snapshot.Holdings {
		assetID := holding.AssetID
		if holding.Asset != nil {
			asset, err := upsertAsset(ctx, q, *holding.Asset)
			if err != nil {
				return snapshotReplaceResult{}, fmt.Errorf("upsert holding asset: %w", err)
			}
			assetID = asset.ID.Int64()
			if holding.PriceUpdate != nil {
				if err := applyAssetUpdate(ctx, q, assetID, *holding.PriceUpdate); err != nil {
					return snapshotReplaceResult{}, fmt.Errorf("persist holding asset update: %w", err)
				}
			}
		}
		if err := q.InsertAssetDailyHolding(ctx, dbgen.InsertAssetDailyHoldingParams{
			SnapshotID:        snapshotID,
			AccountID:         snapshot.AccountID,
			Date:              snapshot.Date,
			AssetID:           assetID,
			Quantity:          holding.Quantity,
			Price:             holding.Price,
			ValueUsdCents:     money.FromDollars(holding.ValueUSD),
			CountsTowardValue: holding.CountsTowardValue,
			Manual:            holding.Manual,
		}); err != nil {
			return snapshotReplaceResult{}, fmt.Errorf("insert asset holding %d: %w", assetID, err)
		}
	}
	return snapshotReplaceResult{snapshotID: snapshotID, inserted: true}, nil
}

func insertSnapshotProviderState(
	ctx context.Context,
	q *dbgen.Queries,
	snapshotID int64,
	state wealth.SnapshotProviderState,
) error {
	if err := q.InsertSnapshotProviderState(ctx, dbgen.InsertSnapshotProviderStateParams{
		SnapshotID:              snapshotID,
		ProviderBalanceUsdCents: state.ProviderBalanceUSD,
		ProviderHoldingsJson:    state.ProviderHoldingsJSON,
	}); err != nil {
		return fmt.Errorf("insert snapshot provider state: %w", err)
	}
	return nil
}

func applyAssetUpdate(ctx context.Context, q *dbgen.Queries, assetID int64, update wealth.AssetUpdate) error {
	priceAtUTC := update.PriceAt.UTC()
	updated, err := q.UpdateAssetPrice(ctx, dbgen.UpdateAssetPriceParams{LastPrice: &update.Price, LastPriceAt: &priceAtUTC, ID: assetID})
	if err != nil {
		return fmt.Errorf("update asset price: %w", err)
	}
	if update.TrackingMultiplier != nil && updated > 0 {
		if err := q.UpdateAssetTrackingMultiplier(ctx, dbgen.UpdateAssetTrackingMultiplierParams{ID: assetID, TrackingMultiplier: *update.TrackingMultiplier}); err != nil {
			return fmt.Errorf("update asset tracking multiplier: %w", err)
		}
	}
	return nil
}
