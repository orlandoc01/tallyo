package runtimeconfig

import (
	"testing"
	"time"

	"github.com/samber/lo"
)

func TestResolveRuntimeConfigAppliesEnvOverrides(t *testing.T) {
	store := &fakeStore{sections: Sections{
		SetupComplete: storedSection(true, SetupCompleteConfig{}),
		Auth: storedSection(true, AuthConfig{
			MasterPassword:          new("db-password"),
			OAuthIssuerURL:          "https://spend.example",
			FrontendRedirectURIs:    []string{"https://spend.example/callback"},
			AccessTokenLifetimeRaw:  "20m",
			RefreshTokenLifetimeRaw: "168h",
			DevCORSAllowedOrigins:   []string{"http://localhost:5173"},
		}),
		Email: storedSection(true, EmailConfig{
			Host:     new("smtp.example"),
			Port:     "587",
			From:     new("noreply@example.com"),
			Username: stringPtr("mailer"),
			Password: stringPtr("secret"),
		}),
		Google:   storedSection(true, GoogleConfig{ClientID: stringPtr("client-id"), ClientSecret: stringPtr("client-secret")}),
		WebAuthn: storedSection(true, WebAuthnConfig{RPID: stringPtr("spend.example"), RPName: "Tallyo", RPOrigins: []string{"https://spend.example"}}),
	}}
	manager := loadedManager(t, store, true, false)

	config, err := manager.ResolveRuntimeConfig("env-password", false)
	if err != nil {
		t.Fatalf("ResolveRuntimeConfig() error = %v", err)
	}
	if !config.OAuthEnabled() || lo.FromPtr(config.Auth.Fields.MasterPassword) != "env-password" {
		t.Fatalf("config = %+v", config)
	}
	accessTokenLifetime := config.Auth.Fields.AccessTokenLifetime()
	refreshTokenLifetime := config.Auth.Fields.RefreshTokenLifetime()
	if accessTokenLifetime != 20*time.Minute || refreshTokenLifetime != 168*time.Hour {
		t.Fatalf("lifetimes = %s/%s", config.Auth.Fields.AccessTokenLifetime(), config.Auth.Fields.RefreshTokenLifetime())
	}
	if config.Email.Fields.Port != "587" || lo.FromPtr(config.Google.Fields.ClientSecret) != "client-secret" {
		t.Fatalf("config = %+v", config)
	}
	if lo.FromPtr(config.WebAuthn.Fields.RPID) != "spend.example" {
		t.Fatalf("config = %+v", config)
	}
}

func TestResolveRuntimeConfigValidation(t *testing.T) {
	tests := map[string]struct {
		sections Sections
		wantErr  string
	}{
		"setup incomplete skips validation": {
			sections: Sections{Auth: storedSection(true, AuthConfig{})},
		},
		"setup complete requires auth method": {
			sections: Sections{
				SetupComplete: storedSection(true, SetupCompleteConfig{}),
				Auth:          storedSection(true, AuthConfig{}),
			},
			wantErr: "at least one auth method required: configure MASTER_PASSWORD or enable google, email, or passkey",
		},
		"oauth requires issuer": {
			sections: Sections{
				SetupComplete: storedSection(true, SetupCompleteConfig{}),
				Auth: storedSection(true, AuthConfig{
					FrontendRedirectURIs:    []string{"https://spend.example/callback"},
					AccessTokenLifetimeRaw:  "15m",
					RefreshTokenLifetimeRaw: "168h",
				}),
				Google: storedSection(true, GoogleConfig{}),
			},
			wantErr: "oauth auth methods require oauth_issuer_url to be configured",
		},
		"oauth requires redirect uri": {
			sections: Sections{
				SetupComplete: storedSection(true, SetupCompleteConfig{}),
				Auth: storedSection(true, AuthConfig{
					OAuthIssuerURL:          "https://spend.example",
					AccessTokenLifetimeRaw:  "15m",
					RefreshTokenLifetimeRaw: "168h",
				}),
				Email: storedSection(true, EmailConfig{}),
			},
			wantErr: "oauth auth methods require at least one frontend_redirect_uris value",
		},
		"oauth requires positive lifetimes": {
			sections: Sections{
				SetupComplete: storedSection(true, SetupCompleteConfig{}),
				Auth: storedSection(true, AuthConfig{
					OAuthIssuerURL:       "https://spend.example",
					FrontendRedirectURIs: []string{"https://spend.example/callback"},
				}),
				Email: storedSection(true, EmailConfig{}),
			},
			wantErr: "access_token_lifetime and refresh_token_lifetime must be greater than zero",
		},
		"disabled auth rejects public issuer": {
			sections: Sections{Auth: storedSection(false, AuthConfig{OAuthIssuerURL: "https://spend.example"})},
			wantErr:  "DISABLE_ALL_AUTH is only allowed with a localhost http oauth_issuer_url",
		},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			manager := loadedManager(t, &fakeStore{sections: tc.sections}, false, false)
			_, err := manager.ResolveRuntimeConfig("", false)
			assertValidationError(t, tc.wantErr, err)
		})
	}
}

func TestSectionsDisableAllAuth(t *testing.T) {
	secret := "secret"
	tests := map[string]struct {
		config Sections
		want   bool
	}{
		"explicit disable": {
			config: Sections{
				Auth:          storedSection(false, AuthConfig{}),
				SetupComplete: storedSection(true, SetupCompleteConfig{}),
			},
			want: true,
		},
		"first run without master password":     {config: Sections{}, want: true},
		"first run with master password":        {config: Sections{Auth: Section[AuthConfig]{Fields: AuthConfig{MasterPassword: &secret}}}},
		"setup complete without authentication": {config: Sections{SetupComplete: storedSection(true, SetupCompleteConfig{})}},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			if got := tc.config.DisableAllAuth(); got != tc.want {
				t.Fatalf("DisableAllAuth() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestResolveRuntimeConfigDisableAllAuthEnvOverride(t *testing.T) {
	manager := loadedManager(t, &fakeStore{sections: Sections{Auth: storedSection(true, AuthConfig{})}}, true, false)
	config, err := manager.ResolveRuntimeConfig("", true)
	if err != nil {
		t.Fatalf("ResolveRuntimeConfig() error = %v", err)
	}
	if config.Auth.Enabled {
		t.Fatal("Auth.Enabled = true")
	}
}
