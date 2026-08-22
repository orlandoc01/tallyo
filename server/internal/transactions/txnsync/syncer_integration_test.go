package txnsync

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	admindb "tallyo/internal/admin/db"
	"tallyo/internal/transactions"
	"tallyo/internal/transactions/categorizer"
	testutil "tallyo/internal/utils/test"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"tallyo/internal/utils/must"
)

func TestSyncDueItemsFoldsReportsAndSignalsLLM(t *testing.T) {
	adapter := &fakeSyncAdapter{due: transactions.SyncReport{Items: []transactions.ItemReport{
		{Counts: transactions.ItemCounts{Added: 2, Modified: 1}},
		{Counts: transactions.ItemCounts{Removed: 3}, Err: errors.New("boom")},
	}}}
	syncer := newUnitSyncer(adapter)

	result := syncer.SyncDueItems(context.Background())
	if result.TotalAdded != 2 || result.TotalModified != 1 || result.TotalRemoved != 3 {
		t.Fatalf("totals = added %d modified %d removed %d", result.TotalAdded, result.TotalModified, result.TotalRemoved)
	}
	if len(result.Items) != 2 || result.Items[1].Error == nil || *result.Items[1].Error != "sync failed" {
		t.Fatalf("items = %#v", result.Items)
	}
	assertLLMSignaled(t, syncer)
}

func TestSyncDueItemsUsesDueReports(t *testing.T) {
	adapter := &fakeSyncAdapter{due: transactions.SyncReport{Items: []transactions.ItemReport{
		{Counts: transactions.ItemCounts{Added: 1}},
	}}}
	syncer := newUnitSyncer(adapter)

	result := syncer.SyncDueItems(context.Background())
	if result.TotalAdded != 1 || len(result.Items) != 1 {
		t.Fatalf("SyncDueItems() = %#v", result)
	}
	assertLLMSignaled(t, syncer)
}

func TestSyncItemByIDUsesMatchingAdapter(t *testing.T) {
	adapter := &fakeSyncAdapter{
		provider: accounts.SourceTablePlaidItem,
		connection: transactions.ItemReport{
			Counts: transactions.ItemCounts{Added: 1},
		},
	}
	syncer := newUnitSyncer(adapter)

	result := syncer.SyncItemByID(context.Background(), 1)
	if result.Added != 1 || result.Error != nil || adapter.conn != 1 {
		t.Fatalf("SyncItemByID() = %#v, adapter conn = %#v", result, adapter.conn)
	}
	assertLLMSignaled(t, syncer)
}

func TestSetLLMForwardsToWorker(t *testing.T) {
	syncer := newUnitSyncer(&fakeSyncAdapter{})
	if syncer.llm.Enabled() {
		t.Fatal("new worker should start disabled")
	}
	syncer.SetLLM(fakeCategorizer{})
	if !syncer.llm.Enabled() {
		t.Fatal("SetLLM did not enable worker")
	}
}

func TestItemResultSanitizesError(t *testing.T) {
	result := newUnitSyncer(&fakeSyncAdapter{}).itemResult(transactions.ItemReport{Err: errors.New("boom")})
	if result.Error == nil || *result.Error != "sync failed" {
		t.Fatalf("itemResult() = %#v", result)
	}
}

func TestNewConstructsSyncerWithRealStores(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t)
	accountsStore := accountsdb.New(store.Database())
	adminStore := admindb.New(store.Database())
	owner, itemID := testutil.SeedPlaidItem(t, accountsStore, adminStore, "item-1", "Owner")
	connectionName := "Institution"
	testutil.MustCreateConnection(t, accountsStore, itemID, &connectionName, owner.ID.Int64())
	if _, err := store.SQL().ExecContext(
		ctx,
		`UPDATE plaid_items SET sync_cron = ?, recurring_sync_cron = ?, next_sync_at = ? WHERE id = ?`,
		"0 * * * *",
		"0 * * * *",
		time.Date(2026, 6, 20, 11, 0, 0, 0, time.UTC),
		itemID,
	); err != nil {
		t.Fatalf("set plaid item cron: %v", err)
	}

	syncer := New(store.Database(), Config{
		Clients: testutil.StaticClientFactory{Client: txnsyncTestClient()},
		Now:     func() time.Time { return time.Date(2026, 6, 20, 12, 0, 0, 0, time.UTC) },
	}, testutil.Logger)
	result := syncer.SyncDueItems(ctx)
	if result.TotalAdded != 1 || len(result.Items) != 1 || result.Items[0].Error != nil {
		t.Fatalf("SyncDueItems() = %#v", result)
	}
	itemResult := syncer.SyncItemByID(ctx, itemID)
	if itemResult == nil || itemResult.Error != nil {
		t.Fatalf("SyncItemByID() = %#v", itemResult)
	}
	recurring := syncer.RecurringSyncAll(ctx)
	if len(recurring.Items) != 1 || recurring.Items[0].Error != nil {
		t.Fatalf("RecurringSyncAll() = %#v", recurring)
	}
}

func TestAccountEventSubscriberSyncsPlaidItemAfterDelay(t *testing.T) {
	ctx := context.Background()
	store := testutil.OpenStore(t)
	accountsStore := accountsdb.New(store.Database())
	adminStore := admindb.New(store.Database())
	account := testutil.SeedPlaidAccount(t, accountsStore, adminStore, "acc-1", "Owner")

	synced := make(chan struct{}, 1)
	syncer := New(store.Database(), Config{
		Clients: testutil.StaticClientFactory{Client: notifyingTxnsyncClient{
			PlaidClientStub: txnsyncTestClient(),
			synced:          synced,
		}},
		InitialSyncDelay: time.Hour,
	}, testutil.Logger)
	delays := make(chan time.Duration, 1)
	syncer.Sleep = func(_ context.Context, delay time.Duration) error {
		delays <- delay
		return nil
	}
	events := make(chan accounts.AccountsCreated, 1)
	syncer.Subscribe(events)
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go syncer.RunAccountEvents(runCtx)

	events <- accounts.AccountsCreated{Provider: accounts.SourceTablePlaidItem, SourceID: account.Connection.SourceID}

	select {
	case delay := <-delays:
		if delay != time.Hour {
			t.Fatalf("delay = %v, want 1h", delay)
		}
	case <-time.After(time.Second):
		t.Fatal("expected initial sync delay")
	}
	select {
	case <-synced:
	case <-time.After(time.Second):
		t.Fatal("expected plaid item sync")
	}
	waitForTransaction(t, store.SQL(), "tx-1")
}

func TestRunLoopsReturnWhenContextCancelled(t *testing.T) {
	store := testutil.OpenStore(t)
	syncer := New(store.Database(), Config{
		Clients: testutil.StaticClientFactory{Client: txnsyncTestClient()},
	}, testutil.Logger)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	syncer.Run(ctx)
	syncer.RecurringRun(ctx)
	syncer.RunLLMWorker(ctx)
}

func newUnitSyncer(adapter *fakeSyncAdapter) *Syncer {
	return &Syncer{
		adapters:         []transactions.SyncAdapter{adapter},
		persister:        &transactions.Persister{},
		llm:              &transactions.LLMWorker{Trigger: make(chan struct{}, 1)},
		trackingDisabled: func() bool { return false },
		log:              testutil.Logger,
	}
}

func assertLLMSignaled(t *testing.T, syncer *Syncer) {
	t.Helper()
	select {
	case <-syncer.llm.Trigger:
	default:
		t.Fatal("expected LLM signal")
	}
}

func waitForTransaction(t *testing.T, db *sql.DB, transactionID string) {
	t.Helper()
	deadline := time.After(time.Second)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var count int
		must.NoErr(t, db.QueryRowContext(
			context.Background(),
			`SELECT COUNT(*) FROM transactions WHERE external_id = ?`,
			transactionID,
		).Scan(&count))
		if count == 1 {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("transaction %q was not persisted", transactionID)
		case <-ticker.C:
		}
	}
}

type fakeSyncAdapter struct {
	due            transactions.SyncReport
	recurring      transactions.SyncReport
	connection     transactions.ItemReport
	conn           int64
	provider       accounts.SourceTable
	syncDueCalls   int
	recurringCalls int
}

func (a *fakeSyncAdapter) Handles(provider accounts.SourceTable) bool {
	return a.provider == "" || a.provider == provider
}

func (a *fakeSyncAdapter) SyncDue(ctx context.Context, sink transactions.PersistSink) transactions.SyncReport {
	a.syncDueCalls++
	return a.due
}

func (a *fakeSyncAdapter) SyncRecurringDue(ctx context.Context, sink transactions.PersistSink) transactions.SyncReport {
	a.recurringCalls++
	return a.recurring
}

func (a *fakeSyncAdapter) SyncConnectionInto(
	ctx context.Context,
	sourceID int64,
	sink transactions.PersistSink,
) transactions.ItemReport {
	a.conn = sourceID
	return a.connection
}

type fakeCategorizer struct{}

func (fakeCategorizer) CategorizeBatch(
	ctx context.Context,
	txns []categorizer.TransactionInput,
	globalExamples []categorizer.ExampleTransaction,
) ([]categorizer.LLMResult, error) {
	return []categorizer.LLMResult{}, nil
}

func (fakeCategorizer) BatchSize() int { return 5 }

type notifyingTxnsyncClient struct {
	testutil.PlaidClientStub
	synced chan struct{}
}

func (c notifyingTxnsyncClient) Sync(ctx context.Context, accessToken, cursor string) (plaidapi.TransactionsSyncResponse, error) {
	select {
	case c.synced <- struct{}{}:
	default:
	}
	return c.PlaidClientStub.Sync(ctx, accessToken, cursor)
}

func txnsyncTestClient() testutil.PlaidClientStub {
	accounts := func(context.Context, string) ([]plaidapi.AccountBase, error) {
		return []plaidapi.AccountBase{testutil.AccountBase("acc-1", "Checking", "", "depository", "checking")}, nil
	}
	return testutil.PlaidClientStub{
		AccountsFn:           accounts,
		AccountsBalanceGetFn: accounts,
		SyncFn: func(context.Context, string, string) (plaidapi.TransactionsSyncResponse, error) {
			tx := plaidapi.NewTransactionWithDefaults()
			tx.SetTransactionId("tx-1")
			tx.SetAccountId("acc-1")
			tx.SetAmount(10)
			tx.SetDate("2026-06-18")
			tx.SetName("Merchant")
			return plaidapi.TransactionsSyncResponse{
				Added:      []plaidapi.Transaction{*tx},
				NextCursor: "cursor-next",
				HasMore:    false,
			}, nil
		},
	}
}
