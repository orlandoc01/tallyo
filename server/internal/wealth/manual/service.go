package manual

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

// Service carries manual snapshot rows through balance sync runs.
type Service struct {
	Store  Store
	Prices wealth.PriceProvider
	Log    *slog.Logger
}

func (s *Service) SeedInitialSnapshot(ctx context.Context, account *model.Account) error {
	accountID := account.ID.Int64()
	now := time.Now().UTC()
	date := now.Format(time.DateOnly)
	return s.Store.PersistSnapshot(ctx, wealth.SnapshotPersist{
		Snapshot: wealth.AccountBalanceSnapshot{
			AccountID:  accountID,
			Source:     syncerids.Manual.Str(),
			Date:       date,
			SyncedAt:   now.Format(time.RFC3339),
			BalanceUSD: 0,
			Holdings:   []wealth.AssetDailyHolding{},
			Flagged:    false,
		},
		SyncedAt: now,
	})
}

func (s *Service) emitManualSnapshots(ctx context.Context, sink wealth.PersistSink) error {
	accountIDs, err := s.Store.ManualSnapshotAccountIDs(ctx)
	if err != nil {
		return fmt.Errorf("list manual snapshot accounts: %w", err)
	}
	if err := wealth.WithPersist(ctx, sink, func(events chan<- wealth.PersistEvent) error {
		for _, accountID := range accountIDs {
			if err := s.snapshotManualAccount(ctx, accountID, sink, events); err != nil {
				s.Log.Error("snapshot manual account failed", "account_id", accountID, "error", err)
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("persist manual account snapshots: %w", err)
	}
	return nil
}

func (s *Service) snapshotManualAccount(
	ctx context.Context,
	accountID int64,
	sink wealth.PersistSink,
	events chan<- wealth.PersistEvent,
) error {
	latest, err := s.Store.LatestAccountBalanceSnapshotForAccount(ctx, accountID)
	if err != nil {
		return fmt.Errorf("latest snapshot: %w", err)
	}
	if latest == nil {
		return nil
	}
	holdings, err := s.Store.SnapshotHoldingsBySnapshotID(ctx, latest.ID)
	if err != nil {
		return fmt.Errorf("latest holdings: %w", err)
	}
	snapshot := carryForwardManualSnapshot(ctx, latest, holdings, s.Prices, sink.Today(), sink.Now())
	draft := wealth.SnapshotDraft{
		AccountBalanceSnapshot: snapshot,
		Decision:               wealth.DecisionClean,
	}
	events <- wealth.PersistEvent{Snapshot: &draft}
	return nil
}

func carryForwardManualSnapshot(
	ctx context.Context,
	latest *wealth.SnapshotRow,
	holdings []wealth.SnapshotHolding,
	prices wealth.PriceProvider,
	date string,
	now time.Time,
) wealth.AccountBalanceSnapshot {
	if len(holdings) == 0 {
		return wealth.AccountBalanceSnapshot{
			AccountID:  latest.AccountID,
			Source:     latest.Source,
			Date:       date,
			SyncedAt:   now.Format(time.RFC3339),
			BalanceUSD: latest.BalanceUSD,
			Holdings:   []wealth.AssetDailyHolding{},
			Flagged:    false,
		}
	}
	dailyHoldings := make([]wealth.AssetDailyHolding, 0, len(holdings))
	totalBalance := 0.0
	for _, holding := range holdings {
		quantity := holding.Quantity
		price := resolvePrice(ctx, holding.Asset, prices, now)
		pricePtr := holding.Price
		valueUSD := holding.ValueUSD.Dollars()
		if price > 0 {
			pricePtr = &price
			if quantity != nil {
				valueUSD = *quantity * price
			}
		}
		if holding.CountsTowardValue {
			totalBalance += valueUSD
		}
		dailyHoldings = append(dailyHoldings, wealth.AssetDailyHolding{
			AssetID:           holding.Asset.ID.Int64(),
			Quantity:          quantity,
			Price:             pricePtr,
			ValueUSD:          valueUSD,
			CountsTowardValue: holding.CountsTowardValue,
			Manual:            holding.Manual,
		})
	}
	return wealth.AccountBalanceSnapshot{
		AccountID:  latest.AccountID,
		Source:     latest.Source,
		Date:       date,
		SyncedAt:   now.Format(time.RFC3339),
		BalanceUSD: money.FromDollars(totalBalance),
		Holdings:   dailyHoldings,
		Flagged:    false,
	}
}

// resolvePrice returns the price for an asset: forced_usd_price (if set) → live
// provider price → last known price. The forced price bypasses the non-positive guard.
func resolvePrice(ctx context.Context, asset *model.Asset, prices wealth.PriceProvider, now time.Time) float64 {
	if asset.ForcedUsdPrice != nil {
		return *asset.ForcedUsdPrice
	}
	if asset.AssetType == model.AssetTypeSecurity {
		if price, err := prices.PriceAt(ctx, asset, now); err == nil && price > 0 {
			return price
		}
	}
	if asset.CurrentPrice != nil {
		return *asset.CurrentPrice
	}
	return 0
}
