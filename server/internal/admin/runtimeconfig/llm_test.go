package runtimeconfig

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestLLMConfigUnmarshal(t *testing.T) {
	var config LLMConfig
	if err := json.Unmarshal(
		[]byte(`{"provider":"ollama","ollama":{"url":"http://ollama:11434","model":"llama3"}}`),
		&config,
	); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	url := "http://ollama:11434"
	want := LLMConfig{Provider: LLMProviderOllama, Ollama: OllamaConfig{URL: &url, Model: "llama3"}}
	if !reflect.DeepEqual(config, want) {
		t.Fatalf("Unmarshal() = %#v, want %#v", config, want)
	}
}
