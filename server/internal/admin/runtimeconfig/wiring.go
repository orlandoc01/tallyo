package runtimeconfig

import (
	"cmp"
	"context"
	"fmt"
	"log/slog"

	"github.com/samber/lo"

	"tallyo/internal/apierror"
	"tallyo/internal/transactions"
	"tallyo/internal/transactions/categorizer"
)

type llmConfigurationStore interface {
	CategoriesForLLM(ctx context.Context) ([]categorizer.CategoryRef, error)
}

func (m *Manager) RegisterRuntimeConfigurationCallbacks(
	ctx context.Context,
	authService RuntimeAuthService,
	syncer transactions.LLMConfigurable,
	transactionStore llmConfigurationStore,
	clientIPResolver RuntimeClientIPResolver,
	logger *slog.Logger,
) {
	m.OnChange([]SectionID{SectionEmail}, func() {
		config := m.Sections().Email
		authService.UpdateEmailConfig(
			config.Enabled,
			lo.FromPtr(config.Fields.Host),
			config.Fields.Port,
			lo.FromPtr(config.Fields.From),
			lo.FromPtr(config.Fields.Username),
			lo.FromPtr(config.Fields.Password),
		)
	})
	m.OnChange([]SectionID{SectionGoogle}, func() {
		config := m.Sections().Google
		authService.UpdateGoogleConfig(
			config.Enabled,
			lo.FromPtr(config.Fields.ClientID),
			lo.FromPtr(config.Fields.ClientSecret),
		)
	})
	m.onPrepare([]SectionID{SectionAuth, SectionWebAuthn}, func(_ context.Context, prospective Sections) (func(), error) {
		config := prospective.WebAuthn
		commit, err := authService.PrepareWebAuthnConfig(
			config.Enabled,
			prospective.Auth.Fields.OAuthIssuerURL,
			lo.FromPtr(config.Fields.RPID),
			config.Fields.RPName,
			config.Fields.RPOrigins,
		)
		return commit, apierror.Public(err)
	})
	m.onPrepare([]SectionID{SectionLLM}, func(ctx context.Context, prospective Sections) (func(), error) {
		return m.prepareSyncerLLM(
			ctx,
			prospective.LLM,
			syncer,
			transactionStore,
			logger,
		)
	})
	m.OnChange([]SectionID{SectionLocale}, func() {
		authService.SetTimezone(m.Timezone())
	})
	m.OnChange([]SectionID{SectionSecurity}, func() {
		if err := clientIPResolver.SetTrustedProxyCIDRs(m.Sections().Security.Fields.TrustedProxyCIDRs); err != nil {
			logger.Error("update trusted proxy cidrs failed", "error", err)
		}
	})
}

func (m *Manager) ConfigureSyncerLLM(
	ctx context.Context,
	syncer transactions.LLMConfigurable,
	transactionStore llmConfigurationStore,
	logger *slog.Logger,
) error {
	config := m.Sections().LLM
	commit, err := m.prepareSyncerLLM(
		ctx,
		config,
		syncer,
		transactionStore,
		logger,
	)
	if err != nil {
		return err
	}
	commit()
	return nil
}

func (m *Manager) prepareSyncerLLM(
	ctx context.Context,
	config Section[LLMConfig],
	syncer transactions.LLMConfigurable,
	transactionStore llmConfigurationStore,
	logger *slog.Logger,
) (func(), error) {
	disable := func() {
		syncer.SetLLM(nil)
		logger.Info("llm categorization disabled")
	}
	url := lo.FromPtr(config.Fields.Ollama.URL)
	ollamaActive := config.Fields.Provider == "" || config.Fields.Provider == LLMProviderOllama
	if !config.Enabled || (ollamaActive && url == "") {
		return disable, nil
	}
	categories, err := transactionStore.CategoriesForLLM(ctx)
	if err != nil {
		return nil, fmt.Errorf("load llm categories: %w", err)
	}
	var llm transactions.Categorizer
	switch config.Fields.Provider {
	case "", LLMProviderOllama:
		llm = categorizer.NewOllamaCategorizer(url, config.Fields.Ollama.Model, categories, logger)
	default:
		return nil, apierror.Publicf("unknown llm provider %q", config.Fields.Provider)
	}
	return func() {
		syncer.SetLLM(llm)
		logger.Info(
			"llm categorization enabled",
			"provider",
			cmp.Or(string(config.Fields.Provider), string(LLMProviderOllama)),
			"categories",
			len(categories),
		)
	}, nil
}
