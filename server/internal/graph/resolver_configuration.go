package graph

import (
	"context"
	"strings"

	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/config"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"

	"github.com/samber/lo"
)

const obfuscatedSecret = "********"

func (r *Resolver) Configuration() *model.Configuration {
	cfg := r.Config
	dyn := r.Admin.Sections()
	return &model.Configuration{
		ConfigFilePath:    lo.EmptyableToPtr(cfg.ConfigFilePath),
		DbPath:            cfg.DBPath,
		Port:              cfg.Port,
		SyncOff:           cfg.SyncOff,
		Locale:            buildLocaleConfig(dyn.Locale),
		General:           buildGeneralConfig(dyn.General),
		Authorization:     buildAuthorizationConfig(dyn.Auth, cfg),
		LlmCategorization: r.llmCategorizationConfig(dyn.LLM),
		GoogleAuthn:       buildGoogleConfig(dyn.Google),
		PassKeyAuthn:      buildWebAuthnConfig(dyn.WebAuthn),
		EmailCodeAuthn:    buildEmailConfig(dyn.Email),
		Mcp:               buildMCPConfig(dyn.MCP),
		Security:          buildSecurityConfig(dyn.Security),
	}
}

func (r *Resolver) InstanceTimezone() string {
	return r.Admin.Timezone()
}

func (r *Resolver) GeneralConfiguration() *model.GeneralConfiguration {
	return buildGeneralConfig(r.Admin.Sections().General)
}

func (r *Resolver) UpdateConfiguration(ctx context.Context, input model.UpdateConfigurationInput) (*model.UpdateConfigurationPayload, error) {
	dyn := r.Admin.Sections()
	var patch runtimeconfig.Patch
	if input.Locale != nil {
		patch.Locale = &runtimeconfig.SectionPatch[runtimeconfig.LocaleConfig]{
			Enabled: false,
			Fields:  runtimeconfig.LocaleConfig{Timezone: input.Locale.Timezone},
		}
	}
	if input.General != nil {
		patch.General = &runtimeconfig.SectionPatch[runtimeconfig.GeneralConfig]{Enabled: true, Fields: runtimeconfig.GeneralConfig{
			DisableTransactionTracking: input.General.DisableTransactionTracking,
			DisableWealthTracking:      input.General.DisableWealthTracking,
			HideOwners:                 input.General.HideOwners,
		}}
	}
	if input.SetupComplete != nil && *input.SetupComplete {
		patch.SetupComplete = &runtimeconfig.SectionPatch[runtimeconfig.SetupCompleteConfig]{Enabled: true}
	}
	if input.Authorization != nil {
		patch.Auth = &runtimeconfig.SectionPatch[runtimeconfig.AuthConfig]{
			Enabled: !input.Authorization.DisableAllAuth,
			Fields: runtimeconfig.AuthConfig{
				AccessTokenLifetimeRaw:  input.Authorization.AccessTokenLifetime,
				DevCORSAllowedOrigins:   input.Authorization.DevCorsAllowedOrigins,
				FrontendRedirectURIs:    input.Authorization.FrontendRedirectUris,
				MasterPassword:          preserveSecret(input.Authorization.MasterPassword, dyn.Auth.Fields.MasterPassword),
				OAuthIssuerURL:          input.Authorization.OauthIssuerURL,
				RefreshTokenLifetimeRaw: input.Authorization.RefreshTokenLifetime,
			},
		}
	}
	if input.LlmCategorization != nil {
		patch.LLM = &runtimeconfig.SectionPatch[runtimeconfig.LLMConfig]{
			Enabled: input.LlmCategorization.Enabled,
			Fields:  llmRuntimeConfigFromInput(input.LlmCategorization),
		}
	}
	if input.GoogleAuthn != nil {
		patch.Google = &runtimeconfig.SectionPatch[runtimeconfig.GoogleConfig]{
			Enabled: input.GoogleAuthn.Enabled,
			Fields: runtimeconfig.GoogleConfig{
				ClientID:     input.GoogleAuthn.GoogleClientID,
				ClientSecret: preserveSecret(input.GoogleAuthn.GoogleClientSecret, dyn.Google.Fields.ClientSecret),
			},
		}
	}
	if input.PassKeyAuthn != nil {
		patch.WebAuthn = &runtimeconfig.SectionPatch[runtimeconfig.WebAuthnConfig]{
			Enabled: input.PassKeyAuthn.Enabled,
			Fields:  runtimeconfig.WebAuthnConfig{RPID: input.PassKeyAuthn.WebauthnRpID, RPName: input.PassKeyAuthn.WebauthnRpName, RPOrigins: input.PassKeyAuthn.WebauthnRpOrigins},
		}
	}
	if input.EmailCodeAuthn != nil {
		patch.Email = &runtimeconfig.SectionPatch[runtimeconfig.EmailConfig]{
			Enabled: input.EmailCodeAuthn.Enabled,
			Fields: runtimeconfig.EmailConfig{
				From:     input.EmailCodeAuthn.SMTPFrom,
				Host:     input.EmailCodeAuthn.SMTPHost,
				Password: preserveSecret(input.EmailCodeAuthn.SMTPPassword, dyn.Email.Fields.Password),
				Port:     input.EmailCodeAuthn.SMTPPort,
				Username: input.EmailCodeAuthn.SMTPUsername,
			},
		}
	}
	if input.Mcp != nil {
		dynamicRedirectHosts := input.Mcp.DynamicRedirectHosts
		if dynamicRedirectHosts == nil {
			dynamicRedirectHosts = dyn.MCP.Fields.DynamicRedirectHosts
		}
		patch.MCP = &runtimeconfig.SectionPatch[runtimeconfig.MCPConfig]{
			Enabled: input.Mcp.Enabled,
			Fields:  runtimeconfig.MCPConfig{DynamicRedirectHosts: dynamicRedirectHosts},
		}
	}
	if input.Security != nil {
		patch.Security = &runtimeconfig.SectionPatch[runtimeconfig.SecurityConfig]{
			Enabled: true,
			Fields:  runtimeconfig.SecurityConfig{TrustedProxyCIDRs: cleanStringList(input.Security.TrustedProxyCidrs)},
		}
	}
	if err := r.Admin.UpdateSections(ctx, patch); err != nil {
		return nil, err
	}
	return &model.UpdateConfigurationPayload{Configuration: r.Configuration()}, nil
}

func preserveSecret(value, current *string) *string {
	if value != nil && *value == obfuscatedSecret {
		return current
	}
	return value
}

func buildAuthorizationConfig(cfg runtimeconfig.Section[runtimeconfig.AuthConfig], fallback config.Config) *model.AuthorizationConfiguration {
	if !cfg.Stored {
		return &model.AuthorizationConfiguration{MasterPassword: secretValue(lo.EmptyableToPtr(fallback.Authorization.MasterPassword)), DisableAllAuth: fallback.Authorization.DisableAllAuth}
	}
	return &model.AuthorizationConfiguration{MasterPassword: secretValue(cfg.Fields.MasterPassword), DisableAllAuth: !cfg.Enabled, OauthIssuerURL: cfg.Fields.OAuthIssuerURL, FrontendRedirectUris: cfg.Fields.FrontendRedirectURIs, AccessTokenLifetime: cfg.Fields.AccessTokenLifetimeRaw, RefreshTokenLifetime: cfg.Fields.RefreshTokenLifetimeRaw, DevCorsAllowedOrigins: stringListValue(cfg.Fields.DevCORSAllowedOrigins)}
}

func buildGeneralConfig(cfg runtimeconfig.Section[runtimeconfig.GeneralConfig]) *model.GeneralConfiguration {
	fields := cfg.Fields
	return &model.GeneralConfiguration{
		DisableTransactionTracking: fields.DisableTransactionTracking,
		DisableWealthTracking:      fields.DisableWealthTracking,
		HideOwners:                 fields.HideOwners,
	}
}

func buildGoogleConfig(cfg runtimeconfig.Section[runtimeconfig.GoogleConfig]) *model.GoogleAuthnConfiguration {
	return &model.GoogleAuthnConfiguration{Enabled: cfg.Enabled, GoogleClientID: lo.EmptyableToPtr(lo.FromPtr(cfg.Fields.ClientID)), GoogleClientSecret: secretValue(cfg.Fields.ClientSecret)}
}

func buildWebAuthnConfig(cfg runtimeconfig.Section[runtimeconfig.WebAuthnConfig]) *model.PassKeyAuthnConfiguration {
	return &model.PassKeyAuthnConfiguration{Enabled: cfg.Enabled, WebauthnRpID: lo.EmptyableToPtr(lo.FromPtr(cfg.Fields.RPID)), WebauthnRpName: cfg.Fields.RPName, WebauthnRpOrigins: stringListValue(cfg.Fields.RPOrigins)}
}

func buildEmailConfig(cfg runtimeconfig.Section[runtimeconfig.EmailConfig]) *model.EmailCodeAuthnConfiguration {
	return &model.EmailCodeAuthnConfiguration{Enabled: cfg.Enabled, SMTPHost: lo.EmptyableToPtr(lo.FromPtr(cfg.Fields.Host)), SMTPPort: cfg.Fields.Port, SMTPFrom: lo.EmptyableToPtr(lo.FromPtr(cfg.Fields.From)), SMTPUsername: lo.EmptyableToPtr(lo.FromPtr(cfg.Fields.Username)), SMTPPassword: secretValue(cfg.Fields.Password)}
}

func buildMCPConfig(cfg runtimeconfig.Section[runtimeconfig.MCPConfig]) *model.McpConfiguration {
	return &model.McpConfiguration{Enabled: cfg.Enabled, DynamicRedirectHosts: stringListValue(cfg.Fields.DynamicRedirectHosts)}
}

func buildSecurityConfig(cfg runtimeconfig.Section[runtimeconfig.SecurityConfig]) *model.SecurityConfiguration {
	return &model.SecurityConfiguration{TrustedProxyCidrs: cleanStringList(cfg.Fields.TrustedProxyCIDRs)}
}

func buildLocaleConfig(cfg runtimeconfig.Section[runtimeconfig.LocaleConfig]) *model.Locale {
	timezone := u.FallbackTimezone
	if cfg.Stored && cfg.Fields.Timezone != "" {
		timezone = cfg.Fields.Timezone
	}
	return &model.Locale{Timezone: timezone}
}

func secretValue(value *string) *string {
	if value == nil || *value == "" {
		return nil
	}
	secret := obfuscatedSecret
	return &secret
}

func stringListValue(value []string) []string {
	if len(value) == 0 {
		return nil
	}
	return value
}

func cleanStringList(values []string) []string {
	clean := func(value string, _ int) (string, bool) {
		if value := strings.TrimSpace(value); value != "" {
			return value, true
		}
		return "", false
	}
	return lo.FilterMap(values, clean)
}
