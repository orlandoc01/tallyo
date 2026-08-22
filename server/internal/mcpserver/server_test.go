package mcpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"tallyo/internal/graph"
	"tallyo/internal/utils/test"
)

func TestNewWithCustomOrigins(t *testing.T) {
	resolver := &graph.Resolver{}
	cfg := Config{AllowedOrigins: []string{"http://example.com"}, Logger: test.Logger}
	srv := New(cfg, resolver)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/mcp", nil))
	if rec.Code == 0 {
		t.Fatalf("MCP handler was not served")
	}
}
