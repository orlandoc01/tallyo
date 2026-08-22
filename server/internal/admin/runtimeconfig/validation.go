package runtimeconfig

import (
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/samber/lo"

	"tallyo/internal/apierror"
	"tallyo/internal/middleware"
	u "tallyo/internal/utils"
)

func validateRuntimeConfig(config Sections) error {
	authConfig := config.Auth.Fields
	if config.Auth.Stored && !config.Auth.Enabled {
		if err := validateDisableAllAuthIssuer(authConfig.OAuthIssuerURL); err != nil {
			return err
		}
	}
	if !config.SetupComplete.Enabled {
		return nil
	}
	if lo.FromPtr(authConfig.MasterPassword) == "" && !config.OAuthEnabled() {
		return apierror.Publicf(
			"at least one auth method required: configure MASTER_PASSWORD or enable google, email, or passkey",
		)
	}
	if !config.OAuthEnabled() {
		return nil
	}
	if authConfig.OAuthIssuerURL == "" {
		return apierror.Publicf("oauth auth methods require oauth_issuer_url to be configured")
	}
	if len(authConfig.FrontendRedirectURIs) == 0 {
		return apierror.Publicf("oauth auth methods require at least one frontend_redirect_uris value")
	}
	if authConfig.AccessTokenLifetime() <= 0 || authConfig.RefreshTokenLifetime() <= 0 {
		return apierror.Publicf("access_token_lifetime and refresh_token_lifetime must be greater than zero")
	}
	return nil
}

func validateDisableAllAuthIssuer(issuer string) error {
	if issuer == "" {
		return nil
	}
	parsed, err := url.Parse(issuer)
	if err != nil {
		return fmt.Errorf("parse oauth_issuer_url: %w", err)
	}
	if parsed.Scheme != "http" || !isLocalhost(parsed.Hostname()) {
		return apierror.Publicf("DISABLE_ALL_AUTH is only allowed with a localhost http oauth_issuer_url")
	}
	return nil
}

func isLocalhost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (c LocaleConfig) Validate(_ bool) error {
	timezone := strings.TrimSpace(c.Timezone)
	if timezone == "" {
		return apierror.Publicf("timezone is required")
	}
	if _, err := time.LoadLocation(timezone); err != nil {
		return apierror.Public(fmt.Errorf("load locale timezone: %w", err))
	}
	return nil
}

func (c SecurityConfig) Validate(_ bool) error {
	_, err := middleware.ParseTrustedProxyCIDRs(c.TrustedProxyCIDRs)
	return apierror.Public(err)
}

func (c WebAuthnConfig) Validate(enabled bool) error {
	if !enabled {
		return nil
	}
	rpID := lo.FromPtr(c.RPID)
	if parsed, err := url.Parse("https://" + rpID); rpID != "" && (err != nil || parsed.Hostname() != rpID) {
		return apierror.Publicf("invalid webauthn_rp_id %q: use a valid bare hostname without scheme or port", rpID)
	}
	for _, origin := range c.RPOrigins {
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return apierror.Publicf("invalid webauthn_rp_origins entry %q: must be an absolute URL", origin)
		}
	}
	return nil
}

func (c LLMConfig) Validate(enabled bool) error {
	if !enabled {
		return nil
	}
	urlValue := lo.FromPtr(c.Ollama.URL)
	trimmed := strings.TrimSpace(urlValue)
	if trimmed == "" {
		return apierror.Publicf("ollama url is required when the ollama provider is enabled")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return apierror.Publicf("invalid ollama url %q: must be an absolute URL", urlValue)
	}
	return nil
}

func (c MCPConfig) Normalize() (MCPConfig, error) {
	normalizeHost := func(host string) (string, error) {
		host = strings.ToLower(strings.TrimSpace(host))
		if host == "" {
			return "", nil
		}
		if strings.ContainsAny(host, "/:") {
			return "", apierror.Publicf(
				"invalid dynamic redirect host %q: use a bare hostname without scheme, path, or port",
				host,
			)
		}
		return host, nil
	}

	normalized, err := u.MapErr(c.DynamicRedirectHosts, normalizeHost)
	if err != nil {
		return MCPConfig{}, err
	}
	c.DynamicRedirectHosts = lo.Compact(normalized)
	return c, nil
}
