package auth

import "net/http"

func (s *Service) AuthorizationMetadata(w http.ResponseWriter, r *http.Request) {
	issuer := s.IssuerURL()
	metadata := map[string]any{
		"issuer":                                issuer,
		"authorization_endpoint":                issuer + "/authorize",
		"token_endpoint":                        issuer + "/token",
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported":      []string{"S256"},
		"token_endpoint_auth_methods_supported": []string{"none"},
		"scopes_supported":                      AllScopes,
	}
	if s.dcrSettings().Enabled {
		metadata["registration_endpoint"] = issuer + "/register"
	}
	writePublicJSON(w, metadata)
}

func (s *Service) dcrSettings() DCRSettings {
	return s.cfg.DCRSettings()
}

func (s *Service) ProtectedResourceMetadata(w http.ResponseWriter, r *http.Request) {
	writePublicJSON(w, s.resourceMetadata(""))
}

func (s *Service) MCPProtectedResourceMetadata(w http.ResponseWriter, r *http.Request) {
	writePublicJSON(w, s.resourceMetadata("/mcp"))
}

func (s *Service) resourceMetadata(path string) map[string]any {
	issuer := s.IssuerURL()
	return map[string]any{
		"resource":                 issuer + path,
		"authorization_servers":    []string{issuer},
		"scopes_supported":         AllScopes,
		"bearer_methods_supported": []string{"header"},
	}
}

func (s *Service) AuthConfig(w http.ResponseWriter, r *http.Request) {
	cfg := s.config()
	scopes := []string{}
	if cfg.MasterPassword != "" {
		scopes = AllScopes
	}
	writePublicJSON(w, map[string]any{
		"master_password_status": cfg.masterPasswordStatus(),
		"google_auth_enabled":    s.GoogleEnabled(),
		"email_auth_enabled":     s.EmailEnabled(),
		"webauthn_enabled":       s.PassKeyEnabled(),
		"disable_all_auth":       cfg.DisableAllAuth,
		"setup_complete":         s.cfg.SetupComplete(),
		"scopes":                 scopes,
	})
}
