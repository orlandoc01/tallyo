package transactions

import (
	"context"
	"errors"
	"reflect"
	"strconv"
	"testing"
	"time"

	"tallyo/internal/transactions/categorizer"
	"tallyo/internal/utils/nooplog"
)

func TestPersisterSessionAppliesEventsInOrder(t *testing.T) {
	store := &fakePersistStore{}
	persister := &Persister{Store: store, WithLLMStaging: func(upsert func(bool) error) error { return upsert(true) }}
	events, result := persister.Open(context.Background())

	events <- PersistEvent{AccountUpsert: &AccountDraft{ID: "acc-1"}}
	events <- PersistEvent{Upsert: &SyncedTransaction{ExternalID: "tx-1", AccountID: "acc-1"}}
	events <- PersistEvent{Removal: &RemovedTransaction{ID: "tx-2", Source: TransactionSourcePlaid}}
	events <- PersistEvent{Recurring: &RecurringChargeDraft{ExternalID: "rc-1", TransactionIDs: []string{"tx-1"}}}
	events <- PersistEvent{MarkRecurring: &MarkRecurringStep{SourceID: 1}}
	close(events)

	got := <-result
	if got.Err != nil {
		t.Fatalf("PersistResult.Err = %v", got.Err)
	}
	if got.Counts != (ItemCounts{AccountsUpserted: 1, Added: 1, Removed: 1}) {
		t.Fatalf("PersistResult.Counts = %#v", got.Counts)
	}
	if len(store.upserts) != 1 || !store.upserts[0].StageForLLM {
		t.Fatalf("upserts = %#v", store.upserts)
	}
	wantCalls := []string{"account:acc-1", "upsert:tx-1", "delete:tx-2", "recurring:rc-1", "replace:42", "mark:1"}
	if !reflect.DeepEqual(store.calls, wantCalls) {
		t.Fatalf("calls = %#v, want %#v", store.calls, wantCalls)
	}
}

func TestPersisterSessionKeepsDrainingAfterError(t *testing.T) {
	writeErr := errors.New("write failed")
	store := &fakePersistStore{upsertErr: writeErr}
	persister := &Persister{Store: store}
	events, result := persister.Open(context.Background())

	sent := make(chan struct{})
	go func() {
		events <- PersistEvent{Upsert: &SyncedTransaction{ExternalID: "tx-1"}}
		events <- PersistEvent{Removal: &RemovedTransaction{ID: "tx-2", Source: TransactionSourcePlaid}}
		events <- PersistEvent{Recurring: &RecurringChargeDraft{ExternalID: "rc-1"}}
		events <- PersistEvent{MarkRecurring: &MarkRecurringStep{SourceID: 1}}
		close(events)
		close(sent)
	}()

	select {
	case <-sent:
	case <-time.After(time.Second):
		t.Fatal("persister did not drain events after first write error")
	}
	got := <-result
	if !errors.Is(got.Err, writeErr) {
		t.Fatalf("PersistResult.Err = %v, want %v", got.Err, writeErr)
	}
	if got.Counts != (ItemCounts{}) {
		t.Fatalf("PersistResult.Counts = %#v", got.Counts)
	}
	if !reflect.DeepEqual(store.calls, []string{"upsert:tx-1"}) {
		t.Fatalf("calls after error = %#v", store.calls)
	}
}

func TestLLMDisableWaitsForInFlightStaging(t *testing.T) {
	store := &stagingStore{cleared: make(chan struct{})}
	worker := &LLMWorker{Store: store, Log: nooplog.Logger}
	worker.SetLLM(stagedCategorizer{})

	staged := make(chan struct{})
	release := make(chan struct{})
	stagingDone := make(chan struct{})
	go func() {
		_ = worker.WithStaging(func(stageForLLM bool) error {
			if !stageForLLM {
				t.Error("WithStaging() passed false while the worker was enabled")
			}
			close(staged)
			<-release
			return nil
		})
		close(stagingDone)
	}()
	<-staged

	disabled := make(chan struct{})
	go func() {
		worker.SetLLM(nil)
		close(disabled)
	}()
	select {
	case <-disabled:
		t.Fatal("SetLLM(nil) cleared staged rows before the in-flight upsert completed")
	case <-time.After(100 * time.Millisecond):
	}
	close(release)
	<-stagingDone
	<-disabled
	<-store.cleared
}

func TestLLMDisableWaitsForReprocessStaging(t *testing.T) {
	store := &stagingStore{cleared: make(chan struct{})}
	worker := &LLMWorker{Store: store, Log: nooplog.Logger, Trigger: make(chan struct{}, 1)}
	worker.SetLLM(stagedCategorizer{})

	staging := make(chan struct{})
	release := make(chan struct{})
	reprocessDone := make(chan struct{})
	go func() {
		_, _ = worker.ReprocessUncategorized(context.Background(), reprocessQueue{
			stage: func(context.Context) (int64, error) {
				close(staging)
				<-release
				return 1, nil
			},
		})
		close(reprocessDone)
	}()
	<-staging

	disabled := make(chan struct{})
	go func() {
		worker.SetLLM(nil)
		close(disabled)
	}()
	select {
	case <-disabled:
		t.Fatal("SetLLM(nil) cleared staged rows before reprocessing finished staging")
	case <-time.After(100 * time.Millisecond):
	}
	close(release)
	<-reprocessDone
	<-disabled
	<-store.cleared
}

type reprocessQueue struct {
	stage func(context.Context) (int64, error)
}

func (q reprocessQueue) StageUncategorizedForLLM(ctx context.Context) (int64, error) {
	return q.stage(ctx)
}

type stagedCategorizer struct{}

func (stagedCategorizer) CategorizeBatch(context.Context, []categorizer.TransactionInput, []categorizer.ExampleTransaction) ([]categorizer.LLMResult, error) {
	return nil, nil
}

func (stagedCategorizer) BatchSize() int { return 1 }

type stagingStore struct{ cleared chan struct{} }

func (s *stagingStore) UncategorizedForLLM(context.Context, int) ([]categorizer.TransactionInput, error) {
	return nil, nil
}

func (s *stagingStore) TopMerchantExamples(context.Context, int) ([]categorizer.ExampleTransaction, error) {
	return nil, nil
}

func (s *stagingStore) SimilarCategorizedByMerchants(context.Context, []string, int) (map[string][]categorizer.ExampleTransaction, error) {
	return map[string][]categorizer.ExampleTransaction{}, nil
}

func (s *stagingStore) ApplyLLMCategory(context.Context, string, int64) error { return nil }

func (s *stagingStore) ClearStagedForLLM(context.Context) error {
	close(s.cleared)
	return nil
}

func (s *stagingStore) ClearStagedForLLMByIDs(context.Context, []string) error { return nil }

type fakePersistStore struct {
	calls     []string
	upserts   []SyncedTransaction
	upsertErr error
}

func (s *fakePersistStore) UpsertSyncedAccount(ctx context.Context, draft AccountDraft) error {
	s.calls = append(s.calls, "account:"+draft.ID)
	return nil
}

func (s *fakePersistStore) DeleteSyncedTransaction(ctx context.Context, source, id string) (bool, error) {
	s.calls = append(s.calls, "delete:"+id)
	return true, nil
}

func (s *fakePersistStore) UpsertSyncedTransaction(ctx context.Context, tx SyncedTransaction) (bool, error) {
	s.calls = append(s.calls, "upsert:"+tx.ExternalID)
	s.upserts = append(s.upserts, tx)
	return true, s.upsertErr
}

func (s *fakePersistStore) UpsertRecurringCharge(ctx context.Context, charge RecurringChargeDraft) (int64, error) {
	s.calls = append(s.calls, "recurring:"+charge.ExternalID)
	return 42, nil
}

func (s *fakePersistStore) ReplaceChargeTxns(ctx context.Context, chargeID int64, txnIDs []string) error {
	s.calls = append(s.calls, "replace:"+strconv.FormatInt(chargeID, 10))
	return nil
}

func (s *fakePersistStore) MarkRecurringFromStreams(ctx context.Context, itemID int64) error {
	s.calls = append(s.calls, "mark:"+strconv.FormatInt(itemID, 10))
	return nil
}
