package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	testutil "tallyo/internal/utils/test"
)

func TestRequestLoggerRecordsStatus(t *testing.T) {
	handler := RequestLogger(testutil.Logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	}))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/query", nil))
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("status = %d", recorder.Code)
	}
}

func TestSecurityHeadersSet(t *testing.T) {
	handler := SecurityHeaders(func() bool { return false }, "")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))
	for _, header := range []string{"X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "X-XSS-Protection"} {
		if recorder.Header().Get(header) == "" {
			t.Fatalf("missing security header: %s", header)
		}
	}
	if recorder.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatalf("X-Frame-Options = %q", recorder.Header().Get("X-Frame-Options"))
	}
}
