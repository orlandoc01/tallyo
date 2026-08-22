package graph

import (
	"context"
	"testing"
	"time"

	"github.com/99designs/gqlgen/client"
	graphqlhandler "github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/extension"

	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/admin"
	admindb "tallyo/internal/admin/db"
	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/auth"
	"tallyo/internal/budgets"
	budgetsdb "tallyo/internal/budgets/db"
	"tallyo/internal/graph/model"
	transactionsdb "tallyo/internal/transactions/db"
	u "tallyo/internal/utils"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
	"tallyo/internal/wealth"
	wealthdb "tallyo/internal/wealth/db"
	"tallyo/internal/wealth/manual"
)

// The production 1ms batching window is enough for gqlgen's concurrent field
// goroutines in practice, but under -race on a loaded CI box the second Load
// can miss it, splitting one logical batch in two and flaking batch-count
// assertions. Widen it so batching is deterministic in tests.
func init() {
	loaderWait = 50 * time.Millisecond
}

type graphTestStore struct {
	*test.Store
	Accounts     *accountsdb.Store
	AdminDB      *admindb.Store
	Transactions *transactionsdb.Store
	WealthDB     *wealthdb.Store
	Budgets      *budgetsdb.Store
}

func openGraphTestStore(tb testing.TB) *graphTestStore {
	tb.Helper()
	base := test.OpenStore(tb)
	accountsStore := accountsdb.New(base.Database())
	adminStore := admindb.New(base.Database())
	transactionsStore := transactionsdb.New(base.Database())
	wealthStore := wealthdb.New(base.Database())
	budgetsStore := budgetsdb.New(base.Database())
	return &graphTestStore{
		Store:        base,
		Accounts:     accountsStore,
		AdminDB:      adminStore,
		Transactions: transactionsStore,
		WealthDB:     wealthStore,
		Budgets:      budgetsStore,
	}
}

func testResolver(t *testing.T) (*Resolver, *graphTestStore) {
	t.Helper()
	store := openGraphTestStore(t)
	return &Resolver{
		AccountsStore:     store.Accounts,
		WealthDB:          store.WealthDB,
		TransactionsStore: store.Transactions,
		Budgets: &budgets.Service{
			Store:      store.Budgets,
			Spending:   store.Transactions,
			Categories: store.Transactions,
		},
		Admin: admin.NewService(store.AdminDB, runtimeconfig.New(store.AdminDB)),
		ManualSnapshot: &manual.Service{
			Store:  store.WealthDB,
			Prices: test.LastKnownPriceProvider{},
		},
	}, store
}

func allScopesCtx() context.Context {
	return u.ContextWithTimezone(auth.ContextWithScopes(context.Background(), auth.AllScopes), "UTC")
}

func newExecServer(resolver *Resolver) *graphqlhandler.Server {
	srv := graphqlhandler.NewDefaultServer(NewExecutableSchema(ConfigWithAuth(resolver)))
	srv.Use(extension.FixedComplexityLimit(500))
	srv.SetErrorPresenter(SafeErrorPresenter(test.Logger))
	srv.SetRecoverFunc(SafeRecoverFunc(test.Logger))
	srv.AroundOperations(LoaderInjector(resolver))
	return srv
}

func withCtx(ctx context.Context) client.Option {
	return client.Option(func(request *client.Request) { request.HTTP = request.HTTP.WithContext(ctx) })
}

func testWealthService(store *wealthdb.Store) *wealth.Service {
	return &wealth.Service{Store: store, Log: test.Logger, PriceProvider: test.LastKnownPriceProvider{}, Timezone: func() string { return "UTC" }}
}

func mustUpsertAsset(tb testing.TB, store *wealthdb.Store, upsert wealth.AssetUpsert) *model.Asset {
	tb.Helper()
	asset, err := store.UpsertAsset(context.Background(), upsert)
	must.NoErr(tb, err)
	return asset
}

func mustSeedGraphAccount(
	tb testing.TB,
	store *graphTestStore,
	externalID, ownerName, accountName string,
	accountType model.AccountType,
) *model.Account {
	tb.Helper()
	return test.MustSeedAccount(tb, store.Accounts, externalID, ownerName, accountName, accountType)
}
