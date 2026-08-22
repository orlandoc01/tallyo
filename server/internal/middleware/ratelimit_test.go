package middleware

import (
	"net/http"
	"net/http/httptest"
	"tallyo/internal/utils/must"
	"testing"
	"time"
)

func TestRateLimitMiddlewareHandlesForwardedFor(t *testing.T) {
	tests := map[string]struct {
		trustedProxyCIDRs []string
		remoteAddrs       [2]string
		forwardedFor      [2]string
		wantStatuses      [2]int
		wantCalls         [2]int
	}{
		"ignores by default": {
			remoteAddrs:  [2]string{"10.0.0.1", "10.0.0.2"},
			forwardedFor: [2]string{"203.0.113.1, 10.0.0.1", "203.0.113.1"},
			wantStatuses: [2]int{http.StatusNoContent, http.StatusNoContent}, wantCalls: [2]int{1, 2},
		},
		"uses from trusted proxy": {
			trustedProxyCIDRs: []string{"10.0.0.0/24"}, remoteAddrs: [2]string{"10.0.0.1:12345", "10.0.0.2:12345"},
			forwardedFor: [2]string{"198.51.100.25, 10.0.0.1", "198.51.100.25, 10.0.0.2"},
			wantStatuses: [2]int{http.StatusNoContent, http.StatusTooManyRequests}, wantCalls: [2]int{1, 1},
		},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			resolver, err := NewClientIPResolver(tc.trustedProxyCIDRs)
			must.NoErr(t, err)
			called := 0
			handler := RateLimitWithClientIP(1, time.Hour, resolver)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				called++
				w.WriteHeader(http.StatusNoContent)
			}))
			for i := range 2 {
				request := httptest.NewRequest(http.MethodGet, "/", nil)
				request.RemoteAddr = tc.remoteAddrs[i]
				request.Header.Set("X-Forwarded-For", tc.forwardedFor[i])
				recorder := httptest.NewRecorder()
				handler.ServeHTTP(recorder, request)
				if recorder.Code != tc.wantStatuses[i] || called != tc.wantCalls[i] {
					t.Fatalf("response %d = %d, called = %d", i+1, recorder.Code, called)
				}
			}
		})
	}
}

func TestRateLimitMiddlewareUsesRuntimeUpdatedTrustedProxies(t *testing.T) {
	resolver, err := NewClientIPResolver(nil)
	must.NoErr(t, err)
	called := 0
	handler := RateLimitWithClientIP(1, time.Hour, resolver)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called++
		w.WriteHeader(http.StatusNoContent)
	}))
	must.NoErr(t, resolver.SetTrustedProxyCIDRs([]string{"10.0.0.0/24"}))

	first := httptest.NewRequest(http.MethodGet, "/", nil)
	first.RemoteAddr = "10.0.0.1:12345"
	first.Header.Set("X-Forwarded-For", "198.51.100.25")
	firstRecorder := httptest.NewRecorder()
	handler.ServeHTTP(firstRecorder, first)
	if firstRecorder.Code != http.StatusNoContent || called != 1 {
		t.Fatalf("first response = %d, called = %d", firstRecorder.Code, called)
	}

	second := httptest.NewRequest(http.MethodGet, "/", nil)
	second.RemoteAddr = "10.0.0.2:12345"
	second.Header.Set("X-Forwarded-For", "198.51.100.25")
	secondRecorder := httptest.NewRecorder()
	handler.ServeHTTP(secondRecorder, second)
	if secondRecorder.Code != http.StatusTooManyRequests || called != 1 {
		t.Fatalf("second response = %d, called = %d", secondRecorder.Code, called)
	}
}

func TestNewClientIPResolverRejectsInvalidCIDR(t *testing.T) {
	if _, err := NewClientIPResolver([]string{"not-a-cidr"}); err == nil {
		t.Fatal("expected invalid CIDR error")
	}
}

func TestRateLimitMiddlewareNormalizesRemoteAddrPort(t *testing.T) {
	resolver, err := NewClientIPResolver(nil)
	must.NoErr(t, err)
	handler := RateLimitWithClientIP(1, time.Hour, resolver)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	first := httptest.NewRequest(http.MethodGet, "/", nil)
	first.RemoteAddr = "198.51.100.5:12345"
	firstRecorder := httptest.NewRecorder()
	handler.ServeHTTP(firstRecorder, first)
	if firstRecorder.Code != http.StatusNoContent {
		t.Fatalf("first response = %d", firstRecorder.Code)
	}

	second := httptest.NewRequest(http.MethodGet, "/", nil)
	second.RemoteAddr = "198.51.100.5:54321"
	secondRecorder := httptest.NewRecorder()
	handler.ServeHTTP(secondRecorder, second)
	if secondRecorder.Code != http.StatusTooManyRequests {
		t.Fatalf("second response = %d, want %d", secondRecorder.Code, http.StatusTooManyRequests)
	}
}
