package auth

import (
	"context"
	"database/sql"
	"log/slog"
	"sync"
	"time"

	webauthnlib "github.com/go-webauthn/webauthn/webauthn"
	"github.com/ory/fosite"
	"github.com/samber/lo"

	"tallyo/internal/auth/authtypes"
	"tallyo/internal/middleware"
)

const FrontendClientID = "tallyo-web"

var ErrNotFound = sql.ErrNoRows

// DCRSettings controls OAuth Dynamic Client Registration (POST /register),
// which is only meaningful for MCP clients. Sourced live from the MCP
// configuration section.
type DCRSettings struct {
	Enabled              bool
	DynamicRedirectHosts []string
}

type MasterPasswordStatus string

const (
	MasterPasswordDisabled       MasterPasswordStatus = "DISABLED"
	MasterPasswordEnabled        MasterPasswordStatus = "ENABLED"
	MasterPasswordEnvVarOverride MasterPasswordStatus = "ENV_VAR_OVERRIDE"
)

type Config struct {
	IssuerURL             string
	OAuthEnabled          bool
	GoogleAuthnEnabled    bool
	GoogleClientID        string
	GoogleClientSecret    string
	EmailCodeAuthnEnabled bool
	PassKeyAuthnEnabled   bool
	FrontendRedirectURIs  []string
	MasterPassword        string
	MasterPasswordFromEnv bool
	DisableAllAuth        bool
	AccessTokenLifetime   time.Duration
	RefreshTokenLifetime  time.Duration
	DevCORSAllowedOrigins []string
	DCRSettings           func() DCRSettings
	WebAuthnRPID          string
	WebAuthnRPDisplayName string
	WebAuthnRPOrigins     []string
	ClientIPResolver      middleware.ClientIPResolver
	Log                   *slog.Logger
	SetupComplete         func() bool
	Timezone              func() string

	SMTPHost     string
	SMTPPort     string
	SMTPFrom     string
	SMTPUsername string
	SMTPPassword string
}

type Service struct {
	store        *Store
	fositeStore  *FositeStore
	provider     fosite.OAuth2Provider
	cfg          Config
	devOrigins   map[string]struct{}
	timezones    *TimezoneCache
	signingKey   *SigningKey
	dynMu        sync.RWMutex
	tokenMu      sync.Mutex
	googleConfig googleOAuthConfig
	googleEmail  func(context.Context, string) (string, error)
	emailSender  EmailSender
	webauthn     *webauthnlib.WebAuthn
}

type Store struct {
	db authPersistence
}

type Client struct {
	authtypes.OAuthClient
	Audience []string
}

func (c Client) GetID() string             { return c.ID }
func (c Client) GetHashedSecret() []byte   { return nil }
func (c Client) GetRedirectURIs() []string { return c.RedirectURIs }
func (c Client) GetGrantTypes() fosite.Arguments {
	return lo.Ternary(len(c.GrantTypes) == 0, fosite.Arguments{"authorization_code"}, fosite.Arguments(c.GrantTypes))
}
func (c Client) GetResponseTypes() fosite.Arguments {
	return lo.Ternary(len(c.ResponseTypes) == 0, fosite.Arguments{"code"}, fosite.Arguments(c.ResponseTypes))
}
func (c Client) GetScopes() fosite.Arguments   { return fosite.Arguments(c.Scopes) }
func (c Client) IsPublic() bool                { return c.Public }
func (c Client) GetAudience() fosite.Arguments { return fosite.Arguments(c.Audience) }

type OAuthClient = authtypes.OAuthClient
type SigningKeyPEM = authtypes.SigningKeyPEM
type LoginSession = authtypes.LoginSession
type WebAuthnCredential = authtypes.WebAuthnCredential
type WebAuthnRegistration = authtypes.WebAuthnRegistration
type EmailOTPUpdate = authtypes.EmailOTPUpdate
type AuthCode = authtypes.AuthCode
type OAuthToken = authtypes.OAuthToken

func (c Config) masterPasswordStatus() MasterPasswordStatus {
	switch {
	case c.MasterPassword == "":
		return MasterPasswordDisabled
	case c.MasterPasswordFromEnv:
		return MasterPasswordEnvVarOverride
	default:
		return MasterPasswordEnabled
	}
}
