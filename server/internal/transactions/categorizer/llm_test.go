package categorizer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/nooplog"
	"testing"
)

var testCategories = []CategoryRef{
	{ID: 1, Name: "Groceries", GroupName: "Food & Drink"},
	{ID: 2, Name: "Coffee Shops", GroupName: "Food & Drink"},
	{ID: 3, Name: "Gas", GroupName: "Transportation"},
	{ID: 4, Name: "Rent", GroupName: "Housing"},
}

func newTestCategorizer(handler http.HandlerFunc) (*OllamaCategorizer, *httptest.Server) {
	server := httptest.NewServer(handler)
	cat := NewOllamaCategorizer(server.URL, "test-model", testCategories, nooplog.Logger)
	cat.httpClient = server.Client()
	return cat, server
}

func TestCategorizeBatchEmpty(t *testing.T) {
	lc := NewOllamaCategorizer("http://localhost:11434", "test", testCategories, nooplog.Logger)
	results, err := lc.CategorizeBatch(context.Background(), nil, nil)
	if err != nil || results != nil {
		t.Fatalf("CategorizeBatch(nil) = %v, %v", results, err)
	}
	results, err = lc.CategorizeBatch(context.Background(), []TransactionInput{}, nil)
	if err != nil || results != nil {
		t.Fatalf("CategorizeBatch([]) = %v, %v", results, err)
	}
}

func TestCategorizeBatchSuccess(t *testing.T) {
	resp := ollamaResponse{Response: `[{"transaction_index":1,"category_id":1,"confidence":"high"},{"transaction_index":2,"category_id":3,"confidence":"medium"}]`, Done: true}
	lc, server := newTestCategorizer(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/generate" {
			t.Fatalf("expected /api/generate, got %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		must.NoErr(t, json.NewEncoder(w).Encode(resp))
	})
	defer server.Close()

	txns := []TransactionInput{
		{ID: "tx-1", MerchantName: "Whole Foods", Amount: 45.20, PlaidCategory: "FOOD_AND_DRINK:GROCERIES"},
		{ID: "tx-2", MerchantName: "Shell", Amount: 55.00, PlaidCategory: "TRANSPORTATION:GAS"},
	}

	results, err := lc.CategorizeBatch(context.Background(), txns, nil)
	must.NoErr(t, err)
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if results[0].TransactionID != "tx-1" || results[0].CategoryID != 1 || results[0].Confidence != "high" {
		t.Fatalf("results[0] = %#v", results[0])
	}
	if results[1].TransactionID != "tx-2" || results[1].CategoryID != 3 || results[1].Confidence != "medium" {
		t.Fatalf("results[1] = %#v", results[1])
	}
}

func TestCategorizeBatchResponseCases(t *testing.T) {
	tests := map[string]struct {
		response          string
		txns              []TransactionInput
		wantCount         int
		wantTransactionID string
		wantCategoryID    int64
	}{
		"skips invalid category": {
			response: `[{"transaction_index":1,"category_id":999,"confidence":"high"},{"transaction_index":2,"category_id":1,"confidence":"medium"}]`,
			txns: []TransactionInput{
				{ID: "tx-1", MerchantName: "Unknown", Amount: 10},
				{ID: "tx-2", MerchantName: "Market", Amount: 20},
			},
			wantCount:         1,
			wantTransactionID: "tx-2",
		},
		"skips sentinel zero": {
			response:  `[{"transaction_index":1,"category_id":0,"confidence":"low"}]`,
			txns:      []TransactionInput{{ID: "tx-1", MerchantName: "Unknown", Amount: 10}},
			wantCount: 0,
		},
		"skips out-of-range index": {
			response:  `[{"transaction_index":99,"category_id":1,"confidence":"high"},{"transaction_index":0,"category_id":1,"confidence":"high"}]`,
			txns:      []TransactionInput{{ID: "tx-1", MerchantName: "Test", Amount: 10}},
			wantCount: 0,
		},
		"accepts wrapped response": {
			response:          `{"results":[{"transaction_index":1,"category_id":2,"confidence":"high"}]}`,
			txns:              []TransactionInput{{ID: "tx-1", MerchantName: "Starbucks", Amount: 5.50}},
			wantCount:         1,
			wantTransactionID: "tx-1",
			wantCategoryID:    2,
		},
		"prefers results over unrelated arrays": {
			response:          `{"skipped":[{"transaction_index":1,"category_id":3,"confidence":"high"}],"results":[{"transaction_index":1,"category_id":2,"confidence":"high"}]}`,
			txns:              []TransactionInput{{ID: "tx-1", MerchantName: "Starbucks", Amount: 5.50}},
			wantCount:         1,
			wantTransactionID: "tx-1",
			wantCategoryID:    2,
		},
		"skips low confidence": {
			response: `[{"transaction_index":1,"category_id":1,"confidence":"high"},{"transaction_index":2,"category_id":2,"confidence":"low"}]`,
			txns: []TransactionInput{
				{ID: "tx-1", MerchantName: "Whole Foods", Amount: 45},
				{ID: "tx-2", MerchantName: "Starbucks", Amount: 5},
			},
			wantCount:         1,
			wantTransactionID: "tx-1",
		},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			resp := ollamaResponse{Response: tc.response, Done: true}
			lc, server := newTestCategorizer(func(w http.ResponseWriter, _ *http.Request) {
				must.NoErr(t, json.NewEncoder(w).Encode(resp))
			})
			defer server.Close()

			results, err := lc.CategorizeBatch(context.Background(), tc.txns, nil)
			must.NoErr(t, err)
			if len(results) != tc.wantCount {
				t.Fatalf("result count = %d, want %d", len(results), tc.wantCount)
			}
			if tc.wantTransactionID != "" && results[0].TransactionID != tc.wantTransactionID {
				t.Fatalf("results[0].TransactionID = %q, want %q", results[0].TransactionID, tc.wantTransactionID)
			}
			if tc.wantCategoryID != 0 && results[0].CategoryID != tc.wantCategoryID {
				t.Fatalf("results[0].CategoryID = %d, want %d", results[0].CategoryID, tc.wantCategoryID)
			}
		})
	}
}

func TestParseResponseRejectsPartiallyDecodedArrays(t *testing.T) {
	results := parseResponse(`[{"transaction_index":1,"category_id":1,"confidence":"high"},{"transaction_index":"bad","category_id":2}]`, []TransactionInput{{ID: "tx-1", MerchantName: "Test"}}, testCategories, nooplog.Logger)
	if len(results) != 0 {
		t.Fatalf("parseResponse() = %#v, want no partial classifications", results)
	}
}

func TestCategorizeBatchOllamaError(t *testing.T) {
	lc, server := newTestCategorizer(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		if _, err := w.Write([]byte("model not found")); err != nil {
			t.Fatalf("write response: %v", err)
		}
	})
	defer server.Close()

	txns := []TransactionInput{{ID: "tx-1", MerchantName: "Test", Amount: 10}}
	results, err := lc.CategorizeBatch(context.Background(), txns, nil)
	if err == nil {
		t.Fatalf("CategorizeBatch() error = nil, want ollama error")
	}
	if len(results) != 0 {
		t.Fatalf("expected 0 results on ollama error, got %d", len(results))
	}
}

func TestCategorizeBatchUnparseableResponse(t *testing.T) {
	resp := ollamaResponse{Response: `I think this is a grocery store`, Done: true}
	lc, server := newTestCategorizer(func(w http.ResponseWriter, r *http.Request) {
		must.NoErr(t, json.NewEncoder(w).Encode(resp))
	})
	defer server.Close()

	txns := []TransactionInput{{ID: "tx-1", MerchantName: "Test", Amount: 10}}
	results, err := lc.CategorizeBatch(context.Background(), txns, nil)
	must.NoErr(t, err)
	if len(results) != 0 {
		t.Fatalf("expected 0 results for unparseable response, got %d", len(results))
	}
}

func TestCategorizeBatchContextCancellation(t *testing.T) {
	lc, server := newTestCategorizer(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	})
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	txns := []TransactionInput{{ID: "tx-1", MerchantName: "Test", Amount: 10}}
	results, err := lc.CategorizeBatch(ctx, txns, nil)
	if err == nil {
		t.Fatalf("CategorizeBatch() with cancelled context error = nil")
	}
	if len(results) != 0 {
		t.Fatalf("expected 0 results on cancelled context, got %d", len(results))
	}
}

func TestBuildPromptContainsAllCategories(t *testing.T) {
	txns := []TransactionInput{{ID: "tx-1", MerchantName: "Whole Foods", Amount: 45.20}}
	prompt := buildPrompt(testCategories, txns, nil)
	if !strings.Contains(prompt, "1 | Groceries") {
		t.Fatalf("prompt missing category Groceries")
	}
	if !strings.Contains(prompt, "3 | Gas") {
		t.Fatalf("prompt missing category Gas")
	}
	if !strings.Contains(prompt, "merchant: \"Whole Foods\"") {
		t.Fatalf("prompt missing merchant name")
	}
	if !strings.Contains(prompt, "amount: $45.20") {
		t.Fatalf("prompt missing amount")
	}
}

func TestBuildPromptOmitsDuplicateOriginalName(t *testing.T) {
	txns := []TransactionInput{
		{ID: "tx-1", MerchantName: "Starbucks", OriginalName: "Starbucks", Amount: 5},
		{ID: "tx-2", MerchantName: "Starbucks", OriginalName: "STARBUCKS #1234", Amount: 6},
	}
	prompt := buildPrompt(testCategories, txns, nil)
	if strings.Count(prompt, "raw_name") != 1 {
		t.Fatalf("expected raw_name to appear once (only when different), got %d", strings.Count(prompt, "raw_name"))
	}
}

func TestBuildPromptIncludesPlaidHint(t *testing.T) {
	txns := []TransactionInput{{ID: "tx-1", MerchantName: "Shell", Amount: 55, PlaidCategory: "TRANSPORTATION:GAS"}}
	prompt := buildPrompt(testCategories, txns, nil)
	if !strings.Contains(prompt, `plaid_hint: "TRANSPORTATION:GAS"`) {
		t.Fatalf("prompt missing plaid_hint")
	}
}

func TestParseResponseDefaultConfidence(t *testing.T) {
	txns := []TransactionInput{{ID: "tx-1", MerchantName: "Test", Amount: 10}}
	raw := `[{"transaction_index":1,"category_id":1}]`
	results := parseResponse(raw, txns, testCategories, nooplog.Logger)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Confidence != "medium" {
		t.Fatalf("expected default confidence 'medium', got %q", results[0].Confidence)
	}
}

func TestParseResponseSingleObjectSentinelZeroDoesNotWarn(t *testing.T) {
	var logs bytes.Buffer
	log := slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelWarn}))
	txns := []TransactionInput{{ID: "tx-1", MerchantName: "Unknown", Amount: 10}}
	results := parseResponse(`{"transaction_index":1,"category_id":0,"confidence":"low"}`, txns, testCategories, log)
	if len(results) != 0 {
		t.Fatalf("expected 0 results for sentinel category_id=0, got %d", len(results))
	}
	if strings.Contains(logs.String(), "could not parse response") {
		t.Fatalf("expected no parse warning, got logs: %s", logs.String())
	}
}

func TestParseResponseAcceptsInt64CategoryID(t *testing.T) {
	categoryID := int64(1 << 32)
	cats := []CategoryRef{{ID: categoryID, Name: "Large ID", GroupName: "Expense"}}
	txns := []TransactionInput{{ID: "tx-1", MerchantName: "Test", Amount: 10}}
	results := parseResponse(`[{"transaction_index":1,"category_id":4294967296,"confidence":"high"}]`, txns, cats, nooplog.Logger)
	if len(results) != 1 || results[0].CategoryID != categoryID {
		t.Fatalf("parseResponse() = %#v", results)
	}
}

func TestParseResponseMultipleResultsSameTransaction(t *testing.T) {
	txns := []TransactionInput{
		{ID: "tx-1", MerchantName: "Test", Amount: 10},
	}
	// low confidence is filtered; only the high-confidence result is returned
	raw := `[{"transaction_index":1,"category_id":1,"confidence":"high"},{"transaction_index":1,"category_id":3,"confidence":"low"}]`
	results := parseResponse(raw, txns, testCategories, nooplog.Logger)
	if len(results) != 1 {
		t.Fatalf("expected 1 result (low confidence filtered), got %d", len(results))
	}
	if results[0].CategoryID != 1 {
		t.Fatalf("expected high-confidence result (category_id=1), got %d", results[0].CategoryID)
	}
}

func TestNewOllamaCategorizerTrimsTrailingSlash(t *testing.T) {
	lc := NewOllamaCategorizer("http://ollama:11434/", "model", testCategories, nooplog.Logger)
	if lc.baseURL != "http://ollama:11434" {
		t.Fatalf("baseURL = %q, expected no trailing slash", lc.baseURL)
	}
}

func TestCategorizeBatchSendsOneOllamaRequest(t *testing.T) {
	callCount := 0
	lc, server := newTestCategorizer(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		var req ollamaRequest
		must.NoErr(t, json.NewDecoder(r.Body).Decode(&req))
		if txnsInPrompt(req.Prompt) != ollamaBatchSize+1 {
			t.Fatalf("prompt transaction count = %d, want %d", txnsInPrompt(req.Prompt), ollamaBatchSize+1)
		}
		resp := ollamaResponse{Response: `[]`, Done: true}
		must.NoErr(t, json.NewEncoder(w).Encode(resp))
	})
	defer server.Close()

	txns := make([]TransactionInput, ollamaBatchSize+1)
	for i := range txns {
		txns[i] = TransactionInput{ID: fmt.Sprintf("tx-%03d", i), MerchantName: "Test", Amount: 10}
	}
	_, err := lc.CategorizeBatch(context.Background(), txns, nil)
	must.NoErr(t, err)
	if callCount != 1 {
		t.Fatalf("API calls = %d, want 1", callCount)
	}
}

func txnsInPrompt(prompt string) int {
	count := 0
	for line := range strings.SplitSeq(prompt, "\n") {
		if strings.Contains(line, "merchant:") {
			count++
		}
	}
	return count
}

func TestBuildPromptIncludesGlobalExamples(t *testing.T) {
	globals := []ExampleTransaction{
		{MerchantName: "Whole Foods", Amount: 45, CategoryID: 1, CategoryName: "Groceries"},
		{MerchantName: "Shell", Amount: 55, CategoryID: 3, CategoryName: "Gas"},
	}
	txns := []TransactionInput{{ID: "tx-1", MerchantName: "Unknown", Amount: 10}}
	prompt := buildPrompt(testCategories, txns, globals)
	if !strings.Contains(prompt, `"Whole Foods" → Groceries (ID: 1)`) {
		t.Fatalf("prompt missing global example for Whole Foods; prompt:\n%s", prompt)
	}
	if !strings.Contains(prompt, `"Shell" → Gas (ID: 3)`) {
		t.Fatalf("prompt missing global example for Shell; prompt:\n%s", prompt)
	}
}

func TestBuildPromptIncludesSimilarExamples(t *testing.T) {
	txns := []TransactionInput{{
		ID:           "tx-1",
		MerchantName: "Amazon",
		Amount:       34.50,
		SimilarExamples: []ExampleTransaction{
			{MerchantName: "Amazon", Amount: 9.99, CategoryID: 2, CategoryName: "Coffee Shops"},
		},
	}}
	prompt := buildPrompt(testCategories, txns, nil)
	if !strings.Contains(prompt, "past categorized") {
		t.Fatalf("prompt missing per-txn similar examples section; prompt:\n%s", prompt)
	}
	if !strings.Contains(prompt, "$9.99") {
		t.Fatalf("prompt missing similar example amount; prompt:\n%s", prompt)
	}
	if !strings.Contains(prompt, "Coffee Shops") {
		t.Fatalf("prompt missing similar example category name; prompt:\n%s", prompt)
	}
}
