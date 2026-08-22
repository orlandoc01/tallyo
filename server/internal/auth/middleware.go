package auth

import (
	"context"
	"crypto/subtle"
	"fmt"
	"net/http"
	"slices"
	"strings"

	u "tallyo/internal/utils"
)

type contextKey string

const (
	subjectKey contextKey = "auth_subject"
	scopesKey  contextKey = "auth_scopes"
)

func Subject(ctx context.Context) (string, bool) {
	subject, ok := ctx.Value(subjectKey).(string)
	return subject, ok
}

func ContextWithSubject(ctx context.Context, subject string) context.Context {
	return context.WithValue(ctx, subjectKey, subject)
}

// Scopes returns the permission scopes from the request context.
func Scopes(ctx context.Context) []string {
	scopes, _ := ctx.Value(scopesKey).([]string)
	return scopes
}

// HasScope reports whether the request context contains the given scope.
func HasScope(ctx context.Context, scope string) bool {
	return slices.Contains(Scopes(ctx), scope)
}

// ContextWithScopes injects scopes into a context (used in tests).
func ContextWithScopes(ctx context.Context, scopes []string) context.Context {
	return context.WithValue(ctx, scopesKey, scopes)
}

func (s *Service) Protect(next http.Handler) http.Handler {
	return s.protect(next, s.cfg.IssuerURL+"/.well-known/oauth-protected-resource")
}

func (s *Service) ProtectMCP(next http.Handler) http.Handler {
	return s.protect(next, s.cfg.IssuerURL+"/.well-known/oauth-protected-resource/mcp")
}

func (s *Service) protect(next http.Handler, resourceMetadataURL string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.DisableAllAuth {
			ctx := ContextWithScopes(r.Context(), AllScopes)
			ctx = u.ContextWithTimezone(ctx, s.Timezone())
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		if subject, scopes, timezone, ok := s.bearerAuth(r); ok {
			ctx := ContextWithSubject(r.Context(), subject)
			ctx = ContextWithScopes(ctx, scopes)
			ctx = u.ContextWithTimezone(ctx, timezone)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		if s.cfg.MasterPassword != "" && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-API-Key")), []byte(s.cfg.MasterPassword)) == 1 {
			ctx := ContextWithScopes(r.Context(), AllScopes)
			ctx = u.ContextWithTimezone(ctx, s.Timezone())
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		w.Header().Set("WWW-Authenticate", fmt.Sprintf(`Bearer resource_metadata="%s"`, resourceMetadataURL))
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	})
}

func (s *Service) bearerAuth(r *http.Request) (subject string, scopes []string, timezone string, ok bool) {
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return "", nil, "", false
	}
	claims, err := s.verifyAccessToken(parts[1])
	if err != nil {
		return "", nil, "", false
	}
	parsedScopes := strings.Fields(claims.Scope)
	timezone = claims.Locale.Timezone
	if timezone == "" {
		timezone = s.Timezone()
	}
	return claims.Subject, parsedScopes, timezone, true
}

func (s *Service) DevCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimRight(r.Header.Get("Origin"), "/")
		if _, ok := s.devOrigins[origin]; ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-API-Key")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
