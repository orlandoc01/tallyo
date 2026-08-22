package auth

import (
	"fmt"
	"net/url"
	"strings"

	webauthnlib "github.com/go-webauthn/webauthn/webauthn"
)

func (s *Service) GoogleEnabled() bool {
	s.dynMu.RLock()
	defer s.dynMu.RUnlock()
	return s.cfg.GoogleAuthnEnabled
}

func (s *Service) OAuthEnabled() bool {
	s.dynMu.RLock()
	defer s.dynMu.RUnlock()
	return s.cfg.OAuthEnabled
}

func (s *Service) EmailEnabled() bool {
	s.dynMu.RLock()
	defer s.dynMu.RUnlock()
	return s.cfg.EmailCodeAuthnEnabled
}

func (s *Service) PassKeyEnabled() bool {
	s.dynMu.RLock()
	defer s.dynMu.RUnlock()
	return s.cfg.PassKeyAuthnEnabled
}

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
