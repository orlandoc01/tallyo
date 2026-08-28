package graph

import (
	"context"
	"reflect"
	"testing"

	"tallyo/internal/admin"
	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
)

type updateConfigurationAdminStub struct {
	AdminService
	sections runtimeconfig.Sections
	err      error
}

func (s *updateConfigurationAdminStub) Sections() runtimeconfig.Sections {
	return s.sections
}

func (s *updateConfigurationAdminStub) UpdateSections(_ context.Context, patch runtimeconfig.Patch) error {
	if s.err != nil && patch.Google != nil {
		return s.err
	}
	s.sections = applyGraphPatch(s.sections, patch)
	return nil
}

type graphConfigStore struct {
	sections runtimeconfig.Sections
}

func (s *graphConfigStore) LoadSections(context.Context) (runtimeconfig.Sections, error) {
	return s.sections, nil
}

func (s *graphConfigStore) SaveSections(_ context.Context, patch runtimeconfig.Patch) (runtimeconfig.Sections, error) {
	s.sections = applyGraphPatch(s.sections, patch)
	return s.sections, nil
}

func (s *graphConfigStore) AdminPasskeyExists(context.Context) (bool, error) { return false, nil }

func applyGraphPatch(sections runtimeconfig.Sections, patch runtimeconfig.Patch) runtimeconfig.Sections {
	if patch.Auth != nil {
		sections.Auth = graphSectionFromPatch(*patch.Auth)
	}
	if patch.Email != nil {
		sections.Email = graphSectionFromPatch(*patch.Email)
	}
	if patch.General != nil {
		sections.General = graphSectionFromPatch(*patch.General)
	}
	if patch.Google != nil {
		sections.Google = graphSectionFromPatch(*patch.Google)
	}
	if patch.LLM != nil {
		sections.LLM = graphSectionFromPatch(*patch.LLM)
	}
	if patch.MCP != nil {
		sections.MCP = graphSectionFromPatch(*patch.MCP)
	}
	if patch.Security != nil {
		sections.Security = graphSectionFromPatch(*patch.Security)
	}
	if patch.SetupComplete != nil {
		sections.SetupComplete = graphSectionFromPatch(*patch.SetupComplete)
	}
	return sections
}

func graphSectionFromPatch[T any](patch runtimeconfig.SectionPatch[T]) runtimeconfig.Section[T] {
	return runtimeconfig.Section[T]{Stored: true, Enabled: patch.Enabled, Fields: patch.Fields}
}

func (s *graphConfigStore) Users(context.Context) ([]*model.User, error)         { return nil, nil }
func (s *graphConfigStore) UserByID(context.Context, int64) (*model.User, error) { return nil, nil }
func (s *graphConfigStore) UpdateUserRole(context.Context, int64, string) (*model.User, error) {
	return nil, nil
}
func (s *graphConfigStore) InsertUser(context.Context, admin.InsertUserInput) (*model.User, error) {
	return nil, nil
}
func (s *graphConfigStore) UserIDByEmail(context.Context, string) (int64, error) { return 0, nil }
func (s *graphConfigStore) UserExists(context.Context, string) (bool, error)     { return false, nil }
func (s *graphConfigStore) RemoveUser(context.Context, int64) error              { return nil }
func (s *graphConfigStore) CreatePlaidCredential(context.Context, model.CreatePlaidCredentialInput) (*model.PlaidCredential, error) {
	return nil, nil
}
func (s *graphConfigStore) UpdatePlaidCredential(context.Context, model.UpdatePlaidCredentialInput) (*model.PlaidCredential, error) {
	return nil, nil
}
func (s *graphConfigStore) DeletePlaidCredential(context.Context, int32) (bool, error) {
	return false, nil
}
func (s *graphConfigStore) PlaidCredentials(context.Context) ([]*model.PlaidCredential, error) {
	return nil, nil
}
func (s *graphConfigStore) PlaidCredentialsByIDs(context.Context, []int32) (map[int32]*model.PlaidCredential, error) {
	return nil, nil
}

func TestUpdateConfigurationUpdatesDynamicSections(t *testing.T) {
	ctx := context.Background()
	store := &graphConfigStore{sections: runtimeconfig.Sections{
		Google: storedSection(true, runtimeconfig.GoogleConfig{
			ClientID:     stringPtr("old"),
			ClientSecret: stringPtr("secret"),
		}),
		Email: storedSection(true, runtimeconfig.EmailConfig{}),
	}}
	svc := admin.NewService(store, runtimeconfig.New(store))
	must.NoErr(t, svc.LoadConfiguration(ctx, true, false))
	resolver := &Resolver{Admin: svc}
	clientID := "new-client"
	secret := "new-secret"
	modelName := "llama3"
	url := "http://ollama:11434"

	payload, err := resolver.UpdateConfiguration(ctx, model.UpdateConfigurationInput{
		General:     &model.GeneralConfigurationInput{DisableTransactionTracking: true, DisableWealthTracking: true, HideOwners: true},
		GoogleAuthn: &model.GoogleAuthnConfigurationInput{Enabled: true, GoogleClientID: &clientID, GoogleClientSecret: &secret},
		LlmCategorization: &model.LlmCategorizationConfigurationInput{
			Enabled:  true,
			Provider: model.LlmProviderOllama,
			Ollama:   &model.OllamaProviderConfigurationInput{URL: &url, Model: modelName},
		},
		Mcp:      &model.McpConfigurationInput{Enabled: true, DynamicRedirectHosts: []string{"claude.ai"}},
		Security: &model.SecurityConfigurationInput{TrustedProxyCidrs: []string{" 10.0.0.0/24 ", "127.0.0.1"}},
	})
	must.NoErr(t, err)
	if payload.Configuration.GoogleAuthn.GoogleClientID == nil || *payload.Configuration.GoogleAuthn.GoogleClientID != clientID {
		t.Fatalf("GoogleAuthn = %#v", payload.Configuration.GoogleAuthn)
	}
	if !payload.Configuration.General.DisableTransactionTracking || !payload.Configuration.General.DisableWealthTracking || !payload.Configuration.General.HideOwners {
		t.Fatalf("General = %#v", payload.Configuration.General)
	}
	if payload.Configuration.GoogleAuthn.GoogleClientSecret == nil || *payload.Configuration.GoogleAuthn.GoogleClientSecret != obfuscatedSecret {
		t.Fatalf("GoogleClientSecret = %#v", payload.Configuration.GoogleAuthn.GoogleClientSecret)
	}
	llm := payload.Configuration.LlmCategorization
	if !llm.Enabled || llm.Provider != model.LlmProviderOllama || llm.Ollama.Model != modelName {
		t.Fatalf("LlmCategorization = %#v", llm)
	}
	if !payload.Configuration.Mcp.Enabled {
		t.Fatalf("Mcp = %#v", payload.Configuration.Mcp)
	}
	if len(payload.Configuration.Mcp.DynamicRedirectHosts) != 1 || payload.Configuration.Mcp.DynamicRedirectHosts[0] != "claude.ai" {
		t.Fatalf("Mcp.DynamicRedirectHosts = %#v", payload.Configuration.Mcp.DynamicRedirectHosts)
	}
	if len(payload.Configuration.Security.TrustedProxyCidrs) != 2 || payload.Configuration.Security.TrustedProxyCidrs[0] != "10.0.0.0/24" {
		t.Fatalf("Security = %#v", payload.Configuration.Security)
	}
}

func TestConfigurationBuildersReturnGuardedValuesForZeroSection(t *testing.T) {
	cfg := runtimeconfig.Section[runtimeconfig.GeneralConfig]{}
	tests := map[string]struct {
		got  any
		want any
	}{
		"general": {got: buildGeneralConfig(cfg), want: &model.GeneralConfiguration{}},
		"llm": {
			got: (&Resolver{}).llmCategorizationConfig(runtimeconfig.Section[runtimeconfig.LLMConfig]{}),
			want: &model.LlmCategorizationConfiguration{
				Provider:         model.LlmProviderOllama,
				AllowedProviders: []model.LlmProvider{model.LlmProviderOllama},
				Ollama:           &model.OllamaProviderConfiguration{},
			},
		},
		"google":   {got: buildGoogleConfig(runtimeconfig.Section[runtimeconfig.GoogleConfig]{}), want: &model.GoogleAuthnConfiguration{}},
		"webauthn": {got: buildWebAuthnConfig(runtimeconfig.Section[runtimeconfig.WebAuthnConfig]{}), want: &model.PassKeyAuthnConfiguration{}},
		"email":    {got: buildEmailConfig(runtimeconfig.Section[runtimeconfig.EmailConfig]{}), want: &model.EmailCodeAuthnConfiguration{}},
		"mcp":      {got: buildMCPConfig(runtimeconfig.Section[runtimeconfig.MCPConfig]{}), want: &model.McpConfiguration{}},
		"security": {got: buildSecurityConfig(runtimeconfig.Section[runtimeconfig.SecurityConfig]{}), want: &model.SecurityConfiguration{TrustedProxyCidrs: []string{}}},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			if !reflect.DeepEqual(test.got, test.want) {
				t.Fatalf("builder returned %#v, want %#v", test.got, test.want)
			}
		})
	}
}

func TestUpdateConfigurationPreservesOmittedMCPRedirectHosts(t *testing.T) {
	ctx := context.Background()
	store := &graphConfigStore{sections: runtimeconfig.Sections{
		MCP: storedSection(true, runtimeconfig.MCPConfig{DynamicRedirectHosts: []string{"claude.ai"}}),
	}}
	svc := admin.NewService(store, runtimeconfig.New(store))
	must.NoErr(t, svc.LoadConfiguration(ctx, true, false))
	resolver := &Resolver{Admin: svc}

	payload, err := resolver.UpdateConfiguration(ctx, model.UpdateConfigurationInput{
		Mcp: &model.McpConfigurationInput{Enabled: true},
	})
	must.NoErr(t, err)
	if len(payload.Configuration.Mcp.DynamicRedirectHosts) != 1 ||
		payload.Configuration.Mcp.DynamicRedirectHosts[0] != "claude.ai" {
		t.Fatalf("DynamicRedirectHosts = %#v", payload.Configuration.Mcp.DynamicRedirectHosts)
	}
}

func TestUpdateConfigurationPreservesObfuscatedSecrets(t *testing.T) {
	ctx := context.Background()
	store := &graphConfigStore{sections: runtimeconfig.Sections{
		Auth:   storedSection(true, runtimeconfig.AuthConfig{MasterPassword: stringPtr("master-secret")}),
		Google: storedSection(true, runtimeconfig.GoogleConfig{ClientSecret: stringPtr("google-secret")}),
		Email:  storedSection(true, runtimeconfig.EmailConfig{Password: stringPtr("smtp-secret")}),
	}}
	svc := admin.NewService(store, runtimeconfig.New(store))
	must.NoErr(t, svc.LoadConfiguration(ctx, true, false))
	resolver := &Resolver{Admin: svc}
	secret := obfuscatedSecret

	if _, err := resolver.UpdateConfiguration(ctx, model.UpdateConfigurationInput{
		Authorization:     &model.AuthorizationConfigurationInput{MasterPassword: &secret},
		GoogleAuthn:       &model.GoogleAuthnConfigurationInput{Enabled: true, GoogleClientSecret: &secret},
		EmailCodeAuthn:    &model.EmailCodeAuthnConfigurationInput{Enabled: true, SMTPPassword: &secret},
		SetupComplete:     nil,
		PassKeyAuthn:      nil,
		LlmCategorization: nil,
	}); err != nil {
		t.Fatalf("UpdateConfiguration() error = %v", err)
	}
	if got, want := store.sections.Auth.Fields, (runtimeconfig.AuthConfig{MasterPassword: stringPtr("master-secret")}); !reflect.DeepEqual(got, want) {
		t.Fatalf("auth fields = %#v, want %#v", got, want)
	}
	if got, want := store.sections.Google.Fields, (runtimeconfig.GoogleConfig{ClientSecret: stringPtr("google-secret")}); !reflect.DeepEqual(got, want) {
		t.Fatalf("Google fields = %#v, want %#v", got, want)
	}
	if got, want := store.sections.Email.Fields, (runtimeconfig.EmailConfig{Password: stringPtr("smtp-secret")}); !reflect.DeepEqual(got, want) {
		t.Fatalf("Email fields = %#v, want %#v", got, want)
	}
}

func TestUpdateConfigurationReturnsAuthorizationChange(t *testing.T) {
	ctx := context.Background()
	issuerURL := "https://issuer.example.com"
	redirectURI := "https://app.example.com/callback"
	resolver := &Resolver{Admin: &updateConfigurationAdminStub{}}

	payload, err := resolver.UpdateConfiguration(ctx, model.UpdateConfigurationInput{
		Authorization: &model.AuthorizationConfigurationInput{
			OauthIssuerURL:        issuerURL,
			FrontendRedirectUris:  []string{redirectURI},
			AccessTokenLifetime:   "15m",
			RefreshTokenLifetime:  "168h",
			DevCorsAllowedOrigins: []string{"http://localhost:5173"},
		},
	})
	must.NoErr(t, err)
	if payload.Configuration.Authorization.OauthIssuerURL != issuerURL {
		t.Fatalf("OauthIssuerURL = %q", payload.Configuration.Authorization.OauthIssuerURL)
	}
	if len(payload.Configuration.Authorization.FrontendRedirectUris) != 1 || payload.Configuration.Authorization.FrontendRedirectUris[0] != redirectURI {
		t.Fatalf("FrontendRedirectUris = %#v", payload.Configuration.Authorization.FrontendRedirectUris)
	}
}

func TestUpdateConfigurationMarksSetupComplete(t *testing.T) {
	ctx := context.Background()
	store := &graphConfigStore{}
	svc := admin.NewService(store, runtimeconfig.New(store))
	must.NoErr(t, svc.LoadConfiguration(ctx, true, false))
	resolver := &Resolver{Admin: svc}
	setupComplete := true

	if _, err := resolver.UpdateConfiguration(ctx, model.UpdateConfigurationInput{
		Authorization: &model.AuthorizationConfigurationInput{
			OauthIssuerURL:       "https://spend.example",
			FrontendRedirectUris: []string{"https://spend.example/auth/callback"},
			AccessTokenLifetime:  "15m",
			RefreshTokenLifetime: "168h",
		},
		GoogleAuthn:   &model.GoogleAuthnConfigurationInput{Enabled: true},
		SetupComplete: &setupComplete,
	}); err != nil {
		t.Fatalf("UpdateConfiguration() error = %v", err)
	}
	if !svc.Sections().SetupComplete.Enabled {
		t.Fatalf("SetupComplete() = false")
	}
	if cfg := store.sections.SetupComplete; !cfg.Stored || !cfg.Enabled || !reflect.DeepEqual(cfg.Fields, runtimeconfig.SetupCompleteConfig{}) {
		t.Fatalf("stored setup complete = %#v", cfg)
	}
}

func stringPtr(value string) *string { return new(value) }

func storedSection[T any](enabled bool, fields T) runtimeconfig.Section[T] {
	return runtimeconfig.Section[T]{Stored: true, Enabled: enabled, Fields: fields}
}
