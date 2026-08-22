package categorizer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// ollamaBatchSize is the number of transactions classified per Ollama call —
// small, because local models degrade on long classification lists.
const ollamaBatchSize = 5

// OllamaCategorizer uses a local Ollama instance to classify transactions
// that weren't matched by rules or Plaid category mapping.
type OllamaCategorizer struct {
	baseURL    string
	model      string
	httpClient *http.Client
	categories []CategoryRef
	log        *slog.Logger
}

func NewOllamaCategorizer(baseURL, model string, categories []CategoryRef, log *slog.Logger) *OllamaCategorizer {
	return &OllamaCategorizer{
		baseURL:    strings.TrimRight(baseURL, "/"),
		model:      model,
		httpClient: &http.Client{Timeout: 300 * time.Second},
		categories: categories,
		log:        log,
	}
}

func (lc *OllamaCategorizer) BatchSize() int { return ollamaBatchSize }

// CategorizeBatch classifies multiple transactions in a single LLM call.
// globalExamples is a slice of top-merchant historical examples injected into
// every prompt batch as a few-shot reference. Returns only successfully
// classified results; unparseable or low-confidence entries are dropped.
func (lc *OllamaCategorizer) CategorizeBatch(ctx context.Context, txns []TransactionInput, globalExamples []ExampleTransaction) ([]LLMResult, error) {
	if len(txns) == 0 {
		return nil, nil
	}

	prompt := buildPrompt(lc.categories, txns, globalExamples)
	resp, err := lc.callOllama(ctx, prompt)
	if err != nil {
		return nil, err
	}
	return parseResponse(resp, txns, lc.categories, lc.log), nil
}

type ollamaRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
	Stream bool   `json:"stream"`
	Format string `json:"format,omitempty"`
	// Think is sent as a literal false (no omitempty) so reasoning models
	// (qwen3, deepseek-r1, …) skip their <think> block and answer directly —
	// essential for fast, structured categorization on CPU. Non-reasoning
	// models (qwen2.5, llama3.1) accept think:false as a no-op.
	Think   bool           `json:"think"`
	Options map[string]any `json:"options,omitempty"`
}

type ollamaResponse struct {
	Response string `json:"response"`
	Done     bool   `json:"done"`
}

func (lc *OllamaCategorizer) callOllama(ctx context.Context, prompt string) (string, error) {
	reqBody := ollamaRequest{
		Model:  lc.model,
		Prompt: prompt,
		Stream: false,
		Format: "json",
		Think:  false,
		Options: map[string]any{
			"temperature": 0.1,
			"num_predict": 2048,
		},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, lc.baseURL+"/api/generate", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := lc.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("ollama http: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		respBody, err := io.ReadAll(resp.Body)
		if err != nil {
			return "", fmt.Errorf("read ollama error response: %w", err)
		}
		return "", fmt.Errorf("ollama returned %d: %s", resp.StatusCode, string(respBody))
	}

	var ollamaResp ollamaResponse
	if err := json.NewDecoder(resp.Body).Decode(&ollamaResp); err != nil {
		return "", fmt.Errorf("decode ollama response: %w", err)
	}

	return ollamaResp.Response, nil
}
