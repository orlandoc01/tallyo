package auth

import "net/http"

func (s *Service) AuthorizationMetadata(w http.ResponseWriter, r *http.Request) {
	metadata := map[string]any{
		"issuer":                                s.cfg.IssuerURL,
		"authorization_endpoint":                s.cfg.IssuerURL + "/authorize",
		"token_endpoint":                        s.cfg.IssuerURL + "/token",
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported":      []string{"S256"},
		"token_endpoint_auth_methods_supported": []string{"none"},
		"scopes_supported":                      AllScopes,
	}
	if s.dcrSettings().Enabled {
		metadata["registration_endpoint"] = s.cfg.IssuerURL + "/register"
	}
	writePublicJSON(w, metadata)
}

func (s *Service) dcrSettings() DCRSettings {
	return s.cfg.DCRSettings()
}

func (s *Service) ProtectedResourceMetadata(w http.ResponseWriter, r *http.Request) {
	writePublicJSON(w, s.resourceMetadata(s.cfg.IssuerURL))
}

func (s *Service) MCPProtectedResourceMetadata(w http.ResponseWriter, r *http.Request) {
	writePublicJSON(w, s.resourceMetadata(s.cfg.IssuerURL+"/mcp"))
}

func (s *Service) resourceMetadata(resource string) map[string]any {
	return map[string]any{
		"resource":                 resource,
		"authorization_servers":    []string{s.cfg.IssuerURL},
		"scopes_supported":         AllScopes,
		"bearer_methods_supported": []string{"header"},
	}
}

func (s *Service) AuthConfig(w http.ResponseWriter, r *http.Request) {
	scopes := []string{}
	if s.cfg.MasterPassword != "" {
		scopes = AllScopes
	}
	writePublicJSON(w, map[string]any{
		"master_password_status": s.cfg.masterPasswordStatus(),
		"google_auth_enabled":    s.GoogleEnabled(),
		"email_auth_enabled":     s.EmailEnabled(),
		"webauthn_enabled":       s.PassKeyEnabled(),
		"disable_all_auth":       s.cfg.DisableAllAuth,
		"setup_complete":         s.cfg.SetupComplete(),
		"scopes":                 scopes,
	})
}
