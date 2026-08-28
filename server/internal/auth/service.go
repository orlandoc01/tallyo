package auth

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	webauthnlib "github.com/go-webauthn/webauthn/webauthn"
	"github.com/ory/fosite"
	"github.com/ory/fosite/compose"
	"github.com/ory/fosite/token/jwt"
	"github.com/samber/lo"

	"tallyo/internal/apierror"
	u "tallyo/internal/utils"
)

func New(ctx context.Context, cfg Config, db authPersistence) (*Service, error) {
	if cfg.DCRSettings == nil {
		cfg.DCRSettings = func() DCRSettings { return DCRSettings{} }
	}
	if cfg.SetupComplete == nil {
		cfg.SetupComplete = func() bool { return true }
	}
	if err := normalizeAuthConfig(&cfg); err != nil {
		return nil, err
	}
	warnIfAuthDisabled(cfg)
	var webAuthn *webauthnlib.WebAuthn
	if cfg.OAuthEnabled && cfg.PassKeyAuthnEnabled {
		var err error
		webAuthn, err = newWebAuthn(&cfg)
		if err != nil {
			return nil, err
		}
	}
	store := NewStore(db)
	key, err := store.LoadOrCreateSigningKey(ctx)
	if err != nil {
		return nil, err
	}
	if err := store.UpsertFrontendClient(ctx, cfg.FrontendRedirectURIs); err != nil {
		return nil, err
	}
	fositeStore := NewFositeStore(store, cfg.IssuerURL)

	var googleCfg googleOAuthConfig
	if cfg.OAuthEnabled && cfg.GoogleAuthnEnabled {
		googleCfg = newGoogleConfig(cfg)
	}
	service := &Service{
		store:        store,
		fositeStore:  fositeStore,
		provider:     newOAuthProvider(cfg, fositeStore, key),
		cfg:          cfg,
		devOrigins:   normalizeOriginSet(cfg.DevCORSAllowedOrigins),
		timezones:    NewTimezoneCache(timezoneFromConfig(cfg)),
		signingKey:   key,
		googleConfig: googleCfg,
		googleEmail:  googleEmail,
		emailSender:  newEmailSender(cfg, cfg.Log),
		webauthn:     webAuthn,
	}
	return service, nil
}

func normalizeAuthConfig(cfg *Config) error {
	cfg.IssuerURL = strings.TrimRight(cfg.IssuerURL, "/")
	if cfg.OAuthEnabled && cfg.IssuerURL == "" {
		return fmt.Errorf("oauth issuer url is required")
	}
	if cfg.AccessTokenLifetime == 0 {
		cfg.AccessTokenLifetime = 15 * time.Minute
	}
	if cfg.RefreshTokenLifetime == 0 {
		cfg.RefreshTokenLifetime = 168 * time.Hour
	}
	return nil
}

func warnIfAuthDisabled(cfg Config) {
	if cfg.DisableAllAuth {
		cfg.Log.Warn(
			"all authentication is disabled; do not expose this server outside localhost or a trusted network",
			"issuer",
			cfg.IssuerURL,
		)
	}
}

func newOAuthProvider(cfg Config, store *FositeStore, key *SigningKey) fosite.OAuth2Provider {
	keyGetter := func(_ context.Context) (any, error) { return key.Private, nil }
	fositeConfig := &fosite.Config{
		AccessTokenIssuer:           cfg.IssuerURL,
		AccessTokenLifespan:         cfg.AccessTokenLifetime,
		RefreshTokenLifespan:        cfg.RefreshTokenLifetime,
		AuthorizeCodeLifespan:       10 * time.Minute,
		TokenEntropy:                32,
		ScopeStrategy:               fosite.HierarchicScopeStrategy,
		AudienceMatchingStrategy:    fosite.DefaultAudienceMatchingStrategy,
		SendDebugMessagesToClients:  false,
		RefreshTokenScopes:          ClientAllowedScopes,
		EnforcePKCE:                 true,
		EnforcePKCEForPublicClients: true,
		JWTScopeClaimKey:            jwt.JWTScopeFieldString,
	}
	jwtStrategy := compose.NewOAuth2JWTStrategy(keyGetter, &plainTokenStrategy{}, fositeConfig)
	strategy := &compose.CommonStrategy{
		CoreStrategy: jwtStrategy,
		Signer:       &jwt.DefaultSigner{GetPrivateKey: keyGetter},
	}
	return compose.Compose(
		fositeConfig,
		store,
		strategy,
		compose.OAuth2AuthorizeExplicitFactory,
		compose.OAuth2PKCEFactory,
		compose.OAuth2RefreshTokenGrantFactory,
		compose.OAuth2TokenIntrospectionFactory,
	)
}

func (s *Service) RunCleanup(ctx context.Context) {
	u.RunPeriodic(ctx, 10*time.Minute, func(ctx context.Context) {
		if err := s.store.CleanupExpired(ctx); err != nil {
			s.cfg.Log.Error("auth cleanup failed", "error", err)
		}
	})
}

func (s *Service) SendInvitation(ctx context.Context, email string, role string, invitedBy string) error {
	if !s.OAuthEnabled() {
		return nil
	}
	magicLink, _, err := s.buildInviteSession(ctx, email, role, 24*time.Hour, "")
	if err != nil {
		return err
	}

	subject := "You're invited to Tallyo"
	body := fmt.Sprintf(
		"You've been invited to Tallyo by %s.\n\n"+
			"Click the link below to sign in — it expires in 24 hours:\n"+
			"%s\n\n"+
			"If you didn't expect this invitation, you can safely ignore this email.",
		invitedBy, magicLink,
	)
	if err := s.GetEmailSender().Send(ctx, email, subject, body); err != nil {
		return fmt.Errorf("send invitation email: %w", err)
	}
	return nil
}

func (s *Service) CreateInviteLink(ctx context.Context, email string, role string) (string, time.Time, error) {
	if !s.OAuthEnabled() {
		return "", time.Time{}, apierror.Publicf("invitations are not configured")
	}
	return s.buildInviteSession(ctx, email, role, 15*time.Minute, "passkey")
}

func (s *Service) buildInviteSession(ctx context.Context, email string, role string, ttl time.Duration, purpose string) (string, time.Time, error) {
	// Generate PKCE pair for the magic-link login flow
	verifier, err := randomToken(32)
	if err != nil {
		return "", time.Time{}, err
	}
	challenge := codeChallenge(verifier)

	sessionID, err := randomToken(16)
	if err != nil {
		return "", time.Time{}, err
	}
	callbackState, err := randomToken(24)
	if err != nil {
		return "", time.Time{}, err
	}

	expiresAt := time.Now().UTC().Add(ttl)

	cfg := s.config()
	redirectURI := lo.FirstOrEmpty(cfg.FrontendRedirectURIs)

	session := LoginSession{
		ID:                  sessionID,
		ClientID:            FrontendClientID,
		RedirectURI:         redirectURI,
		CodeChallenge:       challenge,
		CodeChallengeMethod: "S256",
		Scopes:              ScopesForRole(Role(role)),
		CallbackState:       callbackState,
		ExpiresAt:           expiresAt,
		Purpose:             purpose,
	}
	if err := s.store.CreateLoginSession(ctx, session); err != nil {
		return "", time.Time{}, fmt.Errorf("create login session: %w", err)
	}

	magicToken, err := randomToken(32)
	if err != nil {
		return "", time.Time{}, err
	}
	magicHash := tokenSignature(magicToken)
	if err := s.store.SaveEmailOTP(ctx, sessionID, email, "", magicHash, verifier, expiresAt); err != nil {
		return "", time.Time{}, fmt.Errorf("save magic token: %w", err)
	}

	values := url.Values{}
	values.Set("token", magicToken)
	values.Set("session_id", sessionID)
	values.Set("email", email)
	if purpose == "passkey" {
		values.Set("onboarding", "passkey")
	}
	return cfg.IssuerURL + "/auth/email/magic?" + values.Encode(), expiresAt, nil
}

func normalizeOriginSet(values []string) map[string]struct{} {
	toOrigin := func(value string) (string, struct{}, bool) {
		value = strings.TrimRight(strings.TrimSpace(value), "/")
		if value != "" {
			return value, struct{}{}, true
		}
		return "", struct{}{}, false
	}
	return lo.FilterSliceToMap(values, toOrigin)
}
