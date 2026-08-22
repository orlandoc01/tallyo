package graph

import (
	"context"
	"time"

	"github.com/99designs/gqlgen/graphql"
	"github.com/graph-gophers/dataloader/v7"

	"tallyo/internal/accounts"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"
)

// var, not const: tests widen the batching window so concurrent field
// resolutions can't be split across batches by scheduler jitter.
var loaderWait = time.Millisecond

type loadersContextKey struct{}

var loadersKey loadersContextKey

type Loaders struct {
	AccountLatestSnapshot       *dataloader.Loader[int64, *model.AccountSnapshot]
	AccountLastSyncedAt         *dataloader.Loader[int64, *time.Time]
	Account                     *dataloader.Loader[int64, *model.Account]
	Asset                       *dataloader.Loader[int64, *model.Asset]
	AssetAdapterSources         *dataloader.Loader[int64, []*model.AssetAdapterSource]
	AssetLatestSnapshot         *dataloader.Loader[int64, *model.AssetSnapshot]
	RuleAccounts                *dataloader.Loader[int64, []*model.Account]
	RuleTags                    *dataloader.Loader[int64, []*model.Tag]
	Connection                  *dataloader.Loader[int64, *model.Connection]
	PlaidItem                   *dataloader.Loader[int64, *model.PlaidItem]
	EVMWallet                   *dataloader.Loader[int64, *accounts.EVMWallet]
	SimpleFinConnection         *dataloader.Loader[int64, *model.SimpleFinConnection]
	SimpleFinConnectionsByToken *dataloader.Loader[int64, []*model.SimpleFinConnection]
	PlaidCredential             *dataloader.Loader[int32, *model.PlaidCredential]
	ItemAccounts                *dataloader.Loader[int64, []*model.Account]
	TransactionTags             *dataloader.Loader[int64, []*model.Tag]
}

func NewLoadersContext(ctx context.Context, loaders *Loaders) context.Context {
	return context.WithValue(ctx, loadersKey, loaders)
}

func loadersFrom(ctx context.Context) *Loaders {
	return ctx.Value(loadersKey).(*Loaders)
}

// Each fetch is wrapped in a closure rather than passed as a bound method
// value: r.Admin/r.Wealth/etc. are interfaces that tests may legitimately
// leave nil when a given operation never touches them, and binding a method
// value on a nil interface panics immediately (not on call). The closure
// defers that field access to actual batch execution.
func (r *Resolver) NewLoaders() *Loaders {
	return &Loaders{
		AccountLatestSnapshot: newLoader(func(ctx context.Context, keys []int64) (map[int64]*model.AccountSnapshot, error) {
			return r.Wealth.AccountLatestSnapshots(ctx, keys)
		}),
		AccountLastSyncedAt: newLoader(func(ctx context.Context, keys []int64) (map[int64]*time.Time, error) {
			return r.Wealth.AccountsLastSyncedAt(ctx, keys)
		}),
		Account: newLoader(func(ctx context.Context, keys []int64) (map[int64]*model.Account, error) {
			return r.AccountsStore.AccountsByIDs(ctx, keys)
		}),
		Asset: newLoader(func(ctx context.Context, keys []int64) (map[int64]*model.Asset, error) {
			return r.WealthDB.AssetsByIDs(ctx, keys)
		}),
		AssetAdapterSources: newLoader(func(ctx context.Context, keys []int64) (map[int64][]*model.AssetAdapterSource, error) {
			return r.WealthDB.AssetAdapterSourcesByAssetIDs(ctx, keys)
		}),
		AssetLatestSnapshot: newLoader(func(ctx context.Context, keys []int64) (map[int64]*model.AssetSnapshot, error) {
			return r.Wealth.AssetSnapshotsByIDs(ctx, keys)
		}),
		RuleAccounts: newLoader(func(ctx context.Context, keys []int64) (map[int64][]*model.Account, error) {
			return r.AccountsStore.AccountsByRuleIDs(ctx, keys)
		}),
		RuleTags: newLoader(func(ctx context.Context, keys []int64) (map[int64][]*model.Tag, error) {
			return r.TransactionsStore.TagsByRuleIDs(ctx, keys)
		}),
		Connection: newLoader(func(ctx context.Context, keys []int64) (map[int64]*model.Connection, error) {
			return r.AccountsStore.ConnectionsByIDs(ctx, keys)
		}),
		PlaidItem: newLoader(func(ctx context.Context, keys []int64) (map[int64]*model.PlaidItem, error) {
			return r.AccountsStore.PlaidItemsByIDs(ctx, keys)
		}),
		EVMWallet: newLoader(func(ctx context.Context, keys []int64) (map[int64]*accounts.EVMWallet, error) {
			return r.AccountsStore.EVMWalletsByConnectionIDs(ctx, keys)
		}),
		SimpleFinConnection: newLoader(func(ctx context.Context, keys []int64) (map[int64]*model.SimpleFinConnection, error) {
			return r.AccountsStore.SimpleFinConnectionsByConnIDs(ctx, keys)
		}),
		SimpleFinConnectionsByToken: newLoader(func(ctx context.Context, keys []int64) (map[int64][]*model.SimpleFinConnection, error) {
			return r.AccountsStore.SimpleFinConnectionsByTokenIDs(ctx, keys)
		}),
		PlaidCredential: newLoader(func(ctx context.Context, keys []int32) (map[int32]*model.PlaidCredential, error) {
			return r.Admin.PlaidCredentialsByIDs(ctx, keys)
		}),
		ItemAccounts: newLoader(func(ctx context.Context, keys []int64) (map[int64][]*model.Account, error) {
			return r.AccountsStore.AccountsByItems(ctx, keys)
		}),
		TransactionTags: newLoader(func(ctx context.Context, keys []int64) (map[int64][]*model.Tag, error) {
			return r.TransactionsStore.TagsByTransactionIDs(ctx, keys)
		}),
	}
}

func LoaderInjector(r *Resolver) graphql.OperationMiddleware {
	return func(ctx context.Context, next graphql.OperationHandler) graphql.ResponseHandler {
		return next(NewLoadersContext(ctx, r.NewLoaders()))
	}
}

func newLoader[K comparable, V any](fetch func(context.Context, []K) (map[K]V, error)) *dataloader.Loader[K, V] {
	return dataloader.NewBatchedLoader(
		batchByKey(fetch),
		dataloader.WithClearCacheOnBatch[K, V](),
		dataloader.WithWait[K, V](loaderWait),
	)
}

func batchByKey[K comparable, V any](fetch func(context.Context, []K) (map[K]V, error)) dataloader.BatchFunc[K, V] {
	return func(ctx context.Context, keys []K) []*dataloader.Result[V] {
		valuesByKey, err := fetch(ctx, keys)
		if err != nil {
			returnErr := func(_ K) *dataloader.Result[V] { return &dataloader.Result[V]{Error: err} }
			return u.Map(keys, returnErr)
		}

		keyToValue := func(key K) *dataloader.Result[V] {
			var value V
			if valueInKey, ok := valuesByKey[key]; ok {
				value = valueInKey
			}
			return &dataloader.Result[V]{Data: value}
		}
		return u.Map(keys, keyToValue)
	}
}
