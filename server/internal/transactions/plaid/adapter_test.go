package txnplaid

import (
	"context"
	"errors"
	"slices"
	"testing"

	"tallyo/internal/graph/model"
	"tallyo/internal/transactions"
	testutil "tallyo/internal/utils/test"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"tallyo/internal/utils/must"
)

func TestSyncItemAdvancesCursorAndHealthAfterAckOK(t *testing.T) {
	store, adapter := newHandshakeTest()
	sink := &handshakeSink{result: transactions.PersistResult{Counts: transactions.ItemCounts{Added: 1}}}

	report := adapter.syncItem(context.Background(), store.item, sink)
	if report.Err != nil {
		t.Fatalf("syncItem() error = %v", report.Err)
	}
	if store.cursor != "cursor-next" {
		t.Fatalf("cursor = %q", store.cursor)
	}
	if store.nextSyncAt.IsZero() {
		t.Fatal("expected next sync timestamp to be set")
	}
	if !store.healthy || store.healthTouched {
		t.Fatalf("health updates: healthy=%v touched=%v", store.healthy, store.healthTouched)
	}
	if len(sink.events) != 2 || sink.events[0].AccountUpsert == nil || sink.events[1].Upsert == nil {
		t.Fatalf("sink events = %#v", sink.events)
	}
}

func TestSyncItemAckErrorLeavesCursorAndHealthUntouched(t *testing.T) {
	writeErr := errors.New("persist failed")
	store, adapter := newHandshakeTest()
	sink := &handshakeSink{result: transactions.PersistResult{Err: writeErr}}

	report := adapter.syncItem(context.Background(), store.item, sink)
	if !errors.Is(report.Err, writeErr) {
		t.Fatalf("syncItem() error = %v, want %v", report.Err, writeErr)
	}
	if store.cursor != "" || !store.nextSyncAt.IsZero() {
		t.Fatalf("cursor advanced on ack error: cursor=%q next=%v", store.cursor, store.nextSyncAt)
	}
	if store.healthy || store.healthTouched {
		t.Fatalf("health changed on ack error: healthy=%v touched=%v", store.healthy, store.healthTouched)
	}
	if len(sink.events) != 2 || sink.events[0].AccountUpsert == nil || sink.events[1].Upsert == nil {
		t.Fatalf("sink events = %#v", sink.events)
	}
}

func TestSyncItemFetchErrorDoesNotOpenSession(t *testing.T) {
	fetchErr := errors.New("plaid fetch failed")
	store, adapter := newHandshakeTest()
	sink := &handshakeSink{}
	client := handshakeClient()
	client.SyncFn = handshakeSync(fetchErr)
	adapter.clients = testutil.StaticClientFactory{Client: client}

	report := adapter.syncItem(context.Background(), store.item, sink)
	if !errors.Is(report.Err, fetchErr) {
		t.Fatalf("syncItem() error = %v, want %v", report.Err, fetchErr)
	}
	if !sink.opened {
		t.Fatal("sink not opened for account drafts before transaction fetch error")
	}
	if len(sink.events) != 1 || sink.events[0].AccountUpsert == nil {
		t.Fatalf("sink events = %#v", sink.events)
	}
	if store.cursor != "" || store.healthy || store.healthTouched {
		t.Fatalf("unexpected item writes: cursor=%q healthy=%v healthTouched=%v", store.cursor, store.healthy, store.healthTouched)
	}
}

func TestSyncItemInvestmentOnlyAdvancesWithoutCursor(t *testing.T) {
	store, adapter := newHandshakeTest()
	store.item.InvestmentsEnabled = true
	syncCalls := 0
	client := customAccountsClient(
		[]plaidapi.AccountBase{plaidAccount("acc-1", "Brokerage", "investment")},
		investmentTransactionsResponse(),
		&syncCalls,
	)
	adapter.clients = testutil.StaticClientFactory{Client: client}
	sink := &handshakeSink{result: transactions.PersistResult{Counts: transactions.ItemCounts{Added: 1}}}

	report := adapter.syncItem(context.Background(), store.item, sink)
	if report.Err != nil {
		t.Fatalf("syncItem() error = %v", report.Err)
	}
	if syncCalls != 0 {
		t.Fatalf("expected /transactions/sync to be skipped, called %d times", syncCalls)
	}
	if store.cursor != "" {
		t.Fatalf("expected cursor untouched, got %q", store.cursor)
	}
	if store.nextSyncAt.IsZero() {
		t.Fatal("expected next sync timestamp to advance")
	}
	if !store.healthy {
		t.Fatal("expected item marked healthy")
	}
	if len(sink.events) != 2 || sink.events[0].AccountUpsert == nil || sink.events[1].Upsert == nil {
		t.Fatalf("sink events = %#v", sink.events)
	}
}

func TestSyncItemLoanOnlySkipsPlaidCallsAndAdvances(t *testing.T) {
	store, adapter := newHandshakeTest()
	syncCalls := 0
	client := customAccountsClient(
		[]plaidapi.AccountBase{plaidAccount("acc-1", "Mortgage", "loan")},
		plaidapi.InvestmentsTransactionsGetResponse{},
		&syncCalls,
	)
	adapter.clients = testutil.StaticClientFactory{Client: client}
	sink := &handshakeSink{}

	report := adapter.syncItem(context.Background(), store.item, sink)
	if report.Err != nil {
		t.Fatalf("syncItem() error = %v", report.Err)
	}
	if syncCalls != 0 {
		t.Fatalf("expected /transactions/sync to be skipped, called %d times", syncCalls)
	}
	if !sink.opened {
		t.Fatal("expected persist session opened for account drafts")
	}
	if len(sink.events) != 1 || sink.events[0].AccountUpsert == nil {
		t.Fatalf("sink events = %#v", sink.events)
	}
	if store.cursor != "" {
		t.Fatalf("expected cursor untouched, got %q", store.cursor)
	}
	if store.nextSyncAt.IsZero() {
		t.Fatal("expected next sync timestamp to advance")
	}
	if !store.healthy {
		t.Fatal("expected item marked healthy")
	}
}

func TestAdapterEntryPoints(t *testing.T) {
	store, adapter := newHandshakeTest()
	sink := &handshakeSink{result: transactions.PersistResult{Counts: transactions.ItemCounts{Added: 1}}}

	due := adapter.SyncDue(context.Background(), sink)
	if len(due.Items) != 1 || due.Items[0].Err != nil {
		t.Fatalf("SyncDue() = %#v", due)
	}
	found := adapter.SyncConnectionInto(context.Background(), store.item.ID, sink)
	if found.Err != nil {
		t.Fatalf("SyncConnectionInto(found) error = %v", found.Err)
	}
	missing := adapter.SyncConnectionInto(context.Background(), 999, sink)
	if missing.Err == nil {
		t.Fatalf("expected missing item error, got %#v", missing)
	}
}

func TestSyncRecurringItemStreamsDraftsAndAdvancesSchedule(t *testing.T) {
	store, adapter := newHandshakeTest()
	var accountIDs []string
	adapter.clients = testutil.StaticClientFactory{Client: recurringClient(recurringResponse(), nil, &accountIDs)}
	sink := &handshakeSink{}

	report := adapter.syncRecurringItem(context.Background(), store.item, sink)
	if report.Err != nil {
		t.Fatalf("syncRecurringItem() error = %v", report.Err)
	}
	if store.nextRecurringAt.IsZero() {
		t.Fatal("expected recurring sync timestamp to advance")
	}
	if !slices.Equal(accountIDs, []string{"plaid-checking-id"}) {
		t.Fatalf("recurring account IDs = %v, want Plaid external IDs", accountIDs)
	}
	if len(sink.events) != 2 || sink.events[0].Recurring == nil || sink.events[1].MarkRecurring == nil {
		t.Fatalf("recurring events = %#v", sink.events)
	}
	draft := sink.events[0].Recurring
	if draft.ExternalID != "stream-1" || draft.AccountID != "acc-1" || len(draft.TransactionIDs) != 1 {
		t.Fatalf("recurring draft = %#v", draft)
	}
}

func TestSyncRecurringItemFetchErrorLogsAndAdvancesOnly(t *testing.T) {
	fetchErr := errors.New("recurring fetch failed")
	store, adapter := newHandshakeTest()
	adapter.clients = testutil.StaticClientFactory{Client: recurringClient(plaidapi.TransactionsRecurringGetResponse{}, fetchErr, nil)}
	sink := &handshakeSink{}

	report := adapter.syncRecurringItem(context.Background(), store.item, sink)
	if report.Err != nil {
		t.Fatalf("syncRecurringItem() error = %v", report.Err)
	}
	if store.nextRecurringAt.IsZero() {
		t.Fatal("expected recurring sync timestamp to advance")
	}
	if store.healthTouched || store.healthy {
		t.Fatalf("health changed on recurring fetch error: healthy=%v touched=%v", store.healthy, store.healthTouched)
	}
	if sink.opened {
		t.Fatal("sink opened on recurring fetch error")
	}
}

func TestStreamInvestmentTransactionsEmitsUpserts(t *testing.T) {
	store, adapter := newHandshakeTest()
	client := investmentStreamClient(investmentTransactionsResponse())
	sink := &handshakeSink{}
	ctx := context.Background()
	events, result := sink.Open(ctx)
	sync := itemSync{
		adapter: adapter,
		ctx:     ctx,
		client:  client,
		item:    store.item,
	}

	must.NoErr(t, sync.streamInvestmentTransactions(
		[]string{"acc-1"},
		events,
	))
	close(events)
	<-result

	if len(sink.events) != 1 || sink.events[0].Upsert == nil {
		t.Fatalf("investment events = %#v", sink.events)
	}
	upsert := sink.events[0].Upsert
	if upsert.ExternalID != "itx-1" || upsert.AccountID != "acc-1" || upsert.MerchantName == nil {
		t.Fatalf("investment upsert = %#v", upsert)
	}
}

func TestRecordItemSyncErrorMapsLoginRequired(t *testing.T) {
	store, adapter := newHandshakeTest()
	plaidErr := *plaidapi.NewPlaidError(
		plaidapi.PLAIDERRORTYPE_ITEM_ERROR,
		"ITEM_LOGIN_REQUIRED",
		"login required",
		plaidapi.NullableString{},
	)
	err := plaidapi.MakeGenericOpenAPIError(nil, "login required", plaidErr)

	adapter.recordItemSyncError(context.Background(), store.item.ID, err)
	if store.healthState != model.PlaidItemHealthStateLinkUpdateRequired || store.healthCode == nil || *store.healthCode != "ITEM_LOGIN_REQUIRED" {
		t.Fatalf("health state = %s code = %#v", store.healthState, store.healthCode)
	}
}
