package wealthdb

import (
	"context"
	"testing"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func mustSeedSimpleFinBalanceToken(t *testing.T, store *testStore, ownerName string) (*model.Owner, *model.SimpleFinAccessToken) {
	t.Helper()
	owner := test.MustCreateOwner(t, store.accounts, model.CreateOwnerInput{Name: ownerName})
	token, err := store.accounts.CreateSimpleFinAccessToken(
		context.Background(),
		"https://user:pass@bridge.example/simplefin",
		owner.ID.Int64(),
		"Bridge",
	)
	must.NoErr(t, err)
	return owner, token
}

func TestSimpleFinBalanceScheduleQueries(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	owner, token := mustSeedSimpleFinBalanceToken(t, store, "simplefin-balance-owner")
	tokenID := token.ID.Int64()

	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	due, err := store.SimpleFinTokensDueForBalanceSync(ctx, now)
	if err != nil || len(due) != 1 {
		t.Fatalf("SimpleFinTokensDueForBalanceSync(initial) = %#v, %v", due, err)
	}

	next := now.Add(24 * time.Hour)
	must.NoErr(t, store.SetSimpleFinTokenBalanceSynced(ctx, int64(tokenID), next))
	due, err = store.SimpleFinTokensDueForBalanceSync(ctx, now)
	if err != nil || len(due) != 0 {
		t.Fatalf("SimpleFinTokensDueForBalanceSync(future) = %#v, %v", due, err)
	}

	connID, _, err := store.accounts.LinkSimpleFinConnection(ctx, accounts.UpsertSimpleFinConnectionParams{
		ExternalID:    "conn-1",
		AccessTokenID: int64(tokenID),
		Name:          "Bank",
		OwnerID:       owner.ID.Int64(),
	})
	must.NoErr(t, err)
	secret, err := store.SimpleFinTokenSecretByConnID(ctx, connID)
	if err != nil || secret == nil || secret.NextBalanceSyncAt == nil || !secret.NextBalanceSyncAt.Equal(next) {
		t.Fatalf("SimpleFinTokenSecretByConnID = %#v, %v", secret, err)
	}
}

// TestSimpleFinTokensDueForBalanceSyncExcludesAllClosedAccounts guards the
// closed-account exclusion: the shared snapshot sink rejects writes for
// closed accounts, so a token whose only linked account is closed should
// never be treated as due for balance work again once reset.
func TestSimpleFinTokensDueForBalanceSyncExcludesAllClosedAccounts(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	owner, token := mustSeedSimpleFinBalanceToken(t, store, "closed-owner")
	tokenID := token.ID.Int64()

	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)

	_, connectionID, err := store.accounts.LinkSimpleFinConnection(ctx, accounts.UpsertSimpleFinConnectionParams{
		ExternalID:    "conn-closed",
		AccessTokenID: int64(tokenID),
		Name:          "Bank",
		OwnerID:       owner.ID.Int64(),
	})
	must.NoErr(t, err)
	account := &model.Account{
		Connection: &model.Connection{ID: model.New(model.GlobalIDConnection, connectionID)},
		Owner:      owner,
		Name:       "Old Checking",
		Type:       model.AccountTypeDepository,
	}
	test.MustUpsertAccount(t, store.accounts, "closed-acc", account)
	closed := true
	if _, err := store.accounts.UpdateAccount(ctx, account.ID.Int64(), model.UpdateAccountInput{ID: account.ID, Closed: &closed}); err != nil {
		t.Fatalf("UpdateAccount(closed): %v", err)
	}

	due, err := store.SimpleFinTokensDueForBalanceSync(ctx, now)
	must.NoErr(t, err)
	for _, d := range due {
		if d.ID == tokenID {
			t.Fatalf("token with only closed accounts reported due: %#v", due)
		}
	}
}
