package auth

import (
	"context"
	"net/http"
	"testing"
	"time"

	jwt "github.com/golang-jwt/jwt/v5"

	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/auth/authdb"
	"tallyo/internal/database/dbtest"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/nooplog"
)

func issueTestAccessToken(t *testing.T, svc *Service) string {
	t.Helper()
	issuer := svc.IssuerURL()
	token := jwt.NewWithClaims(jwt.SigningMethodES256, claims{
		Issuer:    issuer,
		Audience:  jwt.ClaimStrings{issuer},
		Subject:   "alex@example.com",
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute))})
	signed, err := token.SignedString(svc.signingKey.Private)
	must.NoErr(t, err)
	return signed
}

func TestDynamicAuthAccessorsAndUpdates(t *testing.T) {
	svc := &Service{cfg: Config{IssuerURL: "https://spend.example", Log: nooplog.Logger, SMTPPort: "587"}}

	svc.UpdateEmailConfig(true, "smtp.example.com", "2525", "noreply@example.com", "user", "secret")
	if !svc.EmailEnabled() || svc.GetEmailSender() == nil || svc.cfg.SMTPHost != "smtp.example.com" || svc.cfg.SMTPPort != "2525" {
		t.Fatalf("email dynamic config not updated: %#v", svc.cfg)
	}

	svc.UpdateGoogleConfig(true, "client", "secret")
	if !svc.GoogleEnabled() || svc.GetGoogleConfig() == nil || svc.cfg.GoogleClientID != "client" {
		t.Fatalf("google dynamic config not enabled: %#v", svc.cfg)
	}
	svc.UpdateGoogleConfig(false, "", "")
	if svc.GoogleEnabled() || svc.GetGoogleConfig() != nil {
		t.Fatalf("google dynamic config not disabled")
	}

	commit, err := svc.PrepareWebAuthnConfig(true, svc.cfg.IssuerURL, "", "", nil)
	must.NoErr(t, err)
	if svc.PassKeyEnabled() {
		t.Fatal("WebAuthn changed before commit")
	}
	commit()
	if !svc.PassKeyEnabled() || svc.GetWebAuthn() == nil || svc.cfg.WebAuthnRPID != "spend.example" || len(svc.cfg.WebAuthnRPOrigins) != 1 {
		t.Fatalf("webauthn dynamic config not defaulted: %#v", svc.cfg)
	}
	if _, err := svc.PrepareWebAuthnConfig(true, svc.cfg.IssuerURL, "other.example", "", nil); err == nil {
		t.Fatal("expected origin outside RP ID to fail")
	}
	for _, origin := range []string{
		"https://user:pass@spend.example",
		"https://spend.example/path",
		"https://spend.example?query=value",
		"https://spend.example#fragment",
	} {
		if _, err := svc.PrepareWebAuthnConfig(true, svc.cfg.IssuerURL, "spend.example", "", []string{origin}); err == nil {
			t.Fatalf("expected invalid origin %q", origin)
		}
	}
	commit, err = svc.PrepareWebAuthnConfig(true, svc.cfg.IssuerURL, "spend.example", "", []string{"https://spend.example/"})
	must.NoErr(t, err)
	commit()
	if len(svc.cfg.WebAuthnRPOrigins) != 1 || svc.cfg.WebAuthnRPOrigins[0] != "https://spend.example" {
		t.Fatalf("trailing-slash origin not normalized: %#v", svc.cfg.WebAuthnRPOrigins)
	}
	commit, _ = svc.PrepareWebAuthnConfig(false, svc.cfg.IssuerURL, "", "", nil)
	commit()
	if svc.PassKeyEnabled() || svc.GetWebAuthn() != nil {
		t.Fatalf("webauthn dynamic config not disabled")
	}
}

func TestPrepareAuthConfigSwapsIssuerAndProvider(t *testing.T) {
	svc := newTestAuthService(t, authdb.New(dbtest.Open(t)))
	token := issueTestAccessToken(t, svc)
	if _, err := svc.verifyAccessToken(token); err != nil {
		t.Fatalf("token minted under the boot issuer should verify: %v", err)
	}

	next := runtimeconfig.Sections{
		Auth: runtimeconfig.Section[runtimeconfig.AuthConfig]{Stored: true, Enabled: true, Fields: runtimeconfig.AuthConfig{
			OAuthIssuerURL:        "https://new.example/",
			MasterPassword:        new("rotated"),
			FrontendRedirectURIs:  []string{"https://new.example/auth/callback"},
			DevCORSAllowedOrigins: []string{"http://localhost:4000/"},
		}},
		Google:        runtimeconfig.Section[runtimeconfig.GoogleConfig]{Enabled: true},
		SetupComplete: runtimeconfig.Section[runtimeconfig.SetupCompleteConfig]{Enabled: true},
	}
	commit, err := svc.PrepareAuthConfig(context.Background(), next)
	must.NoErr(t, err)
	if svc.IssuerURL() != "http://localhost:3000" {
		t.Fatal("issuer changed before commit")
	}
	commit()

	cfg := svc.config()
	if cfg.IssuerURL != "https://new.example" || cfg.MasterPassword != "rotated" || cfg.AccessTokenLifetime != 15*time.Minute {
		t.Fatalf("auth config not applied: %#v", cfg)
	}
	if !svc.devOriginAllowed("http://localhost:4000") || svc.devOriginAllowed("http://localhost:5173") {
		t.Fatal("dev CORS origins not swapped")
	}
	if _, err := svc.verifyAccessToken(token); err == nil {
		t.Fatal("token for the old issuer should no longer verify")
	}
	client, err := svc.store.Client(context.Background(), FrontendClientID)
	must.NoErr(t, err)
	if len(client.RedirectURIs) != 1 || client.RedirectURIs[0] != "https://new.example/auth/callback" {
		t.Fatalf("frontend client redirect URIs = %#v", client.RedirectURIs)
	}

	next.Auth.Fields.OAuthIssuerURL = ""
	if _, err := svc.PrepareAuthConfig(context.Background(), next); err == nil {
		t.Fatal("expected missing issuer error")
	}
	next.Google.Enabled = false
	commit, err = svc.PrepareAuthConfig(context.Background(), next)
	must.NoErr(t, err)
	commit()
	rec := callHandler(svc.RequireOAuth(http.HandlerFunc(svc.AuthorizationMetadata)).ServeHTTP, http.MethodGet, "/.well-known/oauth-authorization-server", nil)
	assertStatus(t, rec, http.StatusNotFound, "oauth routes while disabled")
}
