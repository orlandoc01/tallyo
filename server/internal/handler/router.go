package handler

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/auth"
	"tallyo/internal/graph"
	"tallyo/internal/mcpserver"
	"tallyo/internal/middleware"
	"tallyo/internal/transactions"

	graphqlhandler "github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/extension"
	"github.com/99designs/gqlgen/graphql/handler/lru"
	"github.com/99designs/gqlgen/graphql/handler/transport"
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/go-chi/chi/v5"
	"github.com/vektah/gqlparser/v2/ast"
)

type Config struct {
	Logger           *slog.Logger
	Auth             *auth.Service
	Resolver         *graph.Resolver
	Transactions     transactions.ImportExportStore
	ClientIPResolver middleware.ClientIPResolver
	RuntimeConfig    *runtimeconfig.Manager
}

func New(cfg Config) *chi.Mux {
	router := chi.NewRouter()
	router.Use(middleware.RequestLogger(cfg.Logger))
	csp := "default-src 'self'; script-src 'self' https://cdn.plaid.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.plaid.com https://icons.duckduckgo.com; connect-src 'self' https://*.plaid.com; frame-src https://*.plaid.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
	router.Use(middleware.SecurityHeaders(func() bool { return strings.HasPrefix(cfg.Auth.IssuerURL(), "https://") }, csp))
	router.Use(cfg.Auth.DevCORS)

	router.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	registerAuthRoutes(router, cfg.Auth, cfg.ClientIPResolver)
	registerMCPRoute(router, cfg)
	registerProtectedRoutes(router, cfg)
	router.Handle("/playground", cfg.Auth.Protect(playground.Handler("Tallyo GraphQL", "/query")))
	// SPA catch-all: public, registered last so named API routes above take precedence.
	router.Handle("/*", spaFileServer())
	return router
}

func limitAuthBody(handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		handler(w, r)
	}
}

func registerAuthRoutes(router chi.Router, authSrv *auth.Service, resolver middleware.ClientIPResolver) {
	authSrv.Routes(router)
	router.Group(func(r chi.Router) {
		r.Use(authSrv.RequireOAuth, middleware.RateLimitWithClientIP(5, 15*time.Second, resolver))
		r.Post("/auth/email/send", limitAuthBody(authSrv.EmailSend))
		r.Post("/auth/email/verify", limitAuthBody(authSrv.EmailVerify))
		r.Get("/auth/email/magic", authSrv.EmailMagicLink)
		r.Post("/auth/webauthn/login/begin", limitAuthBody(authSrv.WebAuthnLoginBegin))
		r.Post("/auth/webauthn/login/finish", limitAuthBody(authSrv.WebAuthnLoginFinish))
	})
	router.Group(func(r chi.Router) {
		r.Use(authSrv.RequireOAuth, middleware.RateLimitWithClientIP(10, 10*time.Second, resolver))
		r.Post("/token", limitAuthBody(authSrv.Token))
	})
}

func registerMCPRoute(router chi.Router, cfg Config) {
	mcpHandler := mcpserver.New(mcpserver.Config{Logger: cfg.Logger}, cfg.Resolver)
	handler := clearWriteDeadline(dynamicMCPMiddleware(cfg, mcpHandler))
	router.Handle("/mcp", http.MaxBytesHandler(handler, 1<<20))
}

func clearWriteDeadline(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
		next.ServeHTTP(w, r)
	})
}

func dynamicMCPMiddleware(cfg Config, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !cfg.RuntimeConfig.Sections().MCP.Enabled {
			http.NotFound(w, r)
			return
		}
		if !cfg.Auth.OAuthEnabled() {
			cfg.Auth.Protect(next).ServeHTTP(w, r)
			return
		}
		cfg.Auth.ProtectMCP(next).ServeHTTP(w, r)
	})
}

func registerProtectedRoutes(router chi.Router, cfg Config) {
	router.Group(func(r chi.Router) {
		r.Use(cfg.Auth.Protect)
		r.Post("/auth/webauthn/register/begin", limitAuthBody(cfg.Auth.WebAuthnRegisterBegin))
		r.Post("/auth/webauthn/register/finish", limitAuthBody(cfg.Auth.WebAuthnRegisterFinish))
		r.Get("/auth/webauthn/credentials", cfg.Auth.WebAuthnCredentials)
		r.Patch("/auth/webauthn/credentials/{id}", limitAuthBody(cfg.Auth.WebAuthnCredential))
		r.Delete("/auth/webauthn/credentials/{id}", cfg.Auth.DeleteWebAuthnCredential)
		r.Get("/transactions/export", requireScope(auth.ScopeReadTransactions, exportHandler(cfg.Transactions, cfg.Logger)))
		r.Post("/transactions/import", requireScope(auth.ScopeWriteTransactions, importHandler(cfg.Transactions, cfg.Logger)))
		r.Handle("/query", http.MaxBytesHandler(withRequestTimeout(graphqlServer(cfg.Resolver, cfg.Logger), 55*time.Second), 1<<20))
	})
}

func graphqlServer(resolver *graph.Resolver, logger *slog.Logger) http.Handler {
	srv := graphqlhandler.New(graph.NewExecutableSchema(graph.ConfigWithAuth(resolver)))
	srv.AddTransport(transport.Options{})
	srv.AddTransport(transport.GET{})
	srv.AddTransport(transport.POST{})
	srv.SetParserTokenLimit(15000)
	srv.SetQueryCache(lru.New[*ast.QueryDocument](1000))
	srv.SetErrorPresenter(graph.SafeErrorPresenter(logger))
	srv.SetRecoverFunc(graph.SafeRecoverFunc(logger))
	srv.Use(extension.AutomaticPersistedQuery{Cache: lru.New[string](100)})
	srv.Use(extension.FixedComplexityLimit(500))
	// Introspection intentionally omitted because it exposes the full schema to authenticated users.
	srv.AroundOperations(graph.LoaderInjector(resolver))
	srv.AroundOperations(graph.OperationLogger(logger))
	return srv
}

func withRequestTimeout(next http.Handler, timeout time.Duration) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
