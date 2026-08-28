package auth

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	webauthnlib "github.com/go-webauthn/webauthn/webauthn"
	"github.com/ory/fosite"
	"github.com/samber/lo"

	"tallyo/internal/admin/runtimeconfig"
)

func (s *Service) config() Config {
	s.dynMu.RLock()
	defer s.dynMu.RUnlock()
	return s.cfg
}

func (s *Service) IssuerURL() string {
	return s.config().IssuerURL
}

func (s *Service) oauthProvider() fosite.OAuth2Provider {
	s.dynMu.RLock()
	defer s.dynMu.RUnlock()
	return s.provider
}

func (s *Service) devOriginAllowed(origin string) bool {
	s.dynMu.RLock()
	defer s.dynMu.RUnlock()
	_, ok := s.devOrigins[origin]
	return ok
}

func (s *Service) PrepareAuthConfig(ctx context.Context, resolved runtimeconfig.Sections) (func(), error) {
	next := resolved.Auth.Fields
	cfg := s.config()
	cfg.IssuerURL = next.OAuthIssuerURL
	cfg.OAuthEnabled = resolved.OAuthEnabled()
	cfg.DisableAllAuth = resolved.DisableAllAuth()
	if !cfg.MasterPasswordFromEnv {
		cfg.MasterPassword = lo.FromPtr(next.MasterPassword)
	}
	cfg.FrontendRedirectURIs = next.FrontendRedirectURIs
	cfg.AccessTokenLifetime = next.AccessTokenLifetime()
	cfg.RefreshTokenLifetime = next.RefreshTokenLifetime()
	cfg.DevCORSAllowedOrigins = next.DevCORSAllowedOrigins
	if err := normalizeAuthConfig(&cfg); err != nil {
		return nil, err
	}
	if err := s.store.UpsertFrontendClient(ctx, cfg.FrontendRedirectURIs); err != nil {
		return nil, err
	}
	fositeStore := NewFositeStore(s.store, cfg.IssuerURL)
	provider := newOAuthProvider(cfg, fositeStore, s.signingKey)
	devOrigins := normalizeOriginSet(cfg.DevCORSAllowedOrigins)
	return func() {
		s.dynMu.Lock()
		defer s.dynMu.Unlock()
		s.cfg.IssuerURL = cfg.IssuerURL
		s.cfg.OAuthEnabled = cfg.OAuthEnabled
		s.cfg.DisableAllAuth = cfg.DisableAllAuth
		s.cfg.MasterPassword = cfg.MasterPassword
		s.cfg.FrontendRedirectURIs = cfg.FrontendRedirectURIs
		s.cfg.AccessTokenLifetime = cfg.AccessTokenLifetime
		s.cfg.RefreshTokenLifetime = cfg.RefreshTokenLifetime
		s.cfg.DevCORSAllowedOrigins = cfg.DevCORSAllowedOrigins
		s.fositeStore = fositeStore
		s.provider = provider
		s.devOrigins = devOrigins
		if s.cfg.GoogleAuthnEnabled {
			s.googleConfig = newGoogleConfig(s.cfg)
		}
		warnIfAuthDisabled(s.cfg)
	}, nil
}

func (s *Service) GoogleEnabled() bool { return s.config().GoogleAuthnEnabled }

func (s *Service) OAuthEnabled() bool { return s.config().OAuthEnabled }

func (s *Service) EmailEnabled() bool { return s.config().EmailCodeAuthnEnabled }

func (s *Service) PassKeyEnabled() bool { return s.config().PassKeyAuthnEnabled }

func (s *Service) GetGoogleConfig() googleOAuthConfig {
	s.dynMu.RLock()
	defer s.dynMu.RUnlock()
	return s.googleConfig
}

func (s *Service) GetEmailSender() EmailSender {
	s.dynMu.RLock()
	defer s.dynMu.RUnlock()
	return s.emailSender
}

func (s *Service) GetWebAuthn() *webauthnlib.WebAuthn {
	s.dynMu.RLock()
	defer s.dynMu.RUnlock()
	return s.webauthn
}

func (s *Service) UpdateEmailConfig(enabled bool, host, port, from, username, password string) {
	s.dynMu.Lock()
	defer s.dynMu.Unlock()
	s.cfg.EmailCodeAuthnEnabled = enabled
	s.cfg.SMTPHost = host
	s.cfg.SMTPPort = port
	s.cfg.SMTPFrom = from
	s.cfg.SMTPUsername = username
	s.cfg.SMTPPassword = password
	s.emailSender = newEmailSender(s.cfg, s.cfg.Log)
}

func (s *Service) UpdateGoogleConfig(enabled bool, clientID, secret string) {
	s.dynMu.Lock()
	defer s.dynMu.Unlock()
	s.cfg.GoogleAuthnEnabled = enabled
	s.cfg.GoogleClientID = clientID
	s.cfg.GoogleClientSecret = secret
	if enabled {
		s.googleConfig = newGoogleConfig(s.cfg)
	} else {
		s.googleConfig = nil
	}
}

func (s *Service) PrepareWebAuthnConfig(enabled bool, issuer, rpID, rpName string, rpOrigins []string) (func(), error) {
	s.dynMu.RLock()
	next := s.cfg
	s.dynMu.RUnlock()
	next.IssuerURL = issuer
	next.PassKeyAuthnEnabled = enabled
	next.WebAuthnRPID = rpID
	next.WebAuthnRPDisplayName = rpName
	next.WebAuthnRPOrigins = rpOrigins
	var webAuthn *webauthnlib.WebAuthn
	if enabled {
		var err error
		webAuthn, err = newWebAuthn(&next)
		if err != nil {
			return nil, err
		}
	}
	return func() {
		s.dynMu.Lock()
		s.cfg.IssuerURL = next.IssuerURL
		s.cfg.PassKeyAuthnEnabled = next.PassKeyAuthnEnabled
		s.cfg.WebAuthnRPID = next.WebAuthnRPID
		s.cfg.WebAuthnRPDisplayName = next.WebAuthnRPDisplayName
		s.cfg.WebAuthnRPOrigins = next.WebAuthnRPOrigins
		s.webauthn = webAuthn
		s.dynMu.Unlock()
	}, nil
}

func newWebAuthn(cfg *Config) (*webauthnlib.WebAuthn, error) {
	if cfg.WebAuthnRPID == "" || len(cfg.WebAuthnRPOrigins) == 0 {
		issuer, err := url.Parse(cfg.IssuerURL)
		if err != nil {
			return nil, fmt.Errorf("parse issuer url: %w", err)
		}
		if cfg.WebAuthnRPID == "" {
			cfg.WebAuthnRPID = issuer.Hostname()
		}
		if len(cfg.WebAuthnRPOrigins) == 0 {
			cfg.WebAuthnRPOrigins = []string{issuer.Scheme + "://" + issuer.Host}
		}
	}
	if cfg.WebAuthnRPDisplayName == "" {
		cfg.WebAuthnRPDisplayName = "Tallyo"
	}
	for i, origin := range cfg.WebAuthnRPOrigins {
		parsed, err := url.Parse(origin)
		validScheme := parsed != nil && (parsed.Scheme == "http" || parsed.Scheme == "https")
		// A bare trailing slash serializes to the same browser origin, so
		// normalize it instead of rejecting previously-valid stored config.
		isOrigin := parsed != nil && parsed.User == nil && (parsed.Path == "" || parsed.Path == "/") && parsed.RawQuery == "" && !parsed.ForceQuery && parsed.Fragment == ""
		if err != nil || !validScheme || parsed.Host == "" || !isOrigin {
			return nil, fmt.Errorf("invalid webauthn origin %q", origin)
		}
		host := parsed.Hostname()
		if host != cfg.WebAuthnRPID && !strings.HasSuffix(host, "."+cfg.WebAuthnRPID) {
			return nil, fmt.Errorf("webauthn origin %q is outside RP ID %q", origin, cfg.WebAuthnRPID)
		}
		cfg.WebAuthnRPOrigins[i] = parsed.Scheme + "://" + parsed.Host
	}
	webAuthn, err := webauthnlib.New(&webauthnlib.Config{
		RPID:          cfg.WebAuthnRPID,
		RPDisplayName: cfg.WebAuthnRPDisplayName,
		RPOrigins:     cfg.WebAuthnRPOrigins,
	})
	if err != nil {
		return nil, fmt.Errorf("initialize webauthn: %w", err)
	}
	return webAuthn, nil
}
