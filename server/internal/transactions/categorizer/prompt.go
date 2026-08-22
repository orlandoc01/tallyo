package categorizer

import (
	"cmp"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
)

// CategoryRef is a lightweight reference used in LLM prompts.
type CategoryRef struct {
	ID        int64
	Name      string
	GroupName string
}

// ExampleTransaction is a historical categorized transaction used as a few-shot
// prompt example. Both global (top-merchants) and per-transaction similar
// examples use this type.
type ExampleTransaction struct {
	MerchantName string
	Amount       float64
	CategoryID   int64
	CategoryName string
}

// TransactionInput holds the fields sent to the LLM for classification.
type TransactionInput struct {
	ID              string
	MerchantName    string
	OriginalName    string
	Amount          float64
	PlaidCategory   string
	HasPFC2Match    bool
	SimilarExamples []ExampleTransaction // per-transaction few-shot context
}

// LLMResult pairs a transaction ID with the category the LLM chose.
type LLMResult struct {
	TransactionID string
	CategoryID    int64
	CategoryName  string
	Confidence    string // "high", "medium", "low" — advisory only
}

func buildPrompt(categories []CategoryRef, txns []TransactionInput, globalExamples []ExampleTransaction) string {
	var b strings.Builder

	b.WriteString("You are a personal finance transaction categorizer. ")
	b.WriteString("Classify each transaction into exactly one category from the list below.\n\n")

	b.WriteString("CATEGORIES (id | group | name):\n")
	currentGroup := ""
	for _, c := range categories {
		if c.GroupName != currentGroup {
			currentGroup = c.GroupName
			fmt.Fprintf(&b, "\n[%s]\n", currentGroup)
		}
		fmt.Fprintf(&b, "  %d | %s\n", c.ID, c.Name)
	}

	if len(globalExamples) > 0 {
		b.WriteString("\nEXAMPLES FROM YOUR TRANSACTION HISTORY:\n")
		for _, ex := range globalExamples {
			fmt.Fprintf(&b, "  %q → %s (ID: %d)\n", ex.MerchantName, ex.CategoryName, ex.CategoryID)
		}
	}

	b.WriteString("\nIMPORTANT RULES:\n")
	b.WriteString("- Respond ONLY with valid JSON, no markdown, no explanation.\n")
	b.WriteString("- Use the exact category ID from the list above.\n")
	b.WriteString("- If you are not confident, set confidence to \"low\".\n")
	b.WriteString("- If you truly cannot determine a category, use category_id: 0.\n")
	b.WriteString("- plaid_hint is a hint only — it may be wrong. Prefer merchant name over plaid_hint.\n")

	b.WriteString("\nTRANSACTIONS TO CLASSIFY:\n")
	for i, txn := range txns {
		fmt.Fprintf(&b, "\n%d. merchant: %q", i+1, txn.MerchantName)
		if txn.OriginalName != "" && txn.OriginalName != txn.MerchantName {
			fmt.Fprintf(&b, ", raw_name: %q", txn.OriginalName)
		}
		fmt.Fprintf(&b, ", amount: $%.2f", txn.Amount)
		if txn.PlaidCategory != "" {
			fmt.Fprintf(&b, ", plaid_hint: %q", txn.PlaidCategory)
		}
		if len(txn.SimilarExamples) > 0 {
			b.WriteString("\n   (past categorized:")
			for j, ex := range txn.SimilarExamples {
				if j > 0 {
					b.WriteString(",")
				}
				fmt.Fprintf(&b, " $%.2f→%s (ID: %d)", ex.Amount, ex.CategoryName, ex.CategoryID)
			}
			b.WriteString(")")
		}
	}

	b.WriteString("\n\nRespond with a JSON array:\n")
	b.WriteString(`[{"transaction_index": 1, "category_id": <id>, "confidence": "high"|"medium"|"low"}, ...]`)
	b.WriteString("\n")

	return b.String()
}

type llmClassification struct {
	TransactionIndex int    `json:"transaction_index"`
	CategoryID       int64  `json:"category_id"`
	Confidence       string `json:"confidence"`
}

func parseResponse(raw string, txns []TransactionInput, categories []CategoryRef, log *slog.Logger) []LLMResult {
	validCats := make(map[int64]string, len(categories))
	for _, c := range categories {
		validCats[c.ID] = c.Name
	}

	raw = stripCodeFences(raw)

	classifications, err := responseClassifications(raw)
	if err != nil {
		log.Warn("llm: could not parse response", "raw", raw, "error", err)
		return nil
	}

	var results []LLMResult
	for _, c := range classifications {
		idx := c.TransactionIndex - 1 // prompt uses 1-based index
		if idx < 0 || idx >= len(txns) {
			continue
		}
		if c.CategoryID == 0 {
			continue // sentinel for "unknown"
		}
		catName, ok := validCats[c.CategoryID]
		if !ok {
			log.Debug("llm: invalid category_id", "category_id", c.CategoryID)
			continue
		}

		confidence := cmp.Or(c.Confidence, "medium")
		if confidence == "low" {
			continue
		}

		results = append(results, LLMResult{
			TransactionID: txns[idx].ID,
			CategoryID:    c.CategoryID,
			CategoryName:  catName,
			Confidence:    confidence,
		})
	}

	return results
}

func responseClassifications(raw string) ([]llmClassification, error) {
	var classifications []llmClassification
	if err := json.Unmarshal([]byte(raw), &classifications); err == nil {
		return classifications, nil
	}

	var wrapper struct {
		Results json.RawMessage `json:"results"`
	}
	if err := json.Unmarshal([]byte(raw), &wrapper); err == nil && len(wrapper.Results) > 0 {
		if err := json.Unmarshal(wrapper.Results, &classifications); err == nil {
			return classifications, nil
		}
	}

	var single llmClassification
	if err := json.Unmarshal([]byte(raw), &single); err == nil && single.TransactionIndex > 0 {
		return []llmClassification{single}, nil
	}
	return nil, fmt.Errorf("invalid classification response")
}

// stripCodeFences unwraps a ```json … ``` fenced block — frontier CLIs like to
// wrap JSON output in markdown fences despite instructions not to.
func stripCodeFences(raw string) string {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, "```") {
		return raw
	}
	raw = strings.TrimPrefix(raw, "```")
	if i := strings.IndexByte(raw, '\n'); i >= 0 {
		raw = raw[i+1:] // drop the fence line incl. any language tag
	} else {
		raw = strings.TrimPrefix(raw, "json")
	}
	raw = strings.TrimSpace(raw)
	return strings.TrimSpace(strings.TrimSuffix(raw, "```"))
}
