package runtimeconfig

import (
	"context"
	"errors"
	"testing"
)

func TestManagerAuthProspectiveValidation(t *testing.T) {
	tests := map[string]struct {
		sections      Sections
		patch         Patch
		passkeyExists bool
		passkeyErr    error
		wantErr       string
		wantSaveCalls int
	}{
		"setup completion requires authentication": {
			patch:         Patch{SetupComplete: &SectionPatch[SetupCompleteConfig]{Enabled: true}},
			wantErr:       "setup completion requires at least one auth method: configure MASTER_PASSWORD or enable google_authn, email_code_authn, or passkey_authn",
			wantSaveCalls: 0,
		},
		"auth lockout is rejected": {
			sections:      Sections{Google: storedSection(true, GoogleConfig{})},
			patch:         Patch{Google: &SectionPatch[GoogleConfig]{}},
			wantErr:       "at least one auth method required: enable google_authn, email_code_authn, passkey_authn, or configure MASTER_PASSWORD",
			wantSaveCalls: 0,
		},
		"public issuer cannot disable all auth": {
			sections: Sections{
				Auth:   storedSection(true, AuthConfig{OAuthIssuerURL: "https://spend.example"}),
				Google: storedSection(true, GoogleConfig{}),
			},
			patch:         Patch{Auth: &SectionPatch[AuthConfig]{Fields: AuthConfig{OAuthIssuerURL: "https://spend.example"}}},
			wantErr:       "DISABLE_ALL_AUTH is only allowed with a localhost http oauth_issuer_url",
			wantSaveCalls: 0,
		},
		"passkey only requires admin passkey": {
			sections: Sections{
				Auth:          configuredOAuthSection(),
				Email:         storedSection(true, EmailConfig{}),
				SetupComplete: storedSection(true, SetupCompleteConfig{}),
			},
			patch: Patch{
				Email:    &SectionPatch[EmailConfig]{},
				WebAuthn: &SectionPatch[WebAuthnConfig]{Enabled: true},
			},
			wantErr:       "passkey-only sign-in requires at least one admin passkey before disabling other sign-in methods",
			wantSaveCalls: 0,
		},
		"passkey lookup error is wrapped": {
			sections: Sections{
				Auth:          configuredOAuthSection(),
				Email:         storedSection(true, EmailConfig{}),
				SetupComplete: storedSection(true, SetupCompleteConfig{}),
			},
			patch: Patch{
				Email:    &SectionPatch[EmailConfig]{},
				WebAuthn: &SectionPatch[WebAuthnConfig]{Enabled: true},
			},
			passkeyErr:    errors.New("database unavailable"),
			wantErr:       "check admin passkey: database unavailable",
			wantSaveCalls: 0,
		},
		"passkey only with an admin passkey": {
			sections: Sections{
				Auth:          configuredOAuthSection(),
				Email:         storedSection(true, EmailConfig{}),
				SetupComplete: storedSection(true, SetupCompleteConfig{}),
			},
			patch: Patch{
				Email:    &SectionPatch[EmailConfig]{},
				WebAuthn: &SectionPatch[WebAuthnConfig]{Enabled: true},
			},
			passkeyExists: true,
			wantSaveCalls: 1,
		},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			store := &fakeStore{
				sections:           tc.sections,
				adminPasskeyExists: tc.passkeyExists,
				adminPasskeyErr:    tc.passkeyErr,
			}
			manager := loadedManager(t, store, false, false)
			assertValidationError(t, tc.wantErr, manager.UpdateSections(context.Background(), tc.patch))
			if store.saveCalls != tc.wantSaveCalls {
				t.Fatalf("SaveSections() calls = %d, want %d", store.saveCalls, tc.wantSaveCalls)
			}
		})
	}
}

func TestManagerAllowsPasskeyOnlyBeforeSetupComplete(t *testing.T) {
	manager := loadedManager(t, &fakeStore{}, false, false)
	if err := manager.UpdateSections(context.Background(), Patch{WebAuthn: &SectionPatch[WebAuthnConfig]{Enabled: true}}); err != nil {
		t.Fatalf("UpdateSections() error = %v", err)
	}
}

func configuredOAuthSection() Section[AuthConfig] {
	return storedSection(true, AuthConfig{
		OAuthIssuerURL:          "https://spend.example",
		FrontendRedirectURIs:    []string{"https://spend.example/callback"},
		AccessTokenLifetimeRaw:  "15m",
		RefreshTokenLifetimeRaw: "168h",
	})
}
