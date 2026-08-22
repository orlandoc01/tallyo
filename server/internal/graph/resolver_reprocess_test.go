package graph

import (
	"context"
	"errors"
	"strconv"
	"testing"

	"tallyo/internal/apierror"
	"tallyo/internal/transactions"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func TestReprocessUncategorizedTransactionsRejectsDisabledLLM(t *testing.T) {
	resolver, store := testResolver(t)
	test.SeedPlaidAccount(t, store.Accounts, store.AdminDB, "acc", "alex")
	seedResolverTransaction(t, store, "disabled", "2026-05-20", 12.34)
	reprocessor := &recordingLLMReprocessor{}
	resolver.LLM = reprocessor

	_, err := resolver.Mutation().(*mutationResolver).ReprocessUncategorizedTransactions(context.Background())
	var publicError *apierror.Error
	if !errors.As(err, &publicError) || publicError.Message != "LLM categorization is not enabled" {
		t.Fatalf("ReprocessUncategorizedTransactions() error = %v", err)
	}
	if reprocessor.signals != 0 {
		t.Fatalf("signals = %d, want 0", reprocessor.signals)
	}
	staged, err := store.Transactions.UncategorizedForLLM(context.Background(), 10)
	must.NoErr(t, err)
	if len(staged) != 0 {
		t.Fatalf("staged transactions = %#v, want none", staged)
	}
}

func TestReprocessUncategorizedTransactionsStagesAndSignals(t *testing.T) {
	resolver, store := testResolver(t)
	test.SeedPlaidAccount(t, store.Accounts, store.AdminDB, "acc", "alex")
	transactionID := seedResolverTransaction(t, store, "enabled", "2026-05-20", 12.34)
	reprocessor := &recordingLLMReprocessor{enabled: true}
	resolver.LLM = reprocessor

	result, err := resolver.Mutation().(*mutationResolver).ReprocessUncategorizedTransactions(context.Background())
	must.NoErr(t, err)
	if result.StagedCount != 1 || reprocessor.signals != 1 {
		t.Fatalf("result = %#v, signals = %d", result, reprocessor.signals)
	}
	staged, err := store.Transactions.UncategorizedForLLM(context.Background(), 10)
	must.NoErr(t, err)
	if len(staged) != 1 || staged[0].ID != strconv.FormatInt(transactionID.Int64(), 10) {
		t.Fatalf("staged transactions = %#v", staged)
	}
}

type recordingLLMReprocessor struct {
	enabled bool
	signals int
}

func (s *recordingLLMReprocessor) ReprocessUncategorized(
	ctx context.Context,
	queue transactions.LLMStagingStore,
) (int64, error) {
	if !s.enabled {
		return 0, transactions.ErrLLMDisabled
	}
	staged, err := queue.StageUncategorizedForLLM(ctx)
	if err == nil {
		s.signals++
	}
	return staged, err
}
