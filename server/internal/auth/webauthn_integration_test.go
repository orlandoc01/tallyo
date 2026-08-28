package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/descope/virtualwebauthn"

	"tallyo/internal/utils/must"
)

func TestWebAuthnRegisterAndLogin(t *testing.T) {
	service := newTestService(t)
	commit, err := service.PrepareWebAuthnConfig(true, "http://localhost:3000", "localhost", "Tallyo", []string{"http://localhost:3000"})
	must.NoErr(t, err)
	commit()
	rp := virtualwebauthn.RelyingParty{ID: "localhost", Name: "Tallyo", Origin: "http://localhost:3000"}
	authenticator := virtualwebauthn.NewAuthenticator()
	credential := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)

	begin := httptest.NewRequest(http.MethodPost, "/auth/webauthn/register/begin", bytes.NewBufferString(`{"name":"Laptop"}`))
	begin = begin.WithContext(ContextWithSubject(begin.Context(), "alex@example.com"))
	registered := httptest.NewRecorder()
	service.WebAuthnRegisterBegin(registered, begin)
	assertStatus(t, registered, http.StatusOK, "webauthn registration begin")
	options, err := virtualwebauthn.ParseAttestationOptions(registered.Body.String())
	must.NoErr(t, err)

	finish := httptest.NewRequest(http.MethodPost, "/auth/webauthn/register/finish", bytes.NewBufferString(virtualwebauthn.CreateAttestationResponse(rp, authenticator, credential, *options)))
	finish = finish.WithContext(ContextWithSubject(finish.Context(), "alex@example.com"))
	completed := httptest.NewRecorder()
	service.WebAuthnRegisterFinish(completed, finish)
	assertStatus(t, completed, http.StatusCreated, "webauthn registration finish")

	login := seedLoginSession(t, service, "passkey-login", testOAuthVerifier)
	loginBegin := callHandler(service.WebAuthnLoginBegin, http.MethodPost, "/auth/webauthn/login/begin", bytes.NewBufferString(`{"login_session_id":"passkey-login"}`))
	assertStatus(t, loginBegin, http.StatusOK, "webauthn login begin")
	assertionOptions, err := virtualwebauthn.ParseAssertionOptions(loginBegin.Body.String())
	must.NoErr(t, err)
	userID := mustUserIDByEmail(t, service.store, "alex@example.com")
	authenticator.Options.UserHandle = []byte(strconv.FormatInt(userID, 10))
	payload, err := json.Marshal(struct {
		LoginSessionID string          `json:"login_session_id"`
		Assertion      json.RawMessage `json:"assertion"`
	}{LoginSessionID: login.ID, Assertion: json.RawMessage(virtualwebauthn.CreateAssertionResponse(rp, authenticator, credential, *assertionOptions))})
	must.NoErr(t, err)

	loginFinish := callHandler(service.WebAuthnLoginFinish, http.MethodPost, "/auth/webauthn/login/finish", bytes.NewReader(payload))
	assertStatus(t, loginFinish, http.StatusOK, "webauthn login finish")
	session, err := service.store.LoginSessionByID(context.Background(), login.ID)
	must.NoErr(t, err)
	if !session.Authenticated || session.Subject != "alex@example.com" {
		t.Fatalf("login session = %#v", session)
	}

	secondFinish := callHandler(service.WebAuthnLoginFinish, http.MethodPost, "/auth/webauthn/login/finish", bytes.NewReader(payload))
	assertStatus(t, secondFinish, http.StatusBadRequest, "second webauthn login finish")
}
