package runtimeconfig

import (
	"context"
	"errors"
	"testing"

	"tallyo/internal/transactions"
	"tallyo/internal/transactions/categorizer"
	"tallyo/internal/utils/nooplog"
)

type fakeRuntimeAuthService struct {
	emailEnabled  bool
	emailHost     string
	emailPassword string

	googleEnabled  bool
	googleClientID string
	googleSecret   string

	webAuthnEnabled bool
	rpID            string
	rpOrigins       []string
	timezone        string
}

func (s *fakeRuntimeAuthService) UpdateEmailConfig(enabled bool, host, _ string, _ string, _ string, password string) {
	s.emailEnabled = enabled
	s.emailHost = host
	s.emailPassword = password
}

func (s *fakeRuntimeAuthService) UpdateGoogleConfig(enabled bool, clientID, secret string) {
	s.googleEnabled = enabled
	s.googleClientID = clientID
	s.googleSecret = secret
}

func (s *fakeRuntimeAuthService) PrepareWebAuthnConfig(enabled bool, _, rpID, _ string, origins []string) (func(), error) {
	return func() {
		s.webAuthnEnabled = enabled
		s.rpID = rpID
		s.rpOrigins = origins
	}, nil
}

func (s *fakeRuntimeAuthService) SetTimezone(timezone string) {
	s.timezone = timezone
}

type fakeRuntimeClientIPResolver struct {
	trustedProxyCIDRs []string
}

func (r *fakeRuntimeClientIPResolver) SetTrustedProxyCIDRs(trustedProxyCIDRs []string) error {
	r.trustedProxyCIDRs = trustedProxyCIDRs
	return nil
}

type fakeLLMConfigurable struct {
	llm      transactions.Categorizer
	setCalls int
}

func (s *fakeLLMConfigurable) SetLLM(llm transactions.Categorizer) {
	s.llm = llm
	s.setCalls++
}

type fakeLLMConfigurationStore struct {
	categories    []categorizer.CategoryRef
	categoriesErr error
	clearErr      error
	clearCalls    int
}

func (s *fakeLLMConfigurationStore) CategoriesForLLM(context.Context) ([]categorizer.CategoryRef, error) {
	return s.categories, s.categoriesErr
}

func (s *fakeLLMConfigurationStore) ClearStagedForLLM(context.Context) error {
	s.clearCalls++
	return s.clearErr
}

func TestRegisterRuntimeConfigurationCallbacks(t *testing.T) {
	store := &fakeStore{sections: Sections{Auth: storedSection(true, AuthConfig{MasterPassword: stringPtr("secret")})}}
	manager := loadedManager(t, store, false, false)
	authService := &fakeRuntimeAuthService{}
	clientIPs := &fakeRuntimeClientIPResolver{}
	syncer := &fakeLLMConfigurable{}
	transactionStore := &fakeLLMConfigurationStore{}
	manager.RegisterRuntimeConfigurationCallbacks(
		context.Background(),
		authService,
		syncer,
		transactionStore,
		clientIPs,
		nooplog.Logger,
	)

	updates := []struct {
		name  string
		patch Patch
	}{
		{
			name: "email",
			patch: Patch{Email: &SectionPatch[EmailConfig]{Enabled: true, Fields: EmailConfig{
				Host:     stringPtr("smtp.example"),
				Port:     "587",
				From:     stringPtr("from@example.com"),
				Username: stringPtr("user"),
				Password: stringPtr("pass"),
			}}},
		},
		{
			name:  "google",
			patch: Patch{Google: &SectionPatch[GoogleConfig]{Enabled: true, Fields: GoogleConfig{ClientID: stringPtr("client"), ClientSecret: stringPtr("secret")}}},
		},
		{
			name: "webauthn",
			patch: Patch{WebAuthn: &SectionPatch[WebAuthnConfig]{Enabled: true, Fields: WebAuthnConfig{
				RPID:      stringPtr("spend.example"),
				RPName:    "Spend",
				RPOrigins: []string{"https://spend.example"},
			}}},
		},
		{
			name:  "locale",
			patch: Patch{Locale: &SectionPatch[LocaleConfig]{Fields: LocaleConfig{Timezone: "America/Los_Angeles"}}},
		},
		{
			name: "security",
			patch: Patch{Security: &SectionPatch[SecurityConfig]{Fields: SecurityConfig{
				TrustedProxyCIDRs: []string{"10.0.0.0/24", "127.0.0.1"},
			}}},
		},
		{
			name: "llm",
			patch: Patch{LLM: &SectionPatch[LLMConfig]{Enabled: true, Fields: LLMConfig{
				Provider: LLMProviderOllama,
				Ollama:   OllamaConfig{URL: stringPtr("http://localhost:11434"), Model: "llama3"},
			}}},
		},
	}
	for _, update := range updates {
		t.Run(update.name, func(t *testing.T) {
			if err := manager.UpdateSections(context.Background(), update.patch); err != nil {
				t.Fatalf("UpdateSections() error = %v", err)
			}
		})
	}

	if !authService.emailEnabled || authService.emailHost != "smtp.example" || authService.emailPassword != "pass" {
		t.Fatalf("email callback state = %+v", authService)
	}
	if !authService.googleEnabled || authService.googleClientID != "client" || authService.googleSecret != "secret" {
		t.Fatalf("google callback state = %+v", authService)
	}
	if !authService.webAuthnEnabled || authService.rpID != "spend.example" || authService.rpOrigins[0] != "https://spend.example" {
		t.Fatalf("webauthn callback state = %+v", authService)
	}
	if authService.timezone != "America/Los_Angeles" {
		t.Fatalf("timezone = %q", authService.timezone)
	}
	if len(clientIPs.trustedProxyCIDRs) != 2 || clientIPs.trustedProxyCIDRs[0] != "10.0.0.0/24" {
		t.Fatalf("trusted proxy cidrs = %#v", clientIPs.trustedProxyCIDRs)
	}
	if syncer.setCalls != 1 || syncer.llm == nil {
		t.Fatalf("SetLLM() calls = %d, llm = %#v", syncer.setCalls, syncer.llm)
	}
}

func TestMCPUpdateNormalizesHosts(t *testing.T) {
	manager := loadedManager(t, &fakeStore{sections: Sections{Auth: storedSection(true, AuthConfig{MasterPassword: stringPtr("secret")})}}, false, false)
	err := manager.UpdateSections(context.Background(), Patch{MCP: &SectionPatch[MCPConfig]{Enabled: true, Fields: MCPConfig{
		DynamicRedirectHosts: []string{" Claude.AI ", "mcp.example.com"},
	}}})
	if err != nil {
		t.Fatalf("UpdateSections() error = %v", err)
	}
	config := manager.Sections().MCP
	if !config.Enabled || len(config.Fields.DynamicRedirectHosts) != 2 || config.Fields.DynamicRedirectHosts[0] != "claude.ai" {
		t.Fatalf("MCP() = %+v", config)
	}
}

func TestPrepareSyncerLLM(t *testing.T) {
	t.Run("disabled clears staged transactions", func(t *testing.T) {
		syncer := &fakeLLMConfigurable{}
		store := &fakeLLMConfigurationStore{}
		manager := loadedManager(t, &fakeStore{}, false, true)
		commit, err := manager.prepareSyncerLLM(
			context.Background(),
			Section[LLMConfig]{},
			syncer,
			store,
			nooplog.Logger,
		)
		if err != nil {
			t.Fatalf("prepareSyncerLLM() error = %v", err)
		}
		commit()
		if syncer.setCalls != 1 || syncer.llm != nil {
			t.Fatalf("syncer = %+v, store = %+v", syncer, store)
		}
	})
	t.Run("category load failure", func(t *testing.T) {
		manager := loadedManager(t, &fakeStore{}, false, true)
		_, err := manager.prepareSyncerLLM(
			context.Background(),
			Section[LLMConfig]{Enabled: true, Fields: LLMConfig{
				Provider: LLMProviderOllama,
				Ollama:   OllamaConfig{URL: stringPtr("http://localhost:11434")},
			}},
			&fakeLLMConfigurable{},
			&fakeLLMConfigurationStore{categoriesErr: errors.New("database unavailable")},
			nooplog.Logger,
		)
		assertValidationError(t, "load llm categories: database unavailable", err)
	})
}
