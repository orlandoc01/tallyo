package transactions_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"tallyo/internal/utils/test"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"tallyo/internal/utils/must"
)

func TestRecurringSyncAllUpdatesTimestamp(t *testing.T) {
	ctx := context.Background()
	fixture := newSeededSyncFixture(t, fakeClient{})
	setNextRecurringSyncAt(t, fixture.store, fixture.itemID, time.Now().UTC().Add(-time.Minute))

	fixture.syncer.RecurringSyncAll(ctx)

	val := mustPlaidItemLastRecurringSyncedAt(t, ctx, fixture.store, fixture.itemID)
	if val == nil || val.IsZero() {
		t.Fatal("expected non-zero recurring sync timestamp after RecurringSyncAll")
	}
}

func TestRecurringRunSyncsImmediatelyWhenNoState(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store := openPlaidSchedulerTestStore(t)
	itemID := seedPlaidItem(t, store, "item")

	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	setNextRecurringSyncAt(t, store, itemID, now.Add(-time.Minute))
	syncer := newTestSyncer(store, fakeClient{}, withNow(func() time.Time { return now }))
	done := make(chan struct{})
	go func() {
		defer close(done)
		syncer.RecurringRun(ctx)
	}()

	waitForRecurringSync(t, store, itemID, time.Time{})
	cancel()
	<-done
}

func TestRecurringRunWaitsUntilDueTime(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store := openPlaidSchedulerTestStore(t)
	itemID := seedPlaidItem(t, store, "item")

	lastCompleted := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	now := lastCompleted.Add(10 * time.Minute)
	must.NoErr(t, store.SetItemRecurringSynced(context.Background(), itemID, now.Add(time.Hour)))
	// Set the timestamp to a known value
	must.NoErr(t, store.SetPlaidItemLastRecurringSyncedAt(context.Background(), itemID, lastCompleted))

	// A not-yet-due item must not trigger a provider call at all: fail fast
	// rather than silently succeeding against PlaidClientStub's empty-response
	// default, which can't distinguish "correctly skipped" from "called but
	// the response happened to be a no-op". t.Error, not t.Fatal: RecurringRun
	// runs in its own goroutine below, and FailNow is only safe from the
	// test's own goroutine.
	failFast := func(context.Context, string, []string) (plaidapi.TransactionsRecurringGetResponse, error) {
		t.Error("TransactionsRecurringGet called for an item that is not yet due")
		return plaidapi.TransactionsRecurringGetResponse{}, fmt.Errorf("unreachable")
	}
	done := make(chan struct{})
	syncer := newTestSyncer(store, fakeClient{PlaidClientStub: test.PlaidClientStub{TransactionsRecurringGetFn: failFast}}, withNow(func() time.Time { return now }))
	go func() {
		defer close(done)
		syncer.RecurringRun(ctx)
	}()

	time.Sleep(25 * time.Millisecond)
	val := mustPlaidItemLastRecurringSyncedAt(t, context.Background(), store, itemID)
	// Should still be the same timestamp (no new sync)
	if val == nil || !val.Equal(lastCompleted) {
		t.Fatalf("expected recurring last_completed = %v, got %v", lastCompleted, val)
	}
	cancel()
	<-done
}

func TestRecurringRunSyncsWhenDueTimeElapsed(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store := openPlaidSchedulerTestStore(t)
	itemID := seedPlaidItem(t, store, "item")

	lastCompleted := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	now := lastCompleted.Add(2 * time.Hour)
	must.NoErr(t, store.SetItemRecurringSynced(context.Background(), itemID, now.Add(-time.Minute)))
	must.NoErr(t, store.SetPlaidItemLastRecurringSyncedAt(context.Background(), itemID, lastCompleted))

	syncer := newTestSyncer(store, fakeClient{}, withNow(func() time.Time { return now }))
	done := make(chan struct{})
	go func() {
		defer close(done)
		syncer.RecurringRun(ctx)
	}()

	waitForRecurringSync(t, store, itemID, lastCompleted)
	cancel()
	<-done
}

func setNextRecurringSyncAt(t *testing.T, store *transactionsTestStore, itemID int64, nextSyncAt time.Time) {
	t.Helper()
	must.NoErr(t, store.SetPlaidItemScheduleColumn(context.Background(), itemID, "next_recurring_sync_at", nextSyncAt))
}

func mustPlaidItemLastRecurringSyncedAt(t *testing.T, ctx context.Context, store *transactionsTestStore, itemID int64) *time.Time {
	t.Helper()
	value, err := store.PlaidItemLastRecurringSyncedAt(ctx, itemID)
	must.NoErr(t, err)
	return value
}

func waitForRecurringSync(t *testing.T, store *transactionsTestStore, itemID int64, previous time.Time) {
	t.Helper()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.After(time.Second)
	for {
		value := mustPlaidItemLastRecurringSyncedAt(t, context.Background(), store, itemID)
		if value != nil && (previous.IsZero() || !value.Equal(previous)) {
			return
		}
		select {
		case <-deadline:
			t.Fatal("RecurringRun did not sync")
		case <-ticker.C:
		}
	}
}
