package runtimeconfig

type LLMProvider string

const LLMProviderOllama LLMProvider = "ollama"

type OllamaConfig struct {
	URL   *string `json:"url"`
	Model string  `json:"model"`
}

type LLMConfig struct {
	Provider LLMProvider  `json:"provider,omitempty"`
	Ollama   OllamaConfig `json:"ollama"`
}
