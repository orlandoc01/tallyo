package transactions_test

import (
	"context"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
	"time"

	. "tallyo/internal/transactions"
	"tallyo/internal/transactions/categorizer"
	"tallyo/internal/transactions/txnsync"
	"tallyo/internal/utils/test"

	"tallyo/internal/graph/model"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"tallyo/internal/utils/must"
)

type mockLLM struct {
	results []categorizer.LLMResult
	err     error
	calls   int
}

type emptySyncClient struct{ fakeClient }

func (emptySyncClient) Sync(ctx context.Context, accessToken, cursor string) (plaidapi.TransactionsSyncResponse, error) {
	return plaidapi.TransactionsSyncResponse{NextCursor: "next", HasMore: false}, nil
}

func (m *mockLLM) CategorizeBatch(ctx context.Context, txns []categorizer.TransactionInput, globalExamples []categorizer.ExampleTransaction) ([]categorizer.LLMResult, error) {
	m.calls++
	return m.results, m.err
}

func (m *mockLLM) BatchSize() int { return 5 }

func TestSyncDueItemsWithLLM(t *testing.T) {
	ctx := context.Background()
	store := openTransactionsTestStore(t, filepath.Join(t.TempDir(), "test.db"))

	coffeeCatID := test.CategoryIDByName(t, store, "Coffee Shops")
	uncatID := seedUncategorizedTx(t, store)
	llm := &mockLLM{results: []categorizer.LLMResult{
		{TransactionID: uncatID, CategoryID: coffeeCatID, CategoryName: "Coffee Shops", Confidence: "high"},
	}}

	workerCtx := t.Context()
	syncer := newTestSyncer(store, emptySyncClient{}, withLog(test.Logger))
	syncer.SetLLM(llm)
	go syncer.RunLLMWorker(workerCtx)
	seedPlaidItem(t, store, "item")
	result := syncer.SyncDueItems(ctx)
	if hasItemError(result) {
		t.Fatalf("SyncDueItems() = %#v", result)
	}

	// Wait for async LLM worker to process the trigger.
	for range 50 {
		tx, _ := test.TransactionBySourceExternalID(ctx, store, TransactionSourcePlaid, "tx-uncat")
		if tx != nil && tx.Category != nil && tx.Category.ID == model.New(model.GlobalIDCategory, coffeeCatID) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	tx := test.MustTransactionBySourceExternalID(t, store, TransactionSourcePlaid, "tx-uncat", "Transaction() error = %v")
	if tx.Category == nil || tx.Category.ID != model.New(model.GlobalIDCategory, coffeeCatID) {
		t.Fatalf("expected LLM-assigned category id=%d, got %#v", coffeeCatID, tx.Category)
	}
	if !tx.IsReviewed {
		t.Fatalf("LLM-categorized transactions should be marked as reviewed")
	}
}

func TestSyncDueItemsLLMVariants(t *testing.T) {
	tests := map[string]struct {
		llm     *mockLLM
		failure string
	}{
		"LLMErrorRecorded":               {llm: &mockLLM{err: errFake}, failure: "sync item should succeed even when LLM fails, got %#v"},
		"LLMNoUncategorizedTransactions": {llm: &mockLLM{err: errFake}, failure: "SyncDueItems() = %#v"},
		"WithoutLLM":                     {failure: "SyncDueItems() = %#v"},
	}

	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			fixture := newSeededSyncFixture(t, fakeClient{}, withLog(test.Logger))
			if tc.llm != nil {
				fixture.syncer.SetLLM(tc.llm)
			}
			result := fixture.syncer.SyncDueItems(ctx)
			if hasItemError(result) {
				t.Fatalf(tc.failure, result)
			}
		})
	}
}

func TestSyncDueItemsLLMDoesNotOverwriteManual(t *testing.T) {
	ctx := context.Background()
	store := openTransactionsTestStore(t, ":memory:")

	itemID := seedPlaidItem(t, store, "item-2")
	alexOwner, _ := store.OwnerByName(ctx, "alex")
	test.MustUpsertAccount(t, store.Accounts, "acc-2", &model.Account{Connection: &model.Connection{SourceTable: "plaid_items", SourceID: itemID}, Owner: alexOwner, Name: "Checking", Type: model.AccountTypeDepository, Mask: new("0000")})
	merchant := "Coffee"
	if _, err := store.UpsertSyncedTransaction(ctx, SyncedTransaction{ExternalID: "tx-manual", AccountID: "acc-2", Amount: 5, Datetime: test.DateTime("2026-05-20T00:00:00Z"), PostedDatetime: test.DateTime("2026-05-20T00:00:00Z"), MerchantName: &merchant}); err != nil {
		t.Fatalf("UpsertSyncedTransaction() error = %v", err)
	}
	manualTx := test.MustTransactionBySourceExternalID(t, store, TransactionSourcePlaid, "tx-manual", "TransactionByExternalID() error = %v")
	manualID := manualTx.ID.Int64()
	groceriesID := test.CategoryIDByName(t, store, "Groceries")
	groceriesIDVal := model.New(model.GlobalIDCategory, groceriesID)
	if _, err := store.UpdateTransaction(ctx, manualID, model.TransactionUpdates{CategoryID: &groceriesIDVal}); err != nil {
		t.Fatalf("UpdateTransaction() error = %v", err)
	}

	coffeeCatID := test.CategoryIDByName(t, store, "Coffee Shops")
	llm := &mockLLM{results: []categorizer.LLMResult{
		{TransactionID: strconv.FormatInt(manualTx.ID.Int64(), 10), CategoryID: coffeeCatID, CategoryName: "Coffee Shops", Confidence: "high"},
	}}

	syncer := newTestSyncer(store, emptySyncClient{}, withLog(test.Logger))
	syncer.SetLLM(llm)
	seedPlaidItem(t, store, "item")
	result := syncer.SyncDueItems(ctx)
	if hasItemError(result) {
		t.Fatalf("SyncDueItems() = %#v", result)
	}

	tx := test.MustTransactionBySourceExternalID(t, store, TransactionSourcePlaid, "tx-manual", "Transaction() error = %v")
	if tx.Category == nil || tx.Category.ID != model.New(model.GlobalIDCategory, groceriesID) {
		t.Fatalf("manual category should be preserved, got %#v", tx.Category)
	}
}

// Disabling the LLM must surface staged (report-hidden) transactions for
// manual review — nothing will ever drain them once the worker is off.
func TestSetLLMNilClearsStagedTransactions(t *testing.T) {
	ctx := context.Background()
	store := openTransactionsTestStore(t, ":memory:")
	seedUncategorizedTx(t, store)
	syncer := newTestSyncer(store, emptySyncClient{}, withLog(test.Logger))
	syncer.SetLLM(&mockLLM{})

	staged, err := store.UncategorizedForLLM(ctx, 10)
	must.NoErr(t, err)
	if len(staged) != 1 {
		t.Fatalf("staged before disable = %d, want 1", len(staged))
	}

	syncer.SetLLM(nil)
	staged, err = store.UncategorizedForLLM(ctx, 10)
	must.NoErr(t, err)
	if len(staged) != 0 {
		t.Fatalf("staged after disable = %d, want 0 (rows would stay hidden)", len(staged))
	}
}

func hasItemError(result *txnsync.SyncResult) bool {
	hasError := func(item *model.ItemSyncResult) bool { return item.Error != nil }
	return slices.ContainsFunc(result.Items, hasError)
}

func seedUncategorizedTx(t *testing.T, store *transactionsTestStore) string {
	t.Helper()
	ctx := context.Background()
	itemID := seedPlaidItem(t, store, "item-2")
	alexOwner, _ := store.OwnerByName(ctx, "alex")
	test.MustUpsertAccount(t, store.Accounts, "acc-2", &model.Account{Connection: &model.Connection{SourceTable: "plaid_items", SourceID: itemID}, Owner: alexOwner, Name: "Checking", Type: model.AccountTypeDepository, Mask: new("0000")})
	merchant := "Coffee Shop"
	if _, err := store.UpsertSyncedTransaction(context.Background(), SyncedTransaction{ExternalID: "tx-uncat", AccountID: "acc-2", Amount: 5, Datetime: test.DateTime("2026-05-20T00:00:00Z"), PostedDatetime: test.DateTime("2026-05-20T00:00:00Z"), MerchantName: &merchant, StageForLLM: true}); err != nil {
		t.Fatalf("UpsertSyncedTransaction() error = %v", err)
	}
	txID, err := test.TransactionIDBySourceExternalID(context.Background(), store, TransactionSourcePlaid, "tx-uncat")
	must.NoErr(t, err)
	return strconv.FormatInt(txID, 10)
}
