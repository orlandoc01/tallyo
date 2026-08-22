package transactions_test

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"

	"tallyo/internal/money"
	"tallyo/internal/transactions"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

type pagedClient struct {
	test.PlaidClientStub
	syncCalls int
}

func (c *pagedClient) Accounts(ctx context.Context, accessToken string) ([]plaidapi.AccountBase, error) {
	return []plaidapi.AccountBase{test.AccountBase("acc", "Card", "1111", "credit", "credit card")}, nil
}

func (c *pagedClient) Sync(ctx context.Context, accessToken, cursor string) (plaidapi.TransactionsSyncResponse, error) {
	c.syncCalls++
	if c.syncCalls == 1 {
		added := plaidTransaction("added", "acc", 10, "2026-05-20")
		removed := plaidapi.NewRemovedTransaction()
		removed.SetTransactionId("removed")
		return plaidapi.TransactionsSyncResponse{Added: []plaidapi.Transaction{added}, Removed: []plaidapi.RemovedTransaction{*removed}, NextCursor: "page-2", HasMore: true}, nil
	}
	modified := plaidTransaction("added", "acc", 11, "2026-05-21")
	return plaidapi.TransactionsSyncResponse{Modified: []plaidapi.Transaction{modified}, NextCursor: "done", HasMore: false}, nil
}

func TestSyncTransactionsPaginatesModifiesAndRemoves(t *testing.T) {
	ctx := context.Background()
	client := &pagedClient{}
	fixture := newSeededSyncFixture(t, client)
	result := fixture.syncer.SyncDueItems(ctx)
	if len(result.Items) != 1 || result.Items[0].Error != nil || result.TotalAdded != 1 || result.TotalModified != 1 || result.TotalRemoved != 1 {
		t.Fatalf("SyncDueItems() = %#v", result)
	}
	cursor, err := fixture.store.SyncCursor(ctx, fixture.itemID)
	if err != nil || cursor != "done" {
		t.Fatalf("SyncCursor() = %q, %v", cursor, err)
	}
	tx, err := test.TransactionBySourceExternalID(ctx, fixture.store, transactions.TransactionSourcePlaid, "added")
	if err != nil || tx == nil || tx.Amount != money.FromDollars(11) {
		t.Fatalf("transaction = %#v, %v", tx, err)
	}
}

type removeAndAddSameIDClient struct {
	fakeClient
}

func (c removeAndAddSameIDClient) Sync(ctx context.Context, accessToken, cursor string) (plaidapi.TransactionsSyncResponse, error) {
	added := plaidTransaction("same-id", "acc", 42, "2026-05-22")
	removed := plaidapi.NewRemovedTransaction()
	removed.SetTransactionId("same-id")
	return plaidapi.TransactionsSyncResponse{Added: []plaidapi.Transaction{added}, Removed: []plaidapi.RemovedTransaction{*removed}, NextCursor: "done", HasMore: false}, nil
}

func TestSyncTransactionsAppliesRemovalsBeforeUpserts(t *testing.T) {
	ctx := context.Background()
	fixture := newSeededSyncFixture(t, removeAndAddSameIDClient{})

	result := fixture.syncer.SyncDueItems(ctx)
	if len(result.Items) != 1 || result.Items[0].Error != nil || result.TotalAdded != 1 || result.TotalRemoved != 1 {
		t.Fatalf("SyncDueItems() = %#v", result)
	}
	tx, err := test.TransactionBySourceExternalID(ctx, fixture.store, transactions.TransactionSourcePlaid, "same-id")
	if err != nil || tx == nil || tx.Amount != money.FromDollars(42) {
		t.Fatalf("transaction = %#v, %v", tx, err)
	}
	cursor, err := fixture.store.SyncCursor(ctx, fixture.itemID)
	if err != nil || cursor != "done" {
		t.Fatalf("SyncCursor() = %q, %v", cursor, err)
	}
}

type mutationDuringPaginationClient struct {
	fakeClient
	cursors []string
}

func (c *mutationDuringPaginationClient) Sync(ctx context.Context, accessToken, cursor string) (plaidapi.TransactionsSyncResponse, error) {
	c.cursors = append(c.cursors, cursor)
	switch len(c.cursors) {
	case 1:
		stale := plaidTransaction("stale", "acc", 10, "2026-05-20")
		return plaidapi.TransactionsSyncResponse{Added: []plaidapi.Transaction{stale}, NextCursor: "page-2", HasMore: true}, nil
	case 2:
		plaidErr := *plaidapi.NewPlaidError(plaidapi.PLAIDERRORTYPE_ITEM_ERROR, "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", "mutation during pagination", plaidapi.NullableString{})
		return plaidapi.TransactionsSyncResponse{}, plaidapi.MakeGenericOpenAPIError(nil, "mutation during pagination", plaidErr)
	case 3:
		fresh := plaidTransaction("fresh", "acc", 10, "2026-05-20")
		return plaidapi.TransactionsSyncResponse{Added: []plaidapi.Transaction{fresh}, NextCursor: "page-2b", HasMore: true}, nil
	default:
		fresh := plaidTransaction("fresh", "acc", 11, "2026-05-21")
		return plaidapi.TransactionsSyncResponse{Modified: []plaidapi.Transaction{fresh}, NextCursor: "done", HasMore: false}, nil
	}
}

func TestSyncTransactionsRestartsWhenPaginationMutates(t *testing.T) {
	ctx := context.Background()
	var logs bytes.Buffer
	client := &mutationDuringPaginationClient{}
	fixture := newSeededSyncFixture(t, client, withLog(slog.New(slog.NewTextHandler(&logs, nil))))
	must.NoErr(t, fixture.store.SetSyncCursor(ctx, fixture.itemID, "start", time.Now().UTC()))

	result := fixture.syncer.SyncDueItems(ctx)
	if len(result.Items) != 1 || result.Items[0].Error != nil || result.TotalAdded != 1 || result.TotalModified != 1 {
		t.Fatalf("SyncDueItems() = %#v", result)
	}
	if got, want := strings.Join(client.cursors, ","), "start,page-2,start,page-2b"; got != want {
		t.Fatalf("sync cursors = %q, want %q", got, want)
	}
	cursor, err := fixture.store.SyncCursor(ctx, fixture.itemID)
	if err != nil || cursor != "done" {
		t.Fatalf("SyncCursor() = %q, %v", cursor, err)
	}
	stale, err := test.TransactionBySourceExternalID(ctx, fixture.store, transactions.TransactionSourcePlaid, "stale")
	if err != nil || stale != nil {
		t.Fatalf("stale transaction = %#v, %v", stale, err)
	}
	fresh, err := test.TransactionBySourceExternalID(ctx, fixture.store, transactions.TransactionSourcePlaid, "fresh")
	if err != nil || fresh == nil || fresh.Amount != money.FromDollars(11) {
		t.Fatalf("fresh transaction = %#v, %v", fresh, err)
	}
	if !strings.Contains(logs.String(), "pagination mutated") {
		t.Fatalf("expected pagination mutation log, got %q", logs.String())
	}
}

func plaidTransaction(id, accountID string, amount float64, date string) plaidapi.Transaction {
	tx := plaidapi.NewTransactionWithDefaults()
	tx.SetTransactionId(id)
	tx.SetAccountId(accountID)
	tx.SetAmount(amount)
	tx.SetDate(date)
	tx.SetName("Merchant")
	return *tx
}
