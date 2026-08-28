package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"time"

	"tallyo/internal/middleware"

	"github.com/ory/fosite"
	fositeOAuth2 "github.com/ory/fosite/handler/oauth2"
	"github.com/ory/fosite/token/jwt"
	"github.com/samber/lo"
)

type authMethodHandler struct {
	enabled       func() bool
	disabledError string
	handle        func(http.ResponseWriter, *http.Request, string)
}

const maxAuthRequestBody = 1 << 20

func (s *Service) Routes(mux interface {
	HandleFunc(string, http.HandlerFunc)
	Get(string, http.HandlerFunc)
	Post(string, http.HandlerFunc)
}) {
	mux.HandleFunc("/auth/config", s.AuthConfig)
	oauthOnly := func(handler http.HandlerFunc) http.HandlerFunc { return s.RequireOAuth(handler).ServeHTTP }
	rateLimit := func(handler http.HandlerFunc) http.HandlerFunc {
		return rateLimited(20, 10*time.Minute, s.cfg.ClientIPResolver, handler)
	}
	mux.HandleFunc("/.well-known/oauth-authorization-server", oauthOnly(s.AuthorizationMetadata))
	mux.HandleFunc("/.well-known/oauth-protected-resource", oauthOnly(s.ProtectedResourceMetadata))
	mux.HandleFunc("/.well-known/oauth-protected-resource/mcp", oauthOnly(s.MCPProtectedResourceMetadata))
	// Return 404 so MCP clients that probe OIDC discovery get a definitive
	// "not an OIDC server" signal instead of the SPA catch-all HTML (200).
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})
	mux.Post("/register", oauthOnly(limitAuthBody(rateLimit(s.Register))))
	mux.HandleFunc("/authorize", oauthOnly(limitAuthBody(rateLimit(s.Authorize))))
	mux.Get("/consent", oauthOnly(rateLimit(s.ConsentForm)))
	mux.Post("/consent", oauthOnly(limitAuthBody(rateLimit(s.Consent))))
	mux.HandleFunc("/auth/google", rateLimit(s.GoogleLogin))
	mux.HandleFunc("/auth/google/callback", rateLimit(s.GoogleCallback))
}

func limitAuthBody(handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthRequestBody)
		handler(w, r)
	}
}

func rateLimited(
	requestLimit int,
	windowLength time.Duration,
	resolver middleware.ClientIPResolver,
	handler http.HandlerFunc,
) http.HandlerFunc {
	return middleware.RateLimitWithClientIP(requestLimit, windowLength, resolver)(handler).ServeHTTP
}

func (s *Service) Register(w http.ResponseWriter, r *http.Request) {
	dcr := s.dcrSettings()
	if !dcr.Enabled {
		http.NotFound(w, r)
		return
	}
	var req struct {
		ClientName              string   `json:"client_name"`
		RedirectURIs            []string `json:"redirect_uris"`
		GrantTypes              []string `json:"grant_types"`
		ResponseTypes           []string `json:"response_types"`
		ApplicationType         string   `json:"application_type"`
		TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid registration", http.StatusBadRequest)
		return
	}
	unsupportedAuthMethod := req.TokenEndpointAuthMethod != "" && req.TokenEndpointAuthMethod != "none"
	if len(req.RedirectURIs) == 0 || unsupportedAuthMethod {
		http.Error(w, "invalid registration", http.StatusBadRequest)
		return
	}
	for _, uri := range req.RedirectURIs {
		if !isAllowedDynamicRedirectURI(uri, s.IssuerURL(), dcr.DynamicRedirectHosts) {
			http.Error(
				w,
				"redirect_uri must target the issuer host, an allowed host, localhost, or a private app scheme",
				http.StatusBadRequest,
			)
			return
		}
	}
	clientID, err := randomToken(18)
	if HTTPFail(w, err, http.StatusInternalServerError, "generate client") {
		return
	}
	client := Client{
		ID:              clientID,
		RedirectURIs:    req.RedirectURIs,
		GrantTypes:      lo.CoalesceSliceOrEmpty(req.GrantTypes, []string{"authorization_code", "refresh_token"}),
		ResponseTypes:   lo.CoalesceSliceOrEmpty(req.ResponseTypes, []string{"code"}),
		Scopes:          ClientAllowedScopes,
		ApplicationType: lo.CoalesceOrEmpty(req.ApplicationType, "native"),
		ClientName:      req.ClientName,
		Public:          true,
	}
	if err := s.store.SaveClient(r.Context(), client); err != nil {
		http.Error(w, "save client", http.StatusInternalServerError)
		return
	}
	resp := map[string]any{
		"client_id":                  clientID,
		"client_id_issued_at":        time.Now().Unix(),
		"token_endpoint_auth_method": "none",
		"grant_types":                client.GrantTypes,
		"response_types":             client.ResponseTypes,
		"redirect_uris":              client.RedirectURIs,
	}
	if client.ClientName != "" {
		resp["client_name"] = client.ClientName
	}
	writePublicJSON(w, resp)
}

func (s *Service) Authorize(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if sessionID := q.Get("session_id"); sessionID != "" {
		s.completeAuthorize(w, r, sessionID, false)
		return
	}

	// Use Fosite to validate the OAuth authorize request
	provider := s.oauthProvider()
	authorizeRequest, err := provider.NewAuthorizeRequest(r.Context(), r)
	if err != nil {
		provider.WriteAuthorizeError(r.Context(), w, authorizeRequest, err)
		return
	}

	// Store validated params and redirect to Google for authentication
	sessionID, err := randomToken(16)
	if HTTPFail(w, err, http.StatusInternalServerError, "generate state") {
		return
	}
	callbackState, err := randomToken(24)
	if HTTPFail(w, err, http.StatusInternalServerError, "generate state") {
		return
	}

	redirectURI := ""
	if u := authorizeRequest.GetRedirectURI(); u != nil {
		redirectURI = u.String()
	}

	scopes := authorizeRequest.GetRequestedScopes()
	if len(scopes) == 0 {
		scopes = []string{"read", "write"}
	}

	session := LoginSession{
		ID:                  sessionID,
		ClientID:            authorizeRequest.GetClient().GetID(),
		RedirectURI:         redirectURI,
		State:               authorizeRequest.GetState(),
		CodeChallenge:       q.Get("code_challenge"),
		CodeChallengeMethod: "S256",
		Scopes:              scopes,
		CallbackState:       callbackState,
		ExpiresAt:           time.Now().Add(10 * time.Minute),
	}
	if err := s.store.CreateLoginSession(r.Context(), session); err != nil {
		http.Error(w, "save login session", http.StatusInternalServerError)
		return
	}
	authMethod := q.Get("auth_method")
	if method, ok := s.authMethodHandlers()[authMethod]; ok {
		if !method.enabled() {
			http.Error(w, method.disabledError, http.StatusBadRequest)
			return
		}
		method.handle(w, r, sessionID)
		return
	}
	if authMethod != "" {
		http.Error(w, "unsupported auth method", http.StatusBadRequest)
		return
	}
	http.Redirect(w, r, s.IssuerURL()+"/auth/login?login_session="+url.QueryEscape(sessionID), http.StatusFound)
}

func (s *Service) authMethodHandlers() map[string]authMethodHandler {
	redirect := func(path string) func(http.ResponseWriter, *http.Request, string) {
		return func(w http.ResponseWriter, r *http.Request, sessionID string) {
			http.Redirect(w, r, s.IssuerURL()+path+"?login_session="+url.QueryEscape(sessionID), http.StatusFound)
		}
	}
	webAuthn := func(w http.ResponseWriter, _ *http.Request, sessionID string) {
		writeJSON(w, map[string]string{"login_session_id": sessionID})
	}
	return map[string]authMethodHandler{
		"email":    {enabled: s.EmailEnabled, disabledError: "email auth is not enabled", handle: redirect("/auth/email-challenge")},
		"google":   {enabled: s.GoogleEnabled, disabledError: "google auth is not enabled", handle: redirect("/auth/google")},
		"webauthn": {enabled: s.PassKeyEnabled, disabledError: "webauthn is not enabled", handle: webAuthn},
	}
}

func (s *Service) loginSessionClient(w http.ResponseWriter, r *http.Request, sessionID string) (LoginSession, Client, bool) {
	session, err := s.store.LoginSessionByID(r.Context(), sessionID)
	if err != nil || !session.Authenticated || session.ExpiresAt.Before(time.Now()) {
		http.Error(w, "login session expired", http.StatusBadRequest)
		return LoginSession{}, Client{}, false
	}
	client, err := s.store.Client(r.Context(), session.ClientID)
	return session, client, !HTTPFail(w, err, http.StatusInternalServerError, "client not found")
}

func (s *Service) completeAuthorize(w http.ResponseWriter, r *http.Request, sessionID string, consentApproved bool) {
	session, client, ok := s.loginSessionClient(w, r, sessionID)
	if !ok {
		return
	}
	// Reconstruct Fosite AuthorizeRequest from stored session
	role, err := s.roleForSession(r.Context(), session)
	if err != nil {
		s.cfg.Log.Error("load authorize user role", "subject", session.Subject, "error", err)
		http.Error(w, "load user role", http.StatusInternalServerError)
		return
	}
	scopes := GrantedScopesForRole(role, session.Scopes)
	if !client.Preseeded && !consentApproved {
		s.renderConsent(w, session, client, scopes)
		return
	}

	redirectURI, _ := url.Parse(session.RedirectURI)

	fositeSession := fositeOAuth2.JWTSession{
		JWTClaims: &jwt.JWTClaims{Subject: session.Subject},
		JWTHeader: &jwt.Headers{},
		Subject:   session.Subject,
	}

	authorizeRequest := fosite.NewAuthorizeRequest()
	authorizeRequest.Client = client
	authorizeRequest.State = session.State
	authorizeRequest.RedirectURI = redirectURI
	authorizeRequest.ResponseTypes = fosite.Arguments{"code"}
	authorizeRequest.RequestedScope = scopes
	authorizeRequest.GrantedScope = scopes
	authorizeRequest.GrantedAudience = fosite.Arguments{s.IssuerURL()}
	authorizeRequest.Session = &fositeSession
	authorizeRequest.Form = url.Values{
		"redirect_uri":          {session.RedirectURI},
		"code_challenge":        {session.CodeChallenge},
		"code_challenge_method": {session.CodeChallengeMethod},
	}

	if err := s.store.ClaimAuthenticatedLoginSession(r.Context(), session.ID); err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "login session expired", http.StatusBadRequest)
			return
		}
		http.Error(w, "claim login session", http.StatusInternalServerError)
		return
	}

	provider := s.oauthProvider()
	resp, err := provider.NewAuthorizeResponse(r.Context(), authorizeRequest, &fositeSession)
	if err != nil {
		provider.WriteAuthorizeError(r.Context(), w, authorizeRequest, err)
		return
	}

	// If the client requested JSON (passkey flow), return the callback URL
	// and auth code directly so the SPA can complete the token exchange in JS
	// without following a 303 redirect.
	if r.Header.Get("Accept") == "application/json" {
		callback, _ := url.Parse(session.RedirectURI)
		q := callback.Query()
		q.Set("code", resp.GetCode())
		if session.State != "" {
			q.Set("state", session.State)
		}
		callback.RawQuery = q.Encode()
		writeJSON(w, map[string]string{"callback_url": callback.String()})
		return
	}

	provider.WriteAuthorizeResponse(r.Context(), w, authorizeRequest, resp)
}
