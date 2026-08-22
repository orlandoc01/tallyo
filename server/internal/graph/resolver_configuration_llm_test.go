package graph

import (
	"testing"

	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/graph/model"
)

func TestLlmCategorizationConfigAllowedProviders(t *testing.T) {
	config := (&Resolver{}).llmCategorizationConfig(runtimeconfig.Section[runtimeconfig.LLMConfig]{})
	want := []model.LlmProvider{model.LlmProviderOllama}
	if len(config.AllowedProviders) != 1 || config.AllowedProviders[0] != want[0] {
		t.Fatalf("AllowedProviders = %v, want %v", config.AllowedProviders, want)
	}
}
