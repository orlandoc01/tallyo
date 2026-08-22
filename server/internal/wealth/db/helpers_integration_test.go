package wealthdb

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/database"
	"tallyo/internal/database/dbtest"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
	"tallyo/internal/wealth"
)

// Pins the real store's not-found contract: plaid's resolveAccountTypes
// branches its TypeFromPlaid fallback on errors.Is(err, sql.ErrNoRows), so a
// conversion to the MapFirstRow zero-value convention would silently break it.
func TestAccountByExternalIDNotFoundReturnsErrNoRows(t *testing.T) {
	store := testDB(t)
	if _, _, err := store.AccountByExternalID(context.Background(), "missing-external-id"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("AccountByExternalID(missing) error = %v, want sql.ErrNoRows", err)
	}
}

type testStore struct {
	*Store
	accounts *accountsdb.Store
	db       *database.DB
}

func testDB(t *testing.T) *testStore {
	t.Helper()
	db := dbtest.Open(t)
	return &testStore{Store: New(db), accounts: accountsdb.New(db), db: db}
}

func (s *testStore) UpdateAccount(ctx context.Context, id int64, input model.UpdateAccountInput) (*model.Account, error) {
	return s.accounts.UpdateAccount(ctx, id, input)
}

func (s *testStore) Owners(ctx context.Context) ([]*model.Owner, error) {
	return s.accounts.Owners(ctx)
}

func (s *testStore) AccountBalanceSnapshotCount(ctx context.Context, accountID int64) (int, error) {
	var count int
	err := s.db.SQL().QueryRowContext(ctx, `SELECT COUNT(*) FROM account_balance_daily_snapshots WHERE account_id = ?`, accountID).Scan(&count)
	return count, err
}

func mustReplaceSnapshot(t *testing.T, store *testStore, snapshot wealth.AccountBalanceSnapshot) {
	t.Helper()
	must.NoErr(t, store.ReplaceAccountBalanceSnapshot(context.Background(), snapshot))
}

func mustInvestmentAccount(tb testing.TB, store *testStore, externalID, ownerName, accountName string) (int64, int64) {
	tb.Helper()
	account := test.MustSeedAccount(tb, store.accounts, externalID, ownerName, accountName, model.AccountTypeInvestment)
	return account.Owner.ID.Int64(), account.ID.Int64()
}

func mustUpsertAsset(tb testing.TB, store *testStore, upsert wealth.AssetUpsert) *model.Asset {
	tb.Helper()
	asset, err := store.UpsertAsset(context.Background(), upsert)
	must.NoErr(tb, err)
	return asset
}

func mustAssetByID(tb testing.TB, store *testStore, id int64) *model.Asset {
	tb.Helper()
	asset, err := store.AssetByID(context.Background(), id)
	must.NoErr(tb, err)
	return asset
}

func mustAccountBalanceSnapshotByID(tb testing.TB, store *testStore, id int64) *wealth.SnapshotRow {
	tb.Helper()
	snapshot, err := store.GetAccountBalanceSnapshotByID(context.Background(), id)
	must.NoErr(tb, err)
	return snapshot
}

func mustCurrentHoldings(tb testing.TB, store *testStore, filter wealth.AccountFilter) []wealth.CurrentHolding {
	tb.Helper()
	holdings, err := store.CurrentHoldings(context.Background(), filter)
	must.NoErr(tb, err)
	return holdings
}

func mustLatestLiabilityAccountBalances(tb testing.TB, store *testStore, filter wealth.AccountFilter) []wealth.LiabilityAccountBalance {
	tb.Helper()
	balances, err := store.LatestLiabilityAccountBalances(context.Background(), filter)
	must.NoErr(tb, err)
	return balances
}

func mustListInReviewBalanceReviews(tb testing.TB, store *testStore) []wealth.BalanceReview {
	tb.Helper()
	reviews, err := store.ListInReviewBalanceReviews(context.Background())
	must.NoErr(tb, err)
	return reviews
}
