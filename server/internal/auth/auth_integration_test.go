package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"tallyo/internal/admin"
	admindb "tallyo/internal/admin/db"
	"tallyo/internal/auth/authdb"
	"tallyo/internal/database"
	"tallyo/internal/database/dbtest"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"
	"tallyo/internal/utils/nooplog"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/oauth2"
	"tallyo/internal/utils/must"
)

type fakeGoogle struct{}

type fakeRoutes map[string]http.HandlerFunc

const testOAuthVerifier = "aB3x9kLmPqRsTuVwXyZ1aB3x9kLmPqRsTuVwXyZ1aB3x9kLmPqRsTuVwXyZ1" // gitleaks:allow (PKCE test fixture, not a secret)

func (f fakeRoutes) HandleFunc(pattern string, handler http.HandlerFunc) {
	f[pattern] = handler
}

func (f fakeRoutes) Get(pattern string, handler http.HandlerFunc)  { f.HandleFunc(pattern, handler) }
func (f fakeRoutes) Post(pattern string, handler http.HandlerFunc) { f.HandleFunc(pattern, handler) }

func callHandler(h http.HandlerFunc, method, target string, body io.Reader) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(method, target, body))
	return rec
}

func assertStatus(t *testing.T, rec *httptest.ResponseRecorder, want int, label string) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("%s status = %d body = %s", label, rec.Code, rec.Body.String())
	}
}

func decodeJSON[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var result T
	must.NoErr(t, json.Unmarshal(rec.Body.Bytes(), &result))
	return result
}

func mustAddUser(t *testing.T, service *admin.Service, email, inviter, role string) *model.User {
	t.Helper()
	user, err := service.AddUser(context.Background(), email, inviter, role)
	must.NoErr(t, err)
	return user
}

func mustUserIDByEmail(t *testing.T, store *Store, email string) int64 {
	t.Helper()
	userID, err := store.db.UserIDByEmail(context.Background(), email)
	must.NoErr(t, err)
	return userID
}

func (fakeGoogle) AuthCodeURL(state string, opts ...oauth2.AuthCodeOption) string {
	return "https://accounts.example/auth?state=" + url.QueryEscape(state)
}

func (fakeGoogle) Exchange(ctx context.Context, code string, opts ...oauth2.AuthCodeOption) (*oauth2.Token, error) {
	return &oauth2.Token{AccessToken: "google-access"}, nil
}

func seedLoginSession(t *testing.T, service *Service, id, verifier string, opts ...func(*LoginSession)) LoginSession {
	t.Helper()
	session := LoginSession{
		ID:                  id,
		ClientID:            FrontendClientID,
		RedirectURI:         "http://localhost:3000/auth/callback",
		State:               "client-state",
		CodeChallenge:       codeChallenge(verifier),
		CodeChallengeMethod: "S256",
		Scopes:              []string{"read", "write"},
		CallbackState:       "google-state",
		ExpiresAt:           time.Now().Add(10 * time.Minute),
	}
	for _, opt := range opts {
		opt(&session)
	}
	must.NoErr(t, service.store.CreateLoginSession(context.Background(), session))
	return session
}

func withLoginClient(id, redirectURI string) func(*LoginSession) {
	return func(session *LoginSession) {
		session.ClientID = id
		session.RedirectURI = redirectURI
	}
}

func withLoginScopes(scopes ...string) func(*LoginSession) {
	return func(session *LoginSession) { session.Scopes = scopes }
}

func withLoginState(state, callbackState string) func(*LoginSession) {
	return func(session *LoginSession) {
		session.State = state
		session.CallbackState = callbackState
	}
}

func minimalLoginSession(callbackState string) func(*LoginSession) {
	return func(session *LoginSession) {
		session.RedirectURI = ""
		session.State = ""
		session.CodeChallenge = ""
		session.CodeChallengeMethod = ""
		session.Scopes = nil
		session.CallbackState = callbackState
	}
}

func TestOAuthCodeAndRefreshFlow(t *testing.T) {
	service := newTestService(t)
	service.googleEmail = func(context.Context, string) (string, error) { return "Alex@example.com", nil }

	verifier := testOAuthVerifier
	authorizeURL := "/authorize?response_type=code&client_id=tallyo-web&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback&state=client-state&scope=read+write&code_challenge=" + codeChallenge(verifier) + "&code_challenge_method=S256&auth_method=google"
	rec := callHandler(service.Authorize, http.MethodGet, authorizeURL, nil)
	assertStatus(t, rec, http.StatusFound, "authorize")
	loginURL, _ := url.Parse(rec.Header().Get("Location"))

	rec = callHandler(service.GoogleLogin, http.MethodGet, loginURL.String(), nil)
	assertStatus(t, rec, http.StatusFound, "google login")
	googleURL, _ := url.Parse(rec.Header().Get("Location"))

	callback := "/auth/google/callback?state=" + url.QueryEscape(googleURL.Query().Get("state")) + "&code=google-code"
	rec = callHandler(service.GoogleCallback, http.MethodGet, callback, nil)
	assertStatus(t, rec, http.StatusFound, "google callback")
	resumeURL, _ := url.Parse(rec.Header().Get("Location"))

	rec = callHandler(service.Authorize, http.MethodGet, resumeURL.String(), nil)
	if rec.Code != http.StatusFound && rec.Code != http.StatusSeeOther {
		t.Fatalf("authorize resume status = %d", rec.Code)
	}
	clientURL, _ := url.Parse(rec.Header().Get("Location"))
	if clientURL.Query().Get("state") != "client-state" || clientURL.Query().Get("code") == "" {
		t.Fatalf("client redirect = %s", clientURL.String())
	}

	tokens := tokenRequest(t, service, frontendAuthorizationCodeFields(clientURL.Query().Get("code"), verifier))
	claims, err := service.verifyAccessToken(tokens["access_token"].(string))
	if err != nil || claims.Subject != "alex@example.com" || claims.Locale.Timezone != "America/New_York" {
		t.Fatalf("verify access token subject=%q timezone=%q err=%v", claims.Subject, claims.Locale.Timezone, err)
	}
	service.SetTimezone("America/Los_Angeles")

	refreshed := tokenRequest(t, service, refreshTokenFields(tokens["refresh_token"].(string)))
	refreshedClaims, err := service.verifyAccessToken(refreshed["access_token"].(string))
	if err != nil || refreshedClaims.Locale.Timezone != "America/Los_Angeles" {
		t.Fatalf("refreshed access token timezone=%q err=%v", refreshedClaims.Locale.Timezone, err)
	}
}

func TestAuthorizationCodeReplayRevokesIssuedTokenChain(t *testing.T) {
	service := newTestService(t)
	verifier, code := authorizeCodeFixture(t, service)

	tokens := tokenRequest(t, service, frontendAuthorizationCodeFields(code, verifier))
	refreshed := tokenRequest(t, service, refreshTokenFields(tokens["refresh_token"].(string)))

	replay := tokenResponse(service, frontendAuthorizationCodeFields(code, verifier))
	assertStatus(t, replay, http.StatusBadRequest, "code replay")
	assertRefreshInactive(t, service, tokens["refresh_token"].(string))
	assertRefreshInactive(t, service, refreshed["refresh_token"].(string))
	assertAccessTokenMissing(t, service, tokens["access_token"].(string))
	assertAccessTokenMissing(t, service, refreshed["access_token"].(string))
}

func TestConcurrentAuthorizationCodeExchange(t *testing.T) {
	service := newTestService(t)
	verifier, code := authorizeCodeFixture(t, service)
	fields := frontendAuthorizationCodeFields(code, verifier)

	success := assertOneConcurrentTokenSuccess(t, concurrentTokenResponses(service, fields))
	tokens := decodeJSON[map[string]any](t, success)
	if _, err := service.verifyAccessToken(tokens["access_token"].(string)); err != nil {
		t.Fatalf("verify winning access token: %v", err)
	}
}

func TestConcurrentAuthorizeCompletionIssuesOneCode(t *testing.T) {
	rawdb := dbtest.Open(t)
	authStore := authdb.New(rawdb)
	seedAdminUser(t, rawdb)
	blocked := &blockingAuthCodeStore{
		authPersistence: authStore,
		started:         make(chan struct{}),
		release:         make(chan struct{}),
	}
	service := newTestAuthService(t, blocked)
	sessionID := "concurrent-authorize-session"
	seedLoginSession(t, service, sessionID, testOAuthVerifier)
	must.NoErr(t, service.store.MarkLoginSessionAuthenticated(context.Background(), sessionID, "alex@example.com"))

	responses := make(chan *httptest.ResponseRecorder, 2)
	go func() {
		responses <- callHandler(service.Authorize, http.MethodGet, "/authorize?session_id="+sessionID, nil)
	}()
	<-blocked.started
	go func() {
		responses <- callHandler(service.Authorize, http.MethodGet, "/authorize?session_id="+sessionID, nil)
	}()
	second := <-responses
	close(blocked.release)
	first := <-responses

	if codes := authorizeResponseCodes(first, second); len(codes) != 1 {
		t.Fatalf("authorize completion codes = %v, statuses = [%d %d], bodies = [%q %q]", codes, first.Code, second.Code, first.Body.String(), second.Body.String())
	}
}

func TestRefreshTokenReuseRevokesRotatedChain(t *testing.T) {
	service := newTestService(t)
	verifier, code := authorizeCodeFixture(t, service)
	tokens := tokenRequest(t, service, frontendAuthorizationCodeFields(code, verifier))
	refreshed := tokenRequest(t, service, refreshTokenFields(tokens["refresh_token"].(string)))

	reuse := tokenResponse(service, refreshTokenFields(tokens["refresh_token"].(string)))
	assertStatus(t, reuse, http.StatusBadRequest, "refresh reuse")
	assertRefreshInactive(t, service, refreshed["refresh_token"].(string))
	assertAccessTokenMissing(t, service, refreshed["access_token"].(string))
}

func TestConcurrentRefreshTokenExchange(t *testing.T) {
	service := newTestService(t)
	verifier, code := authorizeCodeFixture(t, service)
	tokens := tokenRequest(t, service, frontendAuthorizationCodeFields(code, verifier))
	fields := refreshTokenFields(tokens["refresh_token"].(string))

	assertOneConcurrentTokenSuccess(t, concurrentTokenResponses(service, fields))
	assertRefreshInactive(t, service, tokens["refresh_token"].(string))
}

func TestRefreshInsertionFailureRollsBack(t *testing.T) {
	rawdb := dbtest.Open(t)
	seedAdminUser(t, rawdb)
	store := &failingRefreshStore{authPersistence: authdb.New(rawdb)}
	service := newTestAuthService(t, store)
	verifier, code := authorizeCodeFixture(t, service)
	tokens := tokenRequest(t, service, frontendAuthorizationCodeFields(code, verifier))
	fields := refreshTokenFields(tokens["refresh_token"].(string))
	var accessCount int
	must.NoErr(t, rawdb.SQL().QueryRowContext(context.Background(), "SELECT COUNT(*) FROM oauth_access_tokens").Scan(&accessCount))

	store.fail = true
	failed := tokenResponse(service, fields)
	assertStatus(t, failed, http.StatusInternalServerError, "refresh insertion failure")
	store.fail = false
	var accessCountAfter int
	must.NoErr(t, rawdb.SQL().QueryRowContext(context.Background(), "SELECT COUNT(*) FROM oauth_access_tokens").Scan(&accessCountAfter))
	if accessCountAfter != accessCount {
		t.Fatalf("access token count after failure = %d, want %d", accessCountAfter, accessCount)
	}
	old, err := service.store.db.RefreshToken(
		context.Background(),
		tokenSignature(tokens["refresh_token"].(string)),
		time.Now().UTC(),
		true,
	)
	if err != nil || !old.Active {
		t.Fatalf("original refresh token active=%t err=%v", old.Active, err)
	}
	refreshed := tokenRequest(t, service, fields)
	if refreshed["refresh_token"] == tokens["refresh_token"] {
		t.Fatalf("refresh token was not rotated after rollback retry")
	}
}

func TestGoogleCallbackDisallowedEmailReturnsGenericError(t *testing.T) {
	service := newTestService(t)
	service.googleEmail = func(context.Context, string) (string, error) { return "unknown@example.com", nil }

	session := seedLoginSession(t, service, "google-denied-session", "", minimalLoginSession("google-denied-state"))

	callback := "/auth/google/callback?state=" + url.QueryEscape(session.CallbackState) + "&code=google-code"
	rec := callHandler(service.GoogleCallback, http.MethodGet, callback, nil)
	assertStatus(t, rec, http.StatusBadRequest, "disallowed google callback")
	if strings.Contains(rec.Body.String(), "not allowed") {
		t.Fatalf("response disclosed allowlist status: %s", rec.Body.String())
	}

	stored, err := service.store.LoginSessionByID(context.Background(), session.ID)
	must.NoErr(t, err)
	if stored.Authenticated {
		t.Fatalf("disallowed google account authenticated session")
	}
}

func TestAuthorizeWithoutAuthMethodRedirectsToLoginPage(t *testing.T) {
	service := newTestService(t)
	authorizeURL := "/authorize?response_type=code&client_id=tallyo-web&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback&state=client-state&scope=read+write&code_challenge=" + codeChallenge("verifier") + "&code_challenge_method=S256"

	rec := callHandler(service.Authorize, http.MethodGet, authorizeURL, nil)
	assertStatus(t, rec, http.StatusFound, "authorize")
	loginURL, err := url.Parse(rec.Header().Get("Location"))
	if err != nil || loginURL.Path != "/auth/login" || loginURL.Query().Get("login_session") == "" {
		t.Fatalf("login redirect = %q err=%v", rec.Header().Get("Location"), err)
	}
}

func TestDynamicClientRequiresConsentAndGrantsRequestedScopes(t *testing.T) {
	service, adminSvc := newTestAuthAndAdmin(t)
	ctx := context.Background()
	if _, err := adminSvc.AddUser(ctx, "writer@example.com", "alex@example.com", string(RoleWriter)); err != nil {
		t.Fatalf("add writer: %v", err)
	}
	verifier := testOAuthVerifier
	redirectURI := "https://client.example.com/callback"
	clientID := "dynamic-client"
	must.NoErr(t, service.store.SaveClient(ctx, Client{OAuthClient: OAuthClient{
		ID:              clientID,
		RedirectURIs:    []string{redirectURI},
		GrantTypes:      []string{"authorization_code", "refresh_token"},
		ResponseTypes:   []string{"code"},
		Scopes:          ClientAllowedScopes,
		ApplicationType: "web",
		ClientName:      "Dynamic Client",
		Public:          true,
	}}))
	session := seedLoginSession(
		t,
		service,
		"dynamic-consent-session",
		verifier,
		withLoginClient(clientID, redirectURI),
		withLoginScopes(ScopeReadTransactions, ScopeWriteUsers),
		withLoginState("client-state", "dynamic-google-state"),
	)
	must.NoErr(t, service.store.MarkLoginSessionAuthenticated(ctx, session.ID, "writer@example.com"))

	rec := callHandler(service.Authorize, http.MethodGet, "/authorize?session_id="+session.ID, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Authorize Dynamic Client") {
		t.Fatalf("consent response status=%d body=%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Location") != "" {
		t.Fatalf("dynamic client bypassed consent with redirect %q", rec.Header().Get("Location"))
	}

	form := strings.NewReader("session_id=" + url.QueryEscape(session.ID) + "&consent=allow")
	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/consent", form)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	service.Consent(rec, req)
	if rec.Code != http.StatusFound && rec.Code != http.StatusSeeOther {
		t.Fatalf("consent status=%d body=%s", rec.Code, rec.Body.String())
	}
	clientURL, _ := url.Parse(rec.Header().Get("Location"))
	if clientURL.Query().Get("code") == "" {
		t.Fatalf("missing authorization code in redirect %s", clientURL.String())
	}

	tokens := tokenRequest(t, service, map[string]string{
		"grant_type":    "authorization_code",
		"code":          clientURL.Query().Get("code"),
		"code_verifier": verifier,
		"client_id":     clientID,
		"redirect_uri":  redirectURI,
	})
	claims, err := service.verifyAccessToken(tokens["access_token"].(string))
	must.NoErr(t, err)
	granted := strings.Fields(claims.Scope)
	if !slices.Contains(granted, ScopeReadTransactions) {
		t.Fatalf("missing requested read scope in %v", granted)
	}
	if slices.Contains(granted, ScopeWriteUsers) {
		t.Fatalf("granted admin-only write users scope: %v", granted)
	}
}

func TestAuthorizeRoleLookupFailureFailsClosed(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	missingSubject := "missing@example.com"
	verifier := testOAuthVerifier

	preseededSession := seedLoginSession(
		t,
		service,
		"missing-role-preseeded",
		verifier,
		withLoginScopes(ScopeReadTransactions),
		withLoginState("", "missing-role-preseeded-google-state"),
	)
	must.NoErr(t, service.store.MarkLoginSessionAuthenticated(ctx, preseededSession.ID, missingSubject))

	rec := callHandler(service.Authorize, http.MethodGet, "/authorize?session_id="+preseededSession.ID, nil)
	assertStatus(t, rec, http.StatusInternalServerError, "authorize")

	dynamicClientID := "missing-role-dynamic"
	must.NoErr(t, service.store.SaveClient(ctx, Client{OAuthClient: OAuthClient{
		ID:              dynamicClientID,
		RedirectURIs:    []string{"https://client.example.com/callback"},
		GrantTypes:      []string{"authorization_code", "refresh_token"},
		ResponseTypes:   []string{"code"},
		Scopes:          ClientAllowedScopes,
		ApplicationType: "web",
		ClientName:      "Dynamic Client",
		Public:          true,
	}}))
	dynamicSession := seedLoginSession(
		t,
		service,
		"missing-role-consent",
		verifier,
		withLoginClient(dynamicClientID, "https://client.example.com/callback"),
		withLoginScopes(ScopeReadTransactions),
		withLoginState("", "missing-role-consent-google-state"),
	)
	must.NoErr(t, service.store.MarkLoginSessionAuthenticated(ctx, dynamicSession.ID, missingSubject))

	rec = callHandler(service.ConsentForm, http.MethodGet, "/consent?session_id="+dynamicSession.ID, nil)
	assertStatus(t, rec, http.StatusInternalServerError, "consent")
}

func TestCorruptPersistedRoleFailsClosed(t *testing.T) {
	rawdb := dbtest.Open(t)
	ctx := context.Background()
	seedAdminUser(t, rawdb)
	authStore := authdb.New(rawdb)
	service := newTestAuthService(t, authStore)
	_, err := admindb.New(rawdb).InsertUser(ctx, admin.InsertUserInput{Email: "writer@example.com", Role: string(RoleWriter)})
	must.NoErr(t, err)
	_, err = rawdb.SQL().ExecContext(ctx, "UPDATE users SET role = ? WHERE email = ?", "corrupt", "writer@example.com")
	must.NoErr(t, err)

	if role, err := service.store.UserRole(ctx, "writer@example.com"); err == nil || role != "" {
		t.Fatalf("UserRole corrupt = %q, %v; want error and empty role", role, err)
	}
	if scopes := GrantedScopesForRole(Role("corrupt"), []string{"read", "write"}); len(scopes) != 0 {
		t.Fatalf("corrupt role scopes = %v, want none", scopes)
	}

	session := seedLoginSession(t, service, "corrupt-role", testOAuthVerifier, withLoginScopes(ScopeReadTransactions))
	must.NoErr(t, service.store.MarkLoginSessionAuthenticated(ctx, session.ID, "writer@example.com"))
	rec := callHandler(service.Authorize, http.MethodGet, "/authorize?session_id="+session.ID, nil)
	assertStatus(t, rec, http.StatusInternalServerError, "authorize corrupt role")
}

func TestRegisterMetadataMiddlewareAndCORS(t *testing.T) {
	service := newTestService(t)
	service.cfg.DCRSettings = func() DCRSettings {
		return DCRSettings{Enabled: true, DynamicRedirectHosts: []string{"client.example.com"}}
	}
	mux := fakeRoutes{}
	service.Routes(mux)

	rec := callHandler(
		mux["/.well-known/oauth-authorization-server"],
		http.MethodGet,
		"/.well-known/oauth-authorization-server",
		nil,
	)
	if rec.Code != http.StatusOK || rec.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("metadata status=%d cors=%q", rec.Code, rec.Header().Get("Access-Control-Allow-Origin"))
	}
	for _, path := range []string{"/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"} {
		rec = callHandler(mux[path], http.MethodGet, path, nil)
		assertStatus(t, rec, http.StatusOK, "metadata "+path)
	}

	body := strings.NewReader(`{"client_name":"MCP","redirect_uris":["https://client.example.com/callback"],"token_endpoint_auth_method":"none"}`)
	rec = callHandler(service.Register, http.MethodPost, "/register", body)
	assertStatus(t, rec, http.StatusOK, "register")

	protected := service.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := Subject(r.Context()); !ok && r.Header.Get("X-API-Key") == "" {
			t.Fatalf("missing subject")
		}
		if tz := u.TimezoneFromContext(r.Context()); tz != "America/New_York" {
			t.Fatalf("timezone context = %q", tz)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	access := testAccessToken(t, service, "alex@example.com", []string{"read"})
	req := httptest.NewRequest(http.MethodGet, "/query", nil)
	req.Header.Set("Authorization", "Bearer "+access)
	rec = httptest.NewRecorder()
	protected.ServeHTTP(rec, req)
	assertStatus(t, rec, http.StatusNoContent, "bearer protected")

	rec = callHandler(protected.ServeHTTP, http.MethodGet, "/query", nil)
	assertStatus(t, rec, http.StatusUnauthorized, "unauthorized")

	req = httptest.NewRequest(http.MethodGet, "/query", nil)
	req.Header.Set("X-API-Key", "api-key")
	rec = httptest.NewRecorder()
	protected.ServeHTTP(rec, req)
	assertStatus(t, rec, http.StatusNoContent, "api key protected")

	cors := service.DevCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))
	req = httptest.NewRequest(http.MethodOptions, "/query", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	rec = httptest.NewRecorder()
	cors.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent || rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatalf("cors status=%d origin=%q", rec.Code, rec.Header().Get("Access-Control-Allow-Origin"))
	}
}

func testAccessToken(t *testing.T, service *Service, subject string, scopes []string) string {
	t.Helper()
	now := time.Now().UTC()
	tokenClaims := claims{
		Email:  subject,
		Scope:  strings.Join(scopes, " "),
		Locale: localeClaim{Timezone: service.Timezone()},
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    service.cfg.IssuerURL,
			Subject:   subject,
			Audience:  jwt.ClaimStrings{service.cfg.IssuerURL},
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        "test-access-token",
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodES256, tokenClaims).SignedString(service.signingKey.Private)
	must.NoErr(t, err)
	return token
}

func TestTokenErrorsAndCleanup(t *testing.T) {
	service := newTestService(t)

	req := httptest.NewRequest(http.MethodPost, "/token", strings.NewReader("grant_type=password"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	service.Token(rec, req)
	assertStatus(t, rec, http.StatusBadRequest, "unsupported grant")

	code := "code"
	auth := AuthCode{ClientID: FrontendClientID, Subject: "alex@example.com", RedirectURI: "http://localhost:3000/auth/callback", CodeChallenge: codeChallenge("right"), CodeChallengeMethod: "S256", ExpiresAt: time.Now().Add(time.Minute)}
	must.NoErr(t, service.store.CreateAuthCode(context.Background(), code, auth))
	req = httptest.NewRequest(http.MethodPost, "/token", strings.NewReader("grant_type=authorization_code&code=code&code_verifier=wrong&client_id=tallyo-web&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec = httptest.NewRecorder()
	service.Token(rec, req)
	assertStatus(t, rec, http.StatusBadRequest, "bad verifier")

	req = httptest.NewRequest(http.MethodPost, "/token", strings.NewReader("grant_type=refresh_token&refresh_token=bad&client_id=tallyo-web"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec = httptest.NewRecorder()
	service.Token(rec, req)
	assertStatus(t, rec, http.StatusBadRequest, "bad refresh")

	must.NoErr(t, service.store.CleanupExpired(context.Background()))
}

func TestStoreReloadsPersistedSigningKey(t *testing.T) {
	rawdb := dbtest.Open(t)
	store := NewStore(authdb.New(rawdb))
	key, err := store.LoadOrCreateSigningKey(context.Background())
	if err != nil || key.Private == nil {
		t.Fatalf("first key load: %v", err)
	}
	if _, err := store.LoadOrCreateSigningKey(context.Background()); err != nil {
		t.Fatalf("second key load: %v", err)
	}
}

func TestNewDefaultsAndErrors(t *testing.T) {
	rawdb := dbtest.Open(t)
	db := authdb.New(rawdb)
	if _, err := New(context.Background(), Config{OAuthEnabled: true}, db); err == nil {
		t.Fatalf("expected missing config error")
	}
	if _, err := New(context.Background(), Config{MasterPassword: "api-key", Log: nooplog.Logger}, db); err != nil {
		t.Fatalf("master-password-only service: %v", err)
	}
	var logs strings.Builder
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	if _, err := New(context.Background(), Config{
		MasterPassword: "api-key",
		DisableAllAuth: true,
		Log:            logger,
	}, db); err != nil {
		t.Fatalf("disable-all-auth service: %v", err)
	}
	if !strings.Contains(logs.String(), "all authentication is disabled") {
		t.Fatalf("missing disable-all-auth warning: %q", logs.String())
	}
	if _, err := New(context.Background(), Config{IssuerURL: "http://localhost:3000", OAuthEnabled: true, GoogleAuthnEnabled: true, GoogleClientID: "id", GoogleClientSecret: "secret", FrontendRedirectURIs: []string{"http://localhost:3000/auth/callback"}, Log: nooplog.Logger}, db); err != nil {
		t.Fatalf("new service with defaults: %v", err)
	}
}

func TestGoogleEmailLookup(t *testing.T) {
	oldTransport := http.DefaultTransport
	status := http.StatusOK
	body := `{"email":"alex@example.com"}`
	http.DefaultTransport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Header.Get("Authorization") != "Bearer token" {
			t.Fatalf("authorization header = %q", req.Header.Get("Authorization"))
		}
		return &http.Response{
			StatusCode: status,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(body)),
		}, nil
	})
	t.Cleanup(func() { http.DefaultTransport = oldTransport })

	email, err := googleEmail(context.Background(), "token")
	if err != nil || email != "alex@example.com" {
		t.Fatalf("googleEmail() email=%q err=%v", email, err)
	}
	status = http.StatusBadGateway
	if _, err := googleEmail(context.Background(), "token"); err == nil {
		t.Fatalf("expected status error")
	}
	status = http.StatusOK
	body = `{}`
	if _, err := googleEmail(context.Background(), "token"); err == nil {
		t.Fatalf("expected missing email error")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func tokenRequest(t *testing.T, service *Service, fields map[string]string) map[string]any {
	t.Helper()
	rec := tokenResponse(service, fields)
	assertStatus(t, rec, http.StatusOK, "token")
	return decodeJSON[map[string]any](t, rec)
}

func frontendAuthorizationCodeFields(code, verifier string) map[string]string {
	return map[string]string{
		"grant_type":    "authorization_code",
		"code":          code,
		"code_verifier": verifier,
		"client_id":     FrontendClientID,
		"redirect_uri":  "http://localhost:3000/auth/callback",
	}
}

func refreshTokenFields(token string) map[string]string {
	return map[string]string{
		"grant_type":    "refresh_token",
		"refresh_token": token,
		"client_id":     FrontendClientID,
	}
}

func tokenResponse(service *Service, fields map[string]string) *httptest.ResponseRecorder {
	form := url.Values{}
	for k, v := range fields {
		form.Set(k, v)
	}
	req := httptest.NewRequest(http.MethodPost, "/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	service.Token(rec, req)
	return rec
}

func concurrentTokenResponses(service *Service, fields map[string]string) [2]*httptest.ResponseRecorder {
	start := make(chan struct{})
	responses := make(chan *httptest.ResponseRecorder, 2)
	for range 2 {
		go func() {
			<-start
			responses <- tokenResponse(service, fields)
		}()
	}
	close(start)
	return [2]*httptest.ResponseRecorder{<-responses, <-responses}
}

func assertOneConcurrentTokenSuccess(
	t *testing.T,
	responses [2]*httptest.ResponseRecorder,
) *httptest.ResponseRecorder {
	t.Helper()
	var success *httptest.ResponseRecorder
	for _, rec := range responses {
		switch rec.Code {
		case http.StatusOK:
			if success != nil {
				t.Fatalf("both concurrent token requests succeeded")
			}
			success = rec
		case http.StatusBadRequest:
			if !strings.Contains(rec.Body.String(), `"error":"invalid_grant"`) {
				t.Fatalf("concurrent token error = %s", rec.Body.String())
			}
		default:
			t.Fatalf("concurrent token status = %d body = %s", rec.Code, rec.Body.String())
		}
	}
	if success == nil {
		t.Fatalf("both concurrent token requests failed")
	}
	return success
}

func TestEmailOTPFlow(t *testing.T) {
	service := newTestService(t)

	verifier := testOAuthVerifier
	sessionID := "test-session-id"
	seedLoginSession(t, service, sessionID, verifier)

	code := "123456"
	hash := tokenSignature(code)
	must.NoErr(t, service.store.SaveEmailOTP(context.Background(), sessionID, "alex@example.com", hash, tokenSignature("magic"), "", time.Now().Add(10*time.Minute)))

	verifyBody := strings.NewReader(`{"login_session_id":"` + sessionID + `","email":"alex@example.com","code":"` + code + `"}`)
	rec := callHandler(service.EmailVerify, http.MethodPost, "/auth/email/verify", verifyBody)
	assertStatus(t, rec, http.StatusOK, "email verify")
	verifyResp := decodeJSON[map[string]any](t, rec)
	redirectURL, ok := verifyResp["redirect_url"].(string)
	if !ok || redirectURL == "" {
		t.Fatalf("missing redirect_url in verify response: %v", verifyResp)
	}

	rec = callHandler(service.Authorize, http.MethodGet, redirectURL, nil)
	if rec.Code != http.StatusFound && rec.Code != http.StatusSeeOther {
		t.Fatalf("authorize resume after email status = %d", rec.Code)
	}
	clientURL, _ := url.Parse(rec.Header().Get("Location"))
	if clientURL.Query().Get("code") == "" {
		t.Fatalf("missing code in redirect after email auth: %s", clientURL.String())
	}

	tokens := tokenRequest(t, service, frontendAuthorizationCodeFields(clientURL.Query().Get("code"), verifier))
	claims, err := service.verifyAccessToken(tokens["access_token"].(string))
	if err != nil || claims.Subject != "alex@example.com" {
		t.Fatalf("verify access token subject=%q err=%v", claims.Subject, err)
	}
}

func TestEmailSendAndInvalidCodes(t *testing.T) {
	service := newTestService(t)

	verifier := testOAuthVerifier
	sessionID := "test-session-id2"
	seedLoginSession(t, service, sessionID, verifier)

	sendBody := strings.NewReader(`{"login_session_id":"` + sessionID + `","email":"alex@example.com"}`)
	rec := callHandler(service.EmailSend, http.MethodPost, "/auth/email/send", sendBody)
	assertStatus(t, rec, http.StatusOK, "email send")
	decodeJSON[map[string]any](t, rec)

	verifyBody := strings.NewReader(`{"login_session_id":"` + sessionID + `","email":"alex@example.com","code":"wrong"}`)
	rec = callHandler(service.EmailVerify, http.MethodPost, "/auth/email/verify", verifyBody)
	assertStatus(t, rec, http.StatusBadRequest, "email verify with wrong code")
	errResp := decodeJSON[map[string]any](t, rec)
	if errResp["error"] != "invalid_code" {
		t.Fatalf("expected invalid_code error, got %v", errResp)
	}
}

func TestEmailOTPErrors(t *testing.T) {
	service := newTestService(t)
	sessionID := "test-errors-session"
	seedLoginSession(t, service, sessionID, "", minimalLoginSession("test-errors-google-state"))

	sendBody := strings.NewReader(`{"login_session_id":"` + sessionID + `","email":"notallowed@example.com"}`)
	rec := callHandler(service.EmailSend, http.MethodPost, "/auth/email/send", sendBody)
	assertStatus(t, rec, http.StatusOK, "non-allowed email uniform response")

	sendBody = strings.NewReader(`{"login_session_id":"bad-session","email":"alex@example.com"}`)
	rec = callHandler(service.EmailSend, http.MethodPost, "/auth/email/send", sendBody)
	assertStatus(t, rec, http.StatusBadRequest, "bad session")

	router := chi.NewRouter()
	router.Post("/auth/email/send", service.EmailSend)
	rec = callHandler(router.ServeHTTP, http.MethodGet, "/auth/email/send", nil)
	assertStatus(t, rec, http.StatusMethodNotAllowed, "email send method")

	router = chi.NewRouter()
	router.Post("/auth/email/verify", service.EmailVerify)
	rec = callHandler(router.ServeHTTP, http.MethodGet, "/auth/email/verify", nil)
	assertStatus(t, rec, http.StatusMethodNotAllowed, "email verify method")

	rec = callHandler(service.EmailSend, http.MethodPost, "/auth/email/send", strings.NewReader(`{}`))
	assertStatus(t, rec, http.StatusBadRequest, "empty email send body")

	storedCode := "000000"
	wrongCode := "111111"
	hash := tokenSignature(storedCode)
	must.NoErr(t, service.store.SaveEmailOTP(context.Background(), sessionID, "alex@example.com", hash, tokenSignature("magic"), "", time.Now().Add(10*time.Minute)))
	verifyBody := strings.NewReader(`{"login_session_id":"` + sessionID + `","email":"alex@example.com","code":"` + wrongCode + `"}`)
	for i := range 5 {
		rec = callHandler(service.EmailVerify, http.MethodPost, "/auth/email/verify", verifyBody)
		assertStatus(t, rec, http.StatusBadRequest, fmt.Sprintf("verify attempt %d", i))
	}

	expiredSessionID := "expired-session"
	seedLoginSession(t, service, expiredSessionID, "", minimalLoginSession("expired-google-state"))
	expiredCode := "999999"
	expiredHash := tokenSignature(expiredCode)
	must.NoErr(t, service.store.SaveEmailOTP(context.Background(), expiredSessionID, "alex@example.com", expiredHash, tokenSignature("magic"), "", time.Now().Add(-1*time.Minute)))
	verifyExpiredBody := strings.NewReader(`{"login_session_id":"` + expiredSessionID + `","email":"alex@example.com","code":"` + expiredCode + `"}`)
	rec = callHandler(service.EmailVerify, http.MethodPost, "/auth/email/verify", verifyExpiredBody)
	assertStatus(t, rec, http.StatusBadRequest, "expired code")
}

func TestRegisterErrors(t *testing.T) {
	service := newTestService(t)
	service.cfg.DCRSettings = func() DCRSettings {
		return DCRSettings{Enabled: true, DynamicRedirectHosts: []string{"client.example.com"}}
	}

	router := chi.NewRouter()
	router.Post("/register", service.Register)
	rec := callHandler(router.ServeHTTP, http.MethodGet, "/register", nil)
	assertStatus(t, rec, http.StatusMethodNotAllowed, "register method")

	rec = callHandler(service.Register, http.MethodPost, "/register", strings.NewReader(`not json`))
	assertStatus(t, rec, http.StatusBadRequest, "invalid registration JSON")

	body := strings.NewReader(`{"redirect_uris":["https://client.example.com/callback"],"token_endpoint_auth_method":"client_secret_basic"}`)
	rec = callHandler(service.Register, http.MethodPost, "/register", body)
	assertStatus(t, rec, http.StatusBadRequest, "unsupported registration auth method")

	body = strings.NewReader(`{"client_name":"MCP","redirect_uris":["https://client.example.com/callback"],"token_endpoint_auth_method":"none"}`)
	rec = callHandler(service.Register, http.MethodPost, "/register", body)
	assertStatus(t, rec, http.StatusOK, "valid registration")
	body = strings.NewReader(`{"redirect_uris":["https://evil.example.com/cb"]}`)
	rec = callHandler(service.Register, http.MethodPost, "/register", body)
	assertStatus(t, rec, http.StatusBadRequest, "unallowlisted HTTPS redirect URI")

	// localhost and custom URI schemes are also allowed.
	for _, uri := range []string{"http://localhost:8080/cb", "http://127.0.0.1/cb", "myapp://oauth"} {
		body = strings.NewReader(`{"redirect_uris":["` + uri + `"]}`)
		rec = callHandler(service.Register, http.MethodPost, "/register", body)
		assertStatus(t, rec, http.StatusOK, "allowed redirect URI "+uri)
	}

	// Plain HTTP on a non-local host is rejected.
	body = strings.NewReader(`{"redirect_uris":["http://evil.example.com/cb"]}`)
	rec = callHandler(service.Register, http.MethodPost, "/register", body)
	assertStatus(t, rec, http.StatusBadRequest, "plain HTTP non-local redirect URI")

	for _, uri := range []string{"javascript:alert(1)", "data:text/html,evil", "file:///tmp/callback", "mailto:user@example.com"} {
		body = strings.NewReader(`{"redirect_uris":["` + uri + `"]}`)
		rec = callHandler(service.Register, http.MethodPost, "/register", body)
		assertStatus(t, rec, http.StatusBadRequest, "dangerous redirect URI "+uri)
	}
}

func TestRegisterRequiresMCPEnabled(t *testing.T) {
	validBody := func() *strings.Reader {
		return strings.NewReader(`{"client_name":"MCP","redirect_uris":["https://client.example.com/callback"],"token_endpoint_auth_method":"none"}`)
	}

	t.Run("nil DCRSettings", func(t *testing.T) {
		service := newTestService(t)
		rec := callHandler(service.Register, http.MethodPost, "/register", validBody())
		assertStatus(t, rec, http.StatusNotFound, "register without DCR settings")
	})

	t.Run("explicitly disabled", func(t *testing.T) {
		service := newTestService(t)
		service.cfg.DCRSettings = func() DCRSettings {
			return DCRSettings{Enabled: false, DynamicRedirectHosts: []string{"client.example.com"}}
		}
		rec := callHandler(service.Register, http.MethodPost, "/register", validBody())
		assertStatus(t, rec, http.StatusNotFound, "register with MCP disabled")
	})

	t.Run("enabled", func(t *testing.T) {
		service := newTestService(t)
		service.cfg.DCRSettings = func() DCRSettings {
			return DCRSettings{Enabled: true, DynamicRedirectHosts: []string{"client.example.com"}}
		}
		rec := callHandler(service.Register, http.MethodPost, "/register", validBody())
		assertStatus(t, rec, http.StatusOK, "register with MCP enabled")
	})
}

func TestAuthorizationMetadataOmitsRegistrationWhenDCRDisabled(t *testing.T) {
	service := newTestService(t)
	rec := callHandler(service.AuthorizationMetadata, http.MethodGet, "/.well-known/oauth-authorization-server", nil)
	metadata := decodeJSON[map[string]any](t, rec)
	if _, ok := metadata["registration_endpoint"]; ok {
		t.Fatalf("registration_endpoint advertised while DCR disabled: %#v", metadata)
	}

	service.cfg.DCRSettings = func() DCRSettings { return DCRSettings{Enabled: true} }
	rec = callHandler(service.AuthorizationMetadata, http.MethodGet, "/.well-known/oauth-authorization-server", nil)
	metadata = decodeJSON[map[string]any](t, rec)
	if metadata["registration_endpoint"] == "" {
		t.Fatalf("registration_endpoint omitted while DCR enabled: %#v", metadata)
	}
}

type failSender struct{}

func (f *failSender) Send(_ context.Context, to, subject, body string) error {
	return fmt.Errorf("simulated failure")
}

func TestEmailSendFailure(t *testing.T) {
	service := newTestService(t)
	service.emailSender = &failSender{}
	sessionID := "fail-session"
	seedLoginSession(t, service, sessionID, "", minimalLoginSession("fail-google-state"))
	sendBody := strings.NewReader(`{"login_session_id":"` + sessionID + `","email":"alex@example.com"}`)
	rec := callHandler(service.EmailSend, http.MethodPost, "/auth/email/send", sendBody)
	assertStatus(t, rec, http.StatusInternalServerError, "email send failure")
}

func TestEmailSendAlreadyAuthenticated(t *testing.T) {
	service := newTestService(t)
	sessionID := "auth-session"
	seedLoginSession(t, service, sessionID, "", minimalLoginSession("auth-google-state"))
	must.NoErr(t, service.store.MarkLoginSessionAuthenticated(context.Background(), sessionID, "alex@example.com"))
	sendBody := strings.NewReader(`{"login_session_id":"` + sessionID + `","email":"alex@example.com"}`)
	rec := callHandler(service.EmailSend, http.MethodPost, "/auth/email/send", sendBody)
	assertStatus(t, rec, http.StatusBadRequest, "authenticated session")
}

func newSessionWithMagicToken(t *testing.T, service *Service, sessionID, magicToken string, expiresAt time.Time) {
	t.Helper()
	seedLoginSession(t, service, sessionID, "", minimalLoginSession(sessionID+"-google-state"))
	magicHash := tokenSignature(magicToken)
	must.NoErr(t, service.store.SaveEmailOTP(context.Background(), sessionID, "alex@example.com", tokenSignature("000000"), magicHash, "", expiresAt))
}

func TestVerifyEmailMagicToken(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()

	t.Run("success", func(t *testing.T) {
		magicToken := "valid-magic-token"
		newSessionWithMagicToken(t, service, "magic-ok", magicToken, time.Now().Add(10*time.Minute))
		session, err := service.store.VerifyEmailMagicToken(ctx, "magic-ok", "alex@example.com", tokenSignature(magicToken))
		must.NoErr(t, err)
		if !session.Authenticated {
			t.Fatal("session should be authenticated")
		}
	})

	t.Run("invalid token", func(t *testing.T) {
		newSessionWithMagicToken(t, service, "magic-bad", "real-token", time.Now().Add(10*time.Minute))
		_, err := service.store.VerifyEmailMagicToken(ctx, "magic-bad", "alex@example.com", tokenSignature("wrong-token"))
		if !errors.Is(err, ErrInvalidToken) {
			t.Fatalf("expected invalid_token, got: %v", err)
		}
	})

	t.Run("expired", func(t *testing.T) {
		newSessionWithMagicToken(t, service, "magic-exp", "exp-token", time.Now().Add(-1*time.Minute))
		_, err := service.store.VerifyEmailMagicToken(ctx, "magic-exp", "alex@example.com", tokenSignature("exp-token"))
		if !errors.Is(err, ErrExpired) {
			t.Fatalf("expected expired, got: %v", err)
		}
	})

	t.Run("already used", func(t *testing.T) {
		magicToken := "once-token"
		newSessionWithMagicToken(t, service, "magic-once", magicToken, time.Now().Add(10*time.Minute))
		if _, err := service.store.VerifyEmailMagicToken(ctx, "magic-once", "alex@example.com", tokenSignature(magicToken)); err != nil {
			t.Fatalf("first verify failed: %v", err)
		}
		_, err := service.store.VerifyEmailMagicToken(ctx, "magic-once", "alex@example.com", tokenSignature(magicToken))
		if !errors.Is(err, ErrAlreadyUsed) {
			t.Fatalf("expected already_used, got: %v", err)
		}
	})
}

func TestEmailMagicLink(t *testing.T) {
	service := newTestService(t)

	t.Run("missing params returns 400", func(t *testing.T) {
		rec := callHandler(service.EmailMagicLink, http.MethodGet, "/auth/email/magic", nil)
		assertStatus(t, rec, http.StatusBadRequest, "missing magic link params")
	})

	t.Run("disallowed email returns generic magic link error", func(t *testing.T) {
		rec := callHandler(
			service.EmailMagicLink,
			http.MethodGet,
			"/auth/email/magic?token=t&session_id=s&email=unknown@example.com",
			nil,
		)
		assertStatus(t, rec, http.StatusBadRequest, "disallowed email magic link")
		if strings.Contains(rec.Body.String(), "not allowed") {
			t.Fatalf("response disclosed allowlist status: %s", rec.Body.String())
		}
	})

	t.Run("valid token redirects to authorize", func(t *testing.T) {
		magicToken := "handler-magic-token"
		newSessionWithMagicToken(t, service, "magic-handler", magicToken, time.Now().Add(10*time.Minute))
		params := url.Values{
			"token":      {magicToken},
			"session_id": {"magic-handler"},
			"email":      {" ALEx@EXAMPLE.com "},
		}
		rec := callHandler(service.EmailMagicLink, http.MethodGet, "/auth/email/magic?"+params.Encode(), nil)
		assertStatus(t, rec, http.StatusFound, "valid email magic link")
		loc := rec.Header().Get("Location")
		if !strings.Contains(loc, "/authorize?session_id=") {
			t.Fatalf("unexpected redirect location: %s", loc)
		}
	})

	t.Run("expired token returns 400", func(t *testing.T) {
		newSessionWithMagicToken(t, service, "magic-exp2", "exp-tok", time.Now().Add(-1*time.Minute))
		params := url.Values{
			"token":      {"exp-tok"},
			"session_id": {"magic-exp2"},
			"email":      {"alex@example.com"},
		}
		rec := callHandler(service.EmailMagicLink, http.MethodGet, "/auth/email/magic?"+params.Encode(), nil)
		assertStatus(t, rec, http.StatusBadRequest, "expired email magic link")
	})
}

func TestEmailVerifyMissingFields(t *testing.T) {
	service := newTestService(t)
	rec := callHandler(service.EmailVerify, http.MethodPost, "/auth/email/verify", strings.NewReader(`{}`))
	assertStatus(t, rec, http.StatusBadRequest, "empty email verify body")
}

func TestEmailOnlyAuthConfig(t *testing.T) {
	rawdb := dbtest.Open(t)
	db := authdb.New(rawdb)
	service, err := New(context.Background(), Config{
		IssuerURL:             "http://localhost:3000",
		OAuthEnabled:          true,
		EmailCodeAuthnEnabled: true,
		FrontendRedirectURIs:  []string{"http://localhost:3000/auth/callback"},
		SMTPHost:              "smtp.example.com",
		SMTPPort:              "587",
		SMTPFrom:              "noreply@example.com",
		SMTPUsername:          "user",
		SMTPPassword:          "pass",
		Log:                   nooplog.Logger,
	}, db)
	must.NoErr(t, err)
	rec := callHandler(service.AuthConfig, http.MethodGet, "/auth/config", nil)
	assertStatus(t, rec, http.StatusOK, "auth config")
	configResp := decodeJSON[map[string]any](t, rec)
	if configResp["email_auth_enabled"] != true {
		t.Fatalf("expected email_auth_enabled=true, got %v", configResp["email_auth_enabled"])
	}
	if configResp["google_auth_enabled"] != false {
		t.Fatalf("expected google_auth_enabled=false, got %v", configResp["google_auth_enabled"])
	}
	if configResp["setup_complete"] != true {
		t.Fatalf("expected default setup_complete=true, got %v", configResp["setup_complete"])
	}
}

func TestAuthConfigSetupCompleteCallback(t *testing.T) {
	rawdb := dbtest.Open(t)
	db := authdb.New(rawdb)
	service, err := New(context.Background(), Config{
		MasterPassword: "secret",
		SetupComplete:  func() bool { return false },
		Log:            nooplog.Logger,
	}, db)
	must.NoErr(t, err)
	rec := callHandler(service.AuthConfig, http.MethodGet, "/auth/config", nil)
	assertStatus(t, rec, http.StatusOK, "auth config")
	configResp := decodeJSON[map[string]any](t, rec)
	if configResp["setup_complete"] != false {
		t.Fatalf("expected setup_complete=false, got %v", configResp["setup_complete"])
	}
}

func TestClientFositeMethods(t *testing.T) {
	c := Client{OAuthClient: OAuthClient{
		ID:              "test",
		GrantTypes:      []string{"authorization_code"},
		ResponseTypes:   []string{"code"},
		Scopes:          []string{"read"},
		ApplicationType: "web",
		ClientName:      "Test",
		Public:          true,
		Preseeded:       true,
	}}
	if c.GetID() != "test" {
		t.Fatalf("GetID() = %q", c.GetID())
	}
	if c.GetHashedSecret() != nil {
		t.Fatalf("GetHashedSecret() should be nil")
	}
	if len(c.GetRedirectURIs()) != len(c.RedirectURIs) {
		t.Fatalf("GetRedirectURIs mismatch")
	}
	if len(c.GetGrantTypes()) != 1 || c.GetGrantTypes()[0] != "authorization_code" {
		t.Fatalf("GetGrantTypes() = %v", c.GetGrantTypes())
	}
	if len(c.GetResponseTypes()) != 1 || c.GetResponseTypes()[0] != "code" {
		t.Fatalf("GetResponseTypes() = %v", c.GetResponseTypes())
	}
	if len(c.GetScopes()) != 1 || c.GetScopes()[0] != "read" {
		t.Fatalf("GetScopes() = %v", c.GetScopes())
	}
	if !c.IsPublic() {
		t.Fatalf("IsPublic() should be true")
	}

	empty := Client{}
	if len(empty.GetGrantTypes()) != 1 || empty.GetGrantTypes()[0] != "authorization_code" {
		t.Fatalf("GetGrantTypes() default = %v", empty.GetGrantTypes())
	}
	if len(empty.GetResponseTypes()) != 1 || empty.GetResponseTypes()[0] != "code" {
		t.Fatalf("GetResponseTypes() default = %v", empty.GetResponseTypes())
	}
}

func TestUserManagement(t *testing.T) {
	service, adminSvc := newTestAuthAndAdmin(t)
	ctx := context.Background()

	t.Run("Users returns admin seeded from config", func(t *testing.T) {
		users, err := adminSvc.Users(ctx)
		must.NoErr(t, err)
		if len(users) != 1 {
			t.Fatalf("expected 1 user, got %d", len(users))
		}
		if users[0].Email != "alex@example.com" || users[0].Role != model.RoleAdmin {
			t.Fatalf("unexpected user: %+v", users[0])
		}
	})

	t.Run("AddUser creates user and sends invite", func(t *testing.T) {
		user := mustAddUser(t, adminSvc, "friend@example.com", "alex@example.com", string(RoleWriter))
		if user.Email != "friend@example.com" || user.Role != model.RoleWriter {
			t.Fatalf("unexpected user: %+v", user)
		}
		users, _ := adminSvc.Users(ctx)
		if len(users) != 2 {
			t.Fatalf("expected 2 users, got %d", len(users))
		}
	})

	t.Run("AddUser duplicate returns error", func(t *testing.T) {
		_, err := adminSvc.AddUser(ctx, "friend@example.com", "alex@example.com", string(RoleWriter))
		if err == nil {
			t.Fatalf("expected error for duplicate user")
		}
	})

	t.Run("UserExists returns true for existing", func(t *testing.T) {
		exists, err := service.store.UserExists(ctx, "friend@example.com")
		must.NoErr(t, err)
		if !exists {
			t.Fatalf("expected user to exist")
		}
	})

	t.Run("UserExists returns false for missing", func(t *testing.T) {
		exists, err := service.store.UserExists(ctx, "nobody@example.com")
		must.NoErr(t, err)
		if exists {
			t.Fatalf("expected user to not exist")
		}
	})

	t.Run("UserIDByEmail returns id for existing", func(t *testing.T) {
		id := mustUserIDByEmail(t, service.store, "alex@example.com")
		if id == 0 {
			t.Fatalf("expected non-empty id")
		}
	})

	t.Run("RemoveUser deletes user and revokes tokens", func(t *testing.T) {
		// Look up the user's ID first
		friendID := mustUserIDByEmail(t, service.store, "friend@example.com")
		// Create a refresh token for the user first
		must.NoErr(t, service.store.db.CreateRefreshToken(ctx, OAuthToken{
			Signature: "sig-remove-test",
			ClientID:  "test-client",
			Subject:   "friend@example.com",
			Scopes:    []string{"read"},
			ExpiresAt: time.Now().Add(time.Hour),
		}))
		must.NoErr(t, adminSvc.RemoveUser(ctx, friendID))
		exists, _ := service.store.UserExists(ctx, "friend@example.com")
		if exists {
			t.Fatalf("user should be deleted")
		}
	})
}

func TestScopesForRole(t *testing.T) {
	writerScopes := []string{
		ScopeReadTransactions, ScopeWriteTransactions,
		ScopeReadAccounts, ScopeWriteAccounts,
		ScopeReadRules, ScopeWriteRules,
		ScopeReadCategories, ScopeWriteCategories,
		ScopeReadSpending, ScopeReadCashflow,
		ScopeReadOwners,
		ScopeReadAssets, ScopeWriteAssets,
		ScopeReadWealth, ScopeWriteWealth,
		ScopeReadHoldings,
		ScopeReadPortfolio,
		ScopeReadBudgets, ScopeWriteBudgets,
		ScopeReadTags, ScopeWriteTags,
	}
	adminScopes := []string{
		ScopeReadTransactions, ScopeWriteTransactions,
		ScopeReadAccounts, ScopeWriteAccounts,
		ScopeReadUsers, ScopeWriteUsers,
		ScopeReadRules, ScopeWriteRules,
		ScopeReadCategories, ScopeWriteCategories,
		ScopeReadSpending, ScopeReadCashflow,
		ScopeReadOwners, ScopeWriteOwners,
		ScopeReadAssets, ScopeWriteAssets,
		ScopeReadWealth, ScopeWriteWealth,
		ScopeReadHoldings,
		ScopeReadPortfolio,
		ScopeReadBudgets, ScopeWriteBudgets,
		ScopeReadTags, ScopeWriteTags,
		ScopeReadSettings, ScopeWriteSettings,
	}
	tests := []struct {
		role Role
		want []string
	}{
		{role: RoleAdmin, want: adminScopes},
		{role: RoleWriter, want: writerScopes},
		{role: RoleReadonly, want: []string{
			ScopeReadTransactions,
			ScopeReadAccounts,
			ScopeReadRules,
			ScopeReadCategories,
			ScopeReadSpending, ScopeReadCashflow,
			ScopeReadOwners,
			ScopeReadAssets,
			ScopeReadWealth,
			ScopeReadHoldings,
			ScopeReadPortfolio,
			ScopeReadBudgets,
			ScopeReadTags,
		}},
		{role: RoleSpendTracker, want: []string{
			ScopeReadSpending,
			ScopeReadCategories,
			ScopeReadOwners,
			ScopeReadTags,
		}},
		{role: RoleCashflowTracker, want: []string{
			ScopeReadSpending,
			ScopeReadCashflow,
			ScopeReadCategories,
			ScopeReadOwners,
			ScopeReadBudgets, ScopeWriteBudgets,
			ScopeReadTags,
		}},
		{role: RoleNetWorthTracker, want: []string{
			ScopeReadAssets,
			ScopeWriteAssets,
			ScopeReadWealth,
			ScopeWriteWealth,
			ScopeReadAccounts,
			ScopeReadOwners,
		}},
		{role: RolePortfolioTracker, want: []string{
			ScopeReadPortfolio,
			ScopeReadAccounts,
			ScopeReadOwners,
		}},
		{role: Role("unknown"), want: nil},
	}
	for _, tt := range tests {
		if got := ScopesForRole(tt.role); !slices.Equal(got, tt.want) {
			t.Fatalf("ScopesForRole(%q) = %#v, want %#v", tt.role, got, tt.want)
		}
	}
}

func TestGrantedScopesForRoleIntersectsRequestedScopes(t *testing.T) {
	granted := GrantedScopesForRole(RoleWriter, []string{ScopeReadTransactions, ScopeWriteUsers})
	if !slices.Contains(granted, ScopeReadTransactions) {
		t.Fatalf("missing requested writer scope in %v", granted)
	}
	if slices.Contains(granted, ScopeWriteUsers) {
		t.Fatalf("granted users write scope to writer: %v", granted)
	}

	legacy := GrantedScopesForRole(RoleReadonly, []string{"read", "write"})
	if !slices.Contains(legacy, ScopeReadTransactions) {
		t.Fatalf("legacy read token did not expand to readonly scopes: %v", legacy)
	}
	if slices.Contains(legacy, ScopeWriteTransactions) {
		t.Fatalf("legacy write token bypassed readonly role: %v", legacy)
	}
}

func TestHasScope(t *testing.T) {
	ctx := context.Background()
	if HasScope(ctx, ScopeReadTransactions) {
		t.Fatal("empty context should have no scopes")
	}

	ctx = ContextWithScopes(ctx, ScopesForRole(RoleWriter))
	if !HasScope(ctx, ScopeReadTransactions) {
		t.Fatal("writer should have read:transactions")
	}
	if HasScope(ctx, ScopeReadUsers) {
		t.Fatal("writer should not have read:users")
	}

	scopes := Scopes(ctx)
	if len(scopes) == 0 {
		t.Fatal("Scopes() should return non-empty slice for writer context")
	}
}

func TestContextWithSubjectPreservedByContextWithScopes(t *testing.T) {
	ctx := ContextWithSubject(context.Background(), "user@example.com")
	ctx = ContextWithScopes(ctx, AllScopes)
	sub, ok := Subject(ctx)
	if !ok || sub != "user@example.com" {
		t.Fatalf("subject lost after ContextWithScopes: %q, %v", sub, ok)
	}
}

func TestUserRoleStoredAndRetrieved(t *testing.T) {
	service, adminSvc := newTestAuthAndAdmin(t)
	ctx := context.Background()

	user := mustAddUser(t, adminSvc, "writer@example.com", "alex@example.com", string(RoleWriter))
	if user.Role.String() != "WRITER" {
		t.Fatalf("expected WRITER role, got %s", user.Role)
	}

	role, err := service.store.UserRole(ctx, "writer@example.com")
	must.NoErr(t, err)
	if role != RoleWriter {
		t.Fatalf("expected writer, got %q", role)
	}
}

func TestUpdateUserRole(t *testing.T) {
	service, adminSvc := newTestAuthAndAdmin(t)
	ctx := context.Background()

	user := mustAddUser(t, adminSvc, "writer@example.com", "", string(RoleWriter))
	updated, err := adminSvc.UpdateUserRole(ctx, user.ID.Int64(), string(RoleReadonly))
	must.NoErr(t, err)
	if updated.Role != model.RoleReadonly {
		t.Fatalf("updated user = %#v", updated)
	}
	adminUser, err := adminSvc.UpdateUserRole(ctx, user.ID.Int64(), string(RoleAdmin))
	must.NoErr(t, err)
	if adminUser.Role != model.RoleAdmin {
		t.Fatalf("admin user = %#v", adminUser)
	}

	adminID := mustUserIDByEmail(t, service.store, "alex@example.com")
	updatedAdmin, err := adminSvc.UpdateUserRole(ctx, adminID, string(RoleReadonly))
	must.NoErr(t, err)
	if updatedAdmin.Role != model.RoleReadonly {
		t.Fatalf("updated admin = %#v", updatedAdmin)
	}
}

func TestProtectMCPUnauthorizedMetadata(t *testing.T) {
	service := newTestService(t)
	handler := service.ProtectMCP(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler should not be called")
	}))
	rec := callHandler(handler.ServeHTTP, http.MethodGet, "/mcp", nil)
	assertStatus(t, rec, http.StatusUnauthorized, "MCP without authorization")
	if got := rec.Header().Get("WWW-Authenticate"); !strings.Contains(got, "/.well-known/oauth-protected-resource/mcp") {
		t.Fatalf("WWW-Authenticate = %q", got)
	}
}

func TestRequestWebAuthnUserEmailFallbackRequiresIncompleteSetup(t *testing.T) {
	service := newTestService(t)
	req := httptest.NewRequest(http.MethodPost, "/auth/webauthn/register/begin", nil)

	service.cfg.SetupComplete = func() bool { return true }
	rec := httptest.NewRecorder()
	if _, ok := service.requestWebAuthnUser(rec, req, "alex@example.com"); ok {
		t.Fatalf("requestWebAuthnUser() allowed fallback after setup complete")
	}
	assertStatus(t, rec, http.StatusUnauthorized, "WebAuthn fallback after setup")

	service.cfg.SetupComplete = func() bool { return false }
	rec = httptest.NewRecorder()
	user, ok := service.requestWebAuthnUser(rec, req, "alex@example.com")
	if !ok {
		t.Fatalf("requestWebAuthnUser() rejected fallback during setup")
	}
	if user.email != "alex@example.com" {
		t.Fatalf("email = %q", user.email)
	}

	service.cfg.SetupComplete = func() bool { return true }
	authenticatedReq := req.WithContext(ContextWithSubject(req.Context(), "alex@example.com"))
	rec = httptest.NewRecorder()
	if _, ok := service.requestWebAuthnUser(rec, authenticatedReq, "other@example.com"); !ok {
		t.Fatalf("requestWebAuthnUser() rejected authenticated subject")
	}
}

func TestWriteWebAuthnStoreErrorWrappedNotFound(t *testing.T) {
	rec := httptest.NewRecorder()
	writeWebAuthnStoreError(rec, fmt.Errorf("rename credential: %w", ErrNotFound))
	assertStatus(t, rec, http.StatusNotFound, "wrapped WebAuthn credential not found")
}

func newTestService(t *testing.T) *Service {
	t.Helper()
	service, _ := newTestAuthAndAdmin(t)
	return service
}

func authorizeCodeFixture(t *testing.T, service *Service) (string, string) {
	t.Helper()
	verifier := testOAuthVerifier
	return verifier, authorizeCodeWithGoogle(t, service, verifier)
}

func authorizeCodeWithGoogle(t *testing.T, service *Service, verifier string) string {
	t.Helper()
	service.googleEmail = func(context.Context, string) (string, error) { return "Alex@example.com", nil }

	authorizeURL := "/authorize?response_type=code&client_id=tallyo-web&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback&state=client-state&scope=read+write&code_challenge=" + codeChallenge(verifier) + "&code_challenge_method=S256&auth_method=google"
	rec := callHandler(service.Authorize, http.MethodGet, authorizeURL, nil)
	assertStatus(t, rec, http.StatusFound, "authorize")
	loginURL, _ := url.Parse(rec.Header().Get("Location"))

	rec = callHandler(service.GoogleLogin, http.MethodGet, loginURL.String(), nil)
	assertStatus(t, rec, http.StatusFound, "google login")
	googleURL, _ := url.Parse(rec.Header().Get("Location"))

	callback := "/auth/google/callback?state=" + url.QueryEscape(googleURL.Query().Get("state")) + "&code=google-code"
	rec = callHandler(service.GoogleCallback, http.MethodGet, callback, nil)
	assertStatus(t, rec, http.StatusFound, "google callback")
	resumeURL, _ := url.Parse(rec.Header().Get("Location"))

	rec = callHandler(service.Authorize, http.MethodGet, resumeURL.String(), nil)
	if rec.Code != http.StatusFound && rec.Code != http.StatusSeeOther {
		t.Fatalf("authorize resume status = %d", rec.Code)
	}
	clientURL, _ := url.Parse(rec.Header().Get("Location"))
	code := clientURL.Query().Get("code")
	if code == "" {
		t.Fatalf("missing authorization code in redirect: %s", clientURL.String())
	}
	return code
}

func assertRefreshInactive(t *testing.T, service *Service, refreshToken string) {
	t.Helper()
	signature := tokenSignature(refreshToken)
	token, err := service.store.db.RefreshToken(context.Background(), signature, time.Now().UTC(), false)
	must.NoErr(t, err)
	if token.Active {
		t.Fatalf("refresh token %q is still active", signature)
	}
	if _, err := service.store.db.RefreshToken(context.Background(), signature, time.Now().UTC(), true); !errors.Is(err, ErrNotFound) {
		t.Fatalf("active refresh lookup err = %v", err)
	}
}

func assertAccessTokenMissing(t *testing.T, service *Service, accessToken string) {
	t.Helper()
	signature := jwtAccessSignature(accessToken)
	if _, err := service.store.db.AccessToken(context.Background(), signature, time.Now().UTC(), false); !errors.Is(err, ErrNotFound) {
		t.Fatalf("access token %q lookup err = %v", signature, err)
	}
}

func jwtAccessSignature(accessToken string) string {
	parts := strings.Split(accessToken, ".")
	if len(parts) != 3 {
		return ""
	}
	return parts[2]
}

type failingRefreshStore struct {
	authPersistence
	fail bool
}

func (s *failingRefreshStore) CreateRefreshToken(ctx context.Context, token OAuthToken) error {
	if s.fail {
		return errors.New("forced refresh insertion failure")
	}
	return s.authPersistence.CreateRefreshToken(ctx, token)
}

type blockingAuthCodeStore struct {
	authPersistence
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (s *blockingAuthCodeStore) CreateAuthCode(ctx context.Context, code string, auth AuthCode) error {
	blocked := false
	s.once.Do(func() {
		blocked = true
		close(s.started)
	})
	if blocked {
		<-s.release
	}
	return s.authPersistence.CreateAuthCode(ctx, code, auth)
}

func authorizeResponseCodes(responses ...*httptest.ResponseRecorder) []string {
	codes := make([]string, 0, len(responses))
	for _, rec := range responses {
		location := rec.Header().Get("Location")
		if location == "" {
			continue
		}
		parsed, err := url.Parse(location)
		if err != nil {
			continue
		}
		if code := parsed.Query().Get("code"); code != "" {
			codes = append(codes, code)
		}
	}
	return codes
}

func newTestAuthAndAdmin(t *testing.T) (*Service, *admin.Service) {
	t.Helper()
	rawdb := dbtest.Open(t)
	authStore := authdb.New(rawdb)
	seedAdminUser(t, rawdb)
	service := newTestAuthService(t, authStore)
	adminSvc := &admin.Service{Store: admindb.New(rawdb), Inviter: service}
	return service, adminSvc
}

func newTestAuthService(t *testing.T, store authPersistence) *Service {
	t.Helper()
	service, err := New(context.Background(), Config{
		IssuerURL:             "http://localhost:3000",
		OAuthEnabled:          true,
		GoogleAuthnEnabled:    true,
		GoogleClientID:        "google-client",
		GoogleClientSecret:    "google-secret",
		EmailCodeAuthnEnabled: true,
		FrontendRedirectURIs:  []string{"http://localhost:3000/auth/callback"},
		MasterPassword:        "api-key",
		AccessTokenLifetime:   15 * time.Minute,
		RefreshTokenLifetime:  time.Hour,
		DevCORSAllowedOrigins: []string{"http://localhost:5173"},
		Log:                   nooplog.Logger,
	}, store)
	must.NoErr(t, err)
	service.googleConfig = fakeGoogle{}
	return service
}

func seedAdminUser(t *testing.T, db *database.DB) {
	t.Helper()
	if _, err := admindb.New(db).InsertUser(context.Background(), admin.InsertUserInput{Email: "alex@example.com", Role: "admin"}); err != nil {
		t.Fatalf("seed admin user: %v", err)
	}
}
