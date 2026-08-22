package auth

import (
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/nooplog"
	"testing"
)

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
