package wealthdb

import (
	"context"
	"time"

	"github.com/samber/lo"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/money"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

func (s *Store) LatestUnflaggedSnapshotWithHoldings(ctx context.Context, accountID int64, date string) (wealth.LastUnflaggedSnapshotResult, error) {
	rows, err := s.q.LatestUnflaggedSnapshotHoldings(ctx, dbgen.LatestUnflaggedSnapshotHoldingsParams{
		AccountID: accountID,
		Date:      date,
	})
	if err != nil {
		return wealth.LastUnflaggedSnapshotResult{}, err
	}
	if len(rows) == 0 {
		return wealth.LastUnflaggedSnapshotResult{}, nil
	}
	holdings := latestUnflaggedHoldingsFromRows(rows)
	return wealth.LastUnflaggedSnapshotResult{
		Found:     true,
		AmountUSD: money.Cents(rows[0].BalanceUsdCents),
		Date:      rows[0].Date,
		Holdings:  holdings,
	}, nil
}

func latestUnflaggedHoldingsFromRows(rows []dbgen.LatestUnflaggedSnapshotHoldingsRow) []wealth.AssetDailyHolding {
	indexes := map[int64]int{}
	holdings := []wealth.AssetDailyHolding{}
	for _, row := range rows {
		if row.AssetID == nil {
			continue
		}
		assetID := *row.AssetID
		index, ok := indexes[assetID]
		if !ok {
			index = len(holdings)
			indexes[assetID] = index
			holdings = append(holdings, wealth.AssetDailyHolding{
				AssetID:           assetID,
				Identifier:        lo.FromPtr(row.Identifier),
				Quantity:          row.Quantity,
				Price:             row.Price,
				ValueUSD:          row.ValueUsdCents.Dollars(),
				CountsTowardValue: row.CountsTowardValue,
				Manual:            row.Manual,
			})
		}
		if source := adapterSourceFromLatestRow(row); source != nil {
			holdings[index].AdapterSources = append(holdings[index].AdapterSources, *source)
			if holdings[index].AdapterSource == nil {
				holdings[index].AdapterSource = source
			}
		}
	}
	return holdings
}

func adapterSourceFromLatestRow(row dbgen.LatestUnflaggedSnapshotHoldingsRow) *wealth.AdapterSource {
	if row.SourceAdapter == nil || row.SourceID == nil {
		return nil
	}
	return &wealth.AdapterSource{Adapter: syncerids.ID(*row.SourceAdapter), SourceID: *row.SourceID}
}

func (s *Store) AccountBalanceSnapshotValues(ctx context.Context, startTime, endTime string, filter wealth.AccountFilter) ([]wealth.SnapshotValue, error) {
	args, err := snapshotValueArgs("snapshot value", startTime, endTime, filter)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.AccountBalanceSnapshotValues(ctx, snapshotValueParams[dbgen.AccountBalanceSnapshotValuesParams](args))
	return dbutil.MapRows(rows, err, snapshotValue)
}

func (s *Store) ClassifierSnapshotValues(ctx context.Context, startTime, endTime string, filter wealth.AccountFilter) ([]wealth.ClassifierSnapshotValue, error) {
	args, err := snapshotValueArgs("classifier snapshot value", startTime, endTime, filter)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ClassifierSnapshotValues(ctx, snapshotValueParams[dbgen.ClassifierSnapshotValuesParams](args))
	return dbutil.MapRows(rows, err, classifierSnapshotValue)
}

func snapshotValueParams[T dbgen.AccountBalanceSnapshotValuesParams | dbgen.ClassifierSnapshotValuesParams](args snapshotValueQueryArgs) T {
	return T(dbgen.AccountBalanceSnapshotValuesParams{
		StartTime:  args.start,
		EndTime:    args.end,
		OwnerIds:   args.ownerIDs,
		AccountIds: args.accountIDs,
	})
}

type snapshotValueQueryArgs struct {
	start      time.Time
	end        time.Time
	ownerIDs   []int64
	accountIDs []int64
}

func snapshotValueArgs(label, startTime, endTime string, filter wealth.AccountFilter) (snapshotValueQueryArgs, error) {
	start, err := parseSnapshotTimestamp(label+" start", startTime)
	if err != nil {
		return snapshotValueQueryArgs{}, err
	}
	end, err := parseSnapshotTimestamp(label+" end", endTime)
	if err != nil {
		return snapshotValueQueryArgs{}, err
	}
	return snapshotValueQueryArgs{
		start:      start,
		end:        end,
		ownerIDs:   filter.OwnerIDs,
		accountIDs: filter.AccountIDs,
	}, nil
}

func (s *Store) AccountBalanceSnapshotTimestampRange(ctx context.Context, filter wealth.AccountFilter) (wealth.SnapshotTimestampRange, error) {
	params := dbgen.AccountBalanceSnapshotTimestampRangeParams{
		OwnerIds:   filter.OwnerIDs,
		AccountIds: filter.AccountIDs,
	}
	row, err := s.q.AccountBalanceSnapshotTimestampRange(ctx, params)
	if err != nil {
		return wealth.SnapshotTimestampRange{}, err
	}
	earliest, err := parseOptionalSnapshotTimestamp("earliest account balance snapshot synced_at", row.EarliestSyncedAt)
	if err != nil {
		return wealth.SnapshotTimestampRange{}, err
	}
	latest, err := parseOptionalSnapshotTimestamp("latest account balance snapshot synced_at", row.LatestSyncedAt)
	if err != nil {
		return wealth.SnapshotTimestampRange{}, err
	}
	return wealth.SnapshotTimestampRange{Earliest: earliest, Latest: latest}, nil
}
