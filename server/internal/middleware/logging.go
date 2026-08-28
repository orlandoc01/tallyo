package middleware

import (
	"log/slog"
	"net/http"

	"github.com/felixge/httpsnoop"
)

// SecurityHeaders adds defensive HTTP headers to every response.
// Set enableHSTS when the server is served over HTTPS to enforce
// Strict-Transport-Security with a two-year max-age.
// If csp is non-empty, Content-Security-Policy is set directly.
func SecurityHeaders(enableHSTS func() bool, csp string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Frame-Options", "DENY")
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
			h.Set("X-XSS-Protection", "0")
			if enableHSTS() {
				h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
			}
			if csp != "" {
				h.Set("Content-Security-Policy", csp)
			}
			next.ServeHTTP(w, r)
		})
	}
}

func RequestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			metrics := httpsnoop.CaptureMetrics(next, w, r)
			logger.Info("http request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", metrics.Code,
				"duration", metrics.Duration,
			)
		})
	}
}
