package wealthdb

import (
	"context"
	"testing"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func TestAccountSyncStateHelpers(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	owner := test.MustCreateOwner(t, store.accounts, model.CreateOwnerInput{Name: "sync-owner"})
	account := &model.Account{Owner: owner, Name: "Sync Account", Type: model.AccountTypeDepository, NeedsReview: true}
	test.MustUpsertAccount(t, store.accounts, "sync-account", account)
	accountID := account.ID.Int64()

	fetched, err := store.AccountByID(ctx, accountID)
	if err != nil || fetched == nil || fetched.ID != account.ID || !fetched.NeedsReview {
		t.Fatalf("AccountByID = %#v, %v", fetched, err)
	}
	missing, err := store.AccountByID(ctx, -1)
	if err != nil || missing != nil {
		t.Fatalf("AccountByID(missing) = %#v, %v; want nil, nil", missing, err)
	}

	if got, err := store.AccountLastBalanceSyncedAtForAccounts(ctx, []int64{accountID}); err != nil || len(got) != 0 {
		t.Fatalf("AccountLastBalanceSyncedAtForAccounts(empty) = %v, %v", got, err)
	}
	syncedAt := time.Date(2026, 6, 10, 12, 0, 0, 0, time.UTC)
	must.NoErr(t, store.MarkAccountBalanceSynced(ctx, accountID, syncedAt))
	batch, err := store.AccountLastBalanceSyncedAtForAccounts(ctx, []int64{accountID, -1})
	must.NoErr(t, err)
	if len(batch) != 1 || !batch[accountID].Equal(syncedAt) {
		t.Fatalf("AccountLastBalanceSyncedAtForAccounts = %#v, want one synced account", batch)
	}
}
