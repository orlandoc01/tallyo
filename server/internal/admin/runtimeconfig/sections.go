package runtimeconfig

import (
	"time"

	"github.com/samber/lo"
)

type SectionID string

const (
	SectionAuth          SectionID = "AUTHORIZATION"
	SectionEmail         SectionID = "EMAIL"
	SectionGeneral       SectionID = "GENERAL"
	SectionGoogle        SectionID = "GOOGLE"
	SectionLLM           SectionID = "LLM"
	SectionLocale        SectionID = "LOCALE"
	SectionMCP           SectionID = "MCP"
	SectionSecurity      SectionID = "SECURITY"
	SectionSetupComplete SectionID = "SETUP_COMPLETE"
	SectionWebAuthn      SectionID = "WEBAUTHN"
)

type Section[T any] struct {
	Stored  bool
	Enabled bool
	Fields  T
}

type Sections struct {
	Auth          Section[AuthConfig]
	Email         Section[EmailConfig]
	General       Section[GeneralConfig]
	Google        Section[GoogleConfig]
	LLM           Section[LLMConfig]
	Locale        Section[LocaleConfig]
	MCP           Section[MCPConfig]
	Security      Section[SecurityConfig]
	SetupComplete Section[SetupCompleteConfig]
	WebAuthn      Section[WebAuthnConfig]
}

func (s Sections) OAuthEnabled() bool {
	return s.Google.Enabled || s.Email.Enabled || s.WebAuthn.Enabled
}

func (s Sections) DisableAllAuth() bool {
	return (s.Auth.Stored && !s.Auth.Enabled) ||
		(!s.SetupComplete.Enabled && lo.FromPtr(s.Auth.Fields.MasterPassword) == "")
}

type SectionPatch[T any] struct {
	Enabled bool
	Fields  T
}

type Patch struct {
	Auth          *SectionPatch[AuthConfig]
	Email         *SectionPatch[EmailConfig]
	General       *SectionPatch[GeneralConfig]
	Google        *SectionPatch[GoogleConfig]
	LLM           *SectionPatch[LLMConfig]
	Locale        *SectionPatch[LocaleConfig]
	MCP           *SectionPatch[MCPConfig]
	Security      *SectionPatch[SecurityConfig]
	SetupComplete *SectionPatch[SetupCompleteConfig]
	WebAuthn      *SectionPatch[WebAuthnConfig]
}

func (p Patch) sections() []SectionID {
	ids := conditionalAppend([]SectionID{}, p.Auth, SectionAuth)
	ids = conditionalAppend(ids, p.Email, SectionEmail)
	ids = conditionalAppend(ids, p.General, SectionGeneral)
	ids = conditionalAppend(ids, p.Google, SectionGoogle)
	ids = conditionalAppend(ids, p.LLM, SectionLLM)
	ids = conditionalAppend(ids, p.Locale, SectionLocale)
	ids = conditionalAppend(ids, p.MCP, SectionMCP)
	ids = conditionalAppend(ids, p.Security, SectionSecurity)
	ids = conditionalAppend(ids, p.SetupComplete, SectionSetupComplete)
	return conditionalAppend(ids, p.WebAuthn, SectionWebAuthn)
}

func conditionalAppend[T any](ids []SectionID, val *T, id SectionID) []SectionID {
	if val != nil {
		ids = append(ids, id)
	}
	return ids
}

type AuthConfig struct {
	AccessTokenLifetimeRaw  string   `json:"access_token_lifetime"`
	DevCORSAllowedOrigins   []string `json:"dev_cors_allowed_origins"`
	FrontendRedirectURIs    []string `json:"frontend_redirect_uris"`
	MasterPassword          *string  `json:"master_password"`
	OAuthIssuerURL          string   `json:"oauth_issuer_url"`
	RefreshTokenLifetimeRaw string   `json:"refresh_token_lifetime"`
}

func (c AuthConfig) AccessTokenLifetime() time.Duration {
	duration, _ := time.ParseDuration(c.AccessTokenLifetimeRaw)
	return duration
}

func (c AuthConfig) RefreshTokenLifetime() time.Duration {
	duration, _ := time.ParseDuration(c.RefreshTokenLifetimeRaw)
	return duration
}

type EmailConfig struct {
	From     *string `json:"smtp_from"`
	Host     *string `json:"smtp_host"`
	Password *string `json:"smtp_password"`
	Port     string  `json:"smtp_port"`
	Username *string `json:"smtp_username"`
}

type GoogleConfig struct {
	ClientID     *string `json:"google_client_id"`
	ClientSecret *string `json:"google_client_secret"`
}

type WebAuthnConfig struct {
	RPID      *string  `json:"webauthn_rp_id"`
	RPName    string   `json:"webauthn_rp_name"`
	RPOrigins []string `json:"webauthn_rp_origins"`
}

type SecurityConfig struct {
	TrustedProxyCIDRs []string `json:"trusted_proxy_cidrs"`
}

type GeneralConfig struct {
	DisableTransactionTracking bool `json:"disable_transaction_tracking"`
	DisableWealthTracking      bool `json:"disable_wealth_tracking"`
	HideOwners                 bool `json:"hide_owners"`
}

type MCPConfig struct {
	DynamicRedirectHosts []string `json:"dynamic_redirect_hosts"`
}

type LocaleConfig struct {
	Timezone string `json:"timezone"`
}

type SetupCompleteConfig struct{}
