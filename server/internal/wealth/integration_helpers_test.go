package wealth_test

import (
	"context"
	"testing"
	"time"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
	"tallyo/internal/wealth"
	wealthdb "tallyo/internal/wealth/db"
	"tallyo/internal/wealth/plaid"
)

type wealthTestStore struct {
	*test.Store
	*accountWealthStore
	*wealthDBStore
}

type accountWealthStore struct{ *accountsdb.Store }
type wealthDBStore struct{ *wealthdb.Store }

func openWealthTestStore(tb testing.TB) *wealthTestStore {
	tb.Helper()
	base := test.OpenStore(tb)
	return &wealthTestStore{
		Store:              base,
		accountWealthStore: &accountWealthStore{Store: accountsdb.New(base.Database())},
		wealthDBStore:      &wealthDBStore{Store: wealthdb.New(base.Database())},
	}
}

func (s *wealthTestStore) PlaidItemsDueForBalanceSync(ctx context.Context, now time.Time) ([]accounts.PlaidItemSecret, error) {
	return s.wealthDBStore.PlaidItemsDueForBalanceSync(ctx, now)
}

func (s *wealthTestStore) PlaidItemSecretByID(ctx context.Context, itemID int64) (*accounts.PlaidItemSecret, error) {
	return s.wealthDBStore.PlaidItemSecretByID(ctx, itemID)
}

func (s *wealthTestStore) SetItemBalanceSynced(ctx context.Context, itemID int64, nextBalanceSyncAt time.Time) error {
	return s.wealthDBStore.SetItemBalanceSynced(ctx, itemID, nextBalanceSyncAt)
}

func (s *wealthTestStore) AccountByID(ctx context.Context, id int64) (*model.Account, error) {
	return s.accountWealthStore.AccountByID(ctx, id)
}

func (s *wealthTestStore) OwnerByName(ctx context.Context, name string) (*model.Owner, error) {
	return test.OwnerByName(ctx, s.accountWealthStore, name)
}

func mustUpsertAsset(tb testing.TB, store *wealthTestStore, upsert wealth.AssetUpsert) *model.Asset {
	tb.Helper()
	asset, err := store.UpsertAsset(context.Background(), upsert)
	must.NoErr(tb, err)
	return asset
}

func mustCurrentHoldings(tb testing.TB, ctx context.Context, store *wealthTestStore) []wealth.CurrentHolding {
	tb.Helper()
	holdings, err := store.CurrentHoldings(ctx, wealth.AccountFilter{})
	must.NoErr(tb, err)
	return holdings
}

var _ plaid.PlaidBalanceStore = (*wealthTestStore)(nil)
