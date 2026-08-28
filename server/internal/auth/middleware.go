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

type bearerIdentity struct {
	Subject  string
	Scopes   []string
	Timezone string
}

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

func Scopes(ctx context.Context) []string {
	scopes, _ := ctx.Value(scopesKey).([]string)
	return scopes
}

func HasScope(ctx context.Context, scope string) bool {
	return slices.Contains(Scopes(ctx), scope)
}

func ContextWithScopes(ctx context.Context, scopes []string) context.Context {
	return context.WithValue(ctx, scopesKey, scopes)
}

func (s *Service) Protect(next http.Handler) http.Handler {
	return s.protect(next, "/.well-known/oauth-protected-resource")
}

func (s *Service) ProtectMCP(next http.Handler) http.Handler {
	return s.protect(next, "/.well-known/oauth-protected-resource/mcp")
}

func (s *Service) RequireOAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.OAuthEnabled() {
			http.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Service) protect(next http.Handler, resourceMetadataPath string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cfg := s.config()
		if cfg.DisableAllAuth {
			ctx := ContextWithScopes(r.Context(), AllScopes)
			ctx = u.ContextWithTimezone(ctx, s.Timezone())
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		if identity, ok := s.bearerAuth(r); ok {
			ctx := ContextWithSubject(r.Context(), identity.Subject)
			ctx = ContextWithScopes(ctx, identity.Scopes)
			ctx = u.ContextWithTimezone(ctx, identity.Timezone)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		if cfg.MasterPassword != "" && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-API-Key")), []byte(cfg.MasterPassword)) == 1 {
			ctx := ContextWithScopes(r.Context(), AllScopes)
			ctx = u.ContextWithTimezone(ctx, s.Timezone())
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		w.Header().Set("WWW-Authenticate", fmt.Sprintf(`Bearer resource_metadata="%s"`, cfg.IssuerURL+resourceMetadataPath))
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	})
}

func (s *Service) bearerAuth(r *http.Request) (bearerIdentity, bool) {
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return bearerIdentity{}, false
	}
	claims, err := s.verifyAccessToken(parts[1])
	if err != nil {
		return bearerIdentity{}, false
	}
	timezone := claims.Locale.Timezone
	if timezone == "" {
		timezone = s.Timezone()
	}
	return bearerIdentity{Subject: claims.Subject, Scopes: strings.Fields(claims.Scope), Timezone: timezone}, true
}

func (s *Service) DevCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimRight(r.Header.Get("Origin"), "/")
		if s.devOriginAllowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Expose-Headers", "Mcp-Session-Id")
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
