package graph

import (
	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/graph/model"

	"github.com/samber/lo"
)

func (*Resolver) llmCategorizationConfig(cfg runtimeconfig.Section[runtimeconfig.LLMConfig]) *model.LlmCategorizationConfiguration {
	fields := cfg.Fields
	return &model.LlmCategorizationConfiguration{
		Enabled:          cfg.Enabled,
		Provider:         model.LlmProviderOllama,
		AllowedProviders: []model.LlmProvider{model.LlmProviderOllama},
		Ollama: &model.OllamaProviderConfiguration{
			URL:   lo.EmptyableToPtr(lo.FromPtr(fields.Ollama.URL)),
			Model: fields.Ollama.Model,
		},
	}
}

func llmRuntimeConfigFromInput(input *model.LlmCategorizationConfigurationInput) runtimeconfig.LLMConfig {
	return runtimeconfig.LLMConfig{
		Provider: runtimeconfig.LLMProviderOllama,
		Ollama:   runtimeconfig.OllamaConfig{URL: input.Ollama.URL, Model: input.Ollama.Model},
	}
}
