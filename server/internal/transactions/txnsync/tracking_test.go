package txnsync

import (
	"context"
	"testing"

	"tallyo/internal/accounts"
)

func TestTrackingDisabledSkipsDueAndRecurringSync(t *testing.T) {
	adapter := &fakeSyncAdapter{}
	syncer := newUnitSyncer(adapter)
	syncer.trackingDisabled = func() bool { return true }

	due := syncer.SyncDueItems(context.Background())
	if len(due.Items) != 0 || adapter.syncDueCalls != 0 {
		t.Fatalf("SyncDueItems() = %#v, syncDueCalls=%d", due, adapter.syncDueCalls)
	}
	assertLLMNotSignaled(t, syncer)

	recurring := syncer.RecurringSyncAll(context.Background())
	if len(recurring.Items) != 0 || adapter.recurringCalls != 0 {
		t.Fatalf("RecurringSyncAll() = %#v, recurringCalls=%d", recurring, adapter.recurringCalls)
	}
}

func TestTrackingDisabledSkipsAccountCreatedSync(t *testing.T) {
	adapter := &fakeSyncAdapter{provider: accounts.SourceTablePlaidItem}
	syncer := newUnitSyncer(adapter)
	syncer.trackingDisabled = func() bool { return true }

	syncer.syncAccountCreated(context.Background(), accounts.AccountsCreated{
		Provider: accounts.SourceTablePlaidItem,
		SourceID: 42,
	})
	if adapter.conn != 0 {
		t.Fatalf("SyncConnectionInto source = %d, want 0", adapter.conn)
	}
	assertLLMNotSignaled(t, syncer)
}

func assertLLMNotSignaled(t *testing.T, syncer *Syncer) {
	t.Helper()
	select {
	case <-syncer.llm.Trigger:
		t.Fatal("LLM was signaled")
	default:
	}
}
