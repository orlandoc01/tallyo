package transactions

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"tallyo/internal/transactions/categorizer"
	u "tallyo/internal/utils"

	"github.com/samber/lo"
)

// llmBatchLimit caps how many uncategorized transactions we send to the LLM
// per sync cycle to keep each drain bounded.
const llmBatchLimit = 200

// ErrLLMDisabled indicates that no categorizer is active.
var ErrLLMDisabled = errors.New("llm categorization is not enabled")

type LLMWorker struct {
	Store   LLMStore
	Log     *slog.Logger
	mu      sync.RWMutex
	llm     Categorizer
	Trigger chan struct{}
}

// RunWorker is a long-lived goroutine that processes LLM categorization
// triggers from sync runs. On each trigger it drains all staged-for-LLM
// transactions, categorizing and un-staging them in batches so they surface to
// the user as they are processed.
func (w *LLMWorker) RunWorker(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-w.Trigger:
			if !w.Enabled() {
				continue
			}
			w.drain(ctx)
		}
	}
}

// drain categorizes staged transactions one page at a time until none remain.
// Each page un-stages its rows as it processes them, so the next fetch advances;
// returning on the first error avoids re-fetching a page we failed to advance.
func (w *LLMWorker) drain(ctx context.Context) {
	for {
		n, err := w.Categorize(ctx)
		if err != nil {
			w.Log.Error("llm categorization failed", "error", err)
			return
		}
		if n == 0 {
			return
		}
	}
}

func (w *LLMWorker) SetLLM(llm Categorizer) {
	w.mu.Lock()
	prev := w.llm
	w.llm = llm
	var clearErr error
	if llm == nil && prev != nil {
		clearErr = w.Store.ClearStagedForLLM(context.Background())
	}
	w.mu.Unlock()
	if llm != nil || prev == nil {
		return
	}
	if clearErr != nil {
		w.Log.Error("clear staged transactions on llm disable", "error", clearErr)
		return
	}
	w.Log.Info("llm categorization disabled; cleared staged transactions")
}

func (w *LLMWorker) Enabled() bool {
	return w.getLLM() != nil
}

func (w *LLMWorker) WithStaging(upsert func(stageForLLM bool) error) error {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return upsert(w.llm != nil)
}

func (w *LLMWorker) Signal() {
	select {
	case w.Trigger <- struct{}{}:
	default:
	}
}

func (w *LLMWorker) ReprocessUncategorized(
	ctx context.Context,
	queue LLMStagingStore,
) (int64, error) {
	w.mu.RLock()
	defer w.mu.RUnlock()
	if w.llm == nil {
		return 0, ErrLLMDisabled
	}
	staged, err := queue.StageUncategorizedForLLM(ctx)
	if err != nil {
		return 0, err
	}
	w.Signal()
	return staged, nil
}

func (w *LLMWorker) getLLM() Categorizer {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return w.llm
}

// Categorize fetches one page of uncategorized transactions (up to
// llmBatchLimit) and sends them to the LLM in batches, enriched with few-shot
// examples drawn from the household's own reviewed+settled history. Each batch
// is applied and un-staged as soon as it is classified, so progress survives an
// interrupted run. Returns the number of transactions processed this page so the
// caller can keep draining until none remain.
func (w *LLMWorker) Categorize(ctx context.Context) (int, error) {
	txns, err := w.Store.UncategorizedForLLM(ctx, llmBatchLimit)
	if err != nil {
		return 0, fmt.Errorf("fetch uncategorized: %w", err)
	}
	if len(txns) == 0 {
		return 0, nil
	}

	globalExamples, err := w.Store.TopMerchantExamples(ctx, 20)
	if err != nil {
		w.Log.Error("failed to fetch global llm examples", "error", err)
		globalExamples = nil
	}
	txns = w.annotateSimilarExamples(ctx, txns)

	llm := w.getLLM()
	if llm == nil {
		return 0, nil
	}

	w.Log.Info("running llm categorization", "uncategorized", len(txns), "global_examples", len(globalExamples))

	toTxnByID := func(txn categorizer.TransactionInput) (string, categorizer.TransactionInput) {
		return txn.ID, txn
	}
	txnByID := lo.SliceToMap(txns, toTxnByID)

	batchSize := llm.BatchSize()
	totalBatches := (len(txns) + batchSize - 1) / batchSize
	var applied int
	for i := 0; i < len(txns); i += batchSize {
		end := min(i+batchSize, len(txns))
		batch := txns[i:end]

		results, err := llm.CategorizeBatch(ctx, batch, globalExamples)
		if err != nil {
			return len(txns), fmt.Errorf("categorize batch: %w", err)
		}
		batchApplied, err := w.applyResults(ctx, results, txnByID)
		if err != nil {
			return len(txns), err
		}
		applied += batchApplied
		if err := w.unstageBatch(ctx, batch); err != nil {
			return len(txns), fmt.Errorf("clear staged batch: %w", err)
		}

		w.Log.Info("llm categorization progress",
			"batch", i/batchSize+1,
			"batches", totalBatches,
			"processed", end,
			"total", len(txns),
			"categorized", applied,
		)
	}

	w.Log.Info("llm categorization complete", "submitted", len(txns), "categorized", applied)
	return len(txns), nil
}

// applyResults writes the LLM's categories, skipping low-confidence overrides of
// transactions that already had a Plaid PFC2 match. Returns the count applied.
func (w *LLMWorker) applyResults(
	ctx context.Context,
	results []categorizer.LLMResult,
	txnByID map[string]categorizer.TransactionInput,
) (int, error) {
	var applied int
	for _, r := range results {
		if txnByID[r.TransactionID].HasPFC2Match && r.Confidence != "high" {
			continue
		}
		if err := w.Store.ApplyLLMCategory(ctx, r.TransactionID, r.CategoryID); err != nil {
			return applied, fmt.Errorf("apply llm category %s: %w", r.TransactionID, err)
		}
		applied++
		w.Log.Info("llm categorized", "txn_id", r.TransactionID, "category", r.CategoryName, "confidence", r.Confidence)
	}
	return applied, nil
}

// unstageBatch clears the staged_for_llm flag for an entire processed batch.
// Matched rows were already cleared by ApplyLLMCategory; this covers the rest so
// the batch is not re-fetched on the next drain pass.
func (w *LLMWorker) unstageBatch(ctx context.Context, batch []categorizer.TransactionInput) error {
	ids := u.Map(batch, func(t categorizer.TransactionInput) string { return t.ID })
	return w.Store.ClearStagedForLLMByIDs(ctx, ids)
}

// annotateSimilarExamples fetches per-merchant examples from settled history in
// one batch query and attaches them to each transaction.
func (w *LLMWorker) annotateSimilarExamples(ctx context.Context, txns []categorizer.TransactionInput) []categorizer.TransactionInput {
	toMerchantName := func(txn categorizer.TransactionInput, _ int) (string, bool) {
		return txn.MerchantName, txn.MerchantName != ""
	}
	merchantNames := lo.Uniq(lo.FilterMap(txns, toMerchantName))
	examplesByMerchant, err := w.Store.SimilarCategorizedByMerchants(ctx, merchantNames, 3)
	if err != nil {
		w.Log.Error("failed to fetch similar examples", "error", err)
		return txns
	}
	for i, txn := range txns {
		txns[i].SimilarExamples = examplesByMerchant[strings.ToLower(txn.MerchantName)]
	}
	return txns
}
