package wealthdb

import (
	"context"
	"time"

	"github.com/samber/lo"

	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
	"tallyo/internal/wealth"
)

func (s *Store) CurrentHoldings(ctx context.Context, filter wealth.AccountFilter) ([]wealth.CurrentHolding, error) {
	params := dbgen.ListCurrentAccountHoldingsParams{
		OwnerIds:           filter.OwnerIDs,
		AccountIds:         filter.AccountIDs,
		AssetIds:           filter.AssetIDs,
		ExcludeLiabilities: filter.ExcludeLiabilities,
	}
	rows, err := s.q.ListCurrentAccountHoldings(ctx, params)
	return dbutil.MapRows(rows, err, currentHolding)
}

func currentHolding(row dbgen.ListCurrentAccountHoldingsRow) wealth.CurrentHolding {
	asset := assetFromModel(row.Asset)
	return wealth.CurrentHolding{
		Account:      accountsdb.AccountFromRow(row.Account, row.OwnerName),
		Asset:        &asset,
		Quantity:     row.Quantity,
		ValueUSD:     row.ValueUsdCents,
		Manual:       row.Manual,
		SnapshotDate: model.Date(row.Date),
	}
}

func (s *Store) LatestLiabilityAccountBalances(ctx context.Context, filter wealth.AccountFilter) ([]wealth.LiabilityAccountBalance, error) {
	params := dbgen.ListLatestLiabilityAccountBalancesParams{
		OwnerIds:   filter.OwnerIDs,
		AccountIds: filter.AccountIDs,
	}
	rows, err := s.q.ListLatestLiabilityAccountBalances(ctx, params)
	fromRow := func(row dbgen.ListLatestLiabilityAccountBalancesRow) wealth.LiabilityAccountBalance {
		return wealth.LiabilityAccountBalance{
			Account:    accountsdb.AccountFromRow(row.Account, row.OwnerName),
			BalanceUSD: row.BalanceUsdCents,
		}
	}
	return dbutil.MapRows(rows, err, fromRow)
}

func (s *Store) AccountLastBalanceSyncedAtForAccounts(ctx context.Context, accountIDs []int64) (map[int64]time.Time, error) {
	rows, err := s.q.AccountLastBalanceSyncedAtForAccounts(ctx, dbgen.AccountLastBalanceSyncedAtForAccountsParams{AccountIds: accountIDs})
	if err != nil {
		return nil, err
	}
	toSyncedAtByAccountID := func(row dbgen.AccountSyncState) (int64, time.Time, bool) {
		return row.AccountID, lo.FromPtr(row.LastBalanceSyncedAt), row.LastBalanceSyncedAt != nil
	}
	return lo.FilterSliceToMap(rows, toSyncedAtByAccountID), nil
}

func (s *Store) MarkAccountBalanceSynced(ctx context.Context, accountID int64, syncedAt time.Time) error {
	return markAccountBalanceSynced(ctx, s.q, accountID, syncedAt)
}

func markAccountBalanceSynced(ctx context.Context, q *dbgen.Queries, accountID int64, syncedAt time.Time) error {
	syncedAtUTC := syncedAt.UTC()
	return q.MarkAccountBalanceSynced(ctx, dbgen.MarkAccountBalanceSyncedParams{AccountID: accountID, LastBalanceSyncedAt: &syncedAtUTC})
}
