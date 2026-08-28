package auth

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-webauthn/webauthn/protocol"
	webauthnlib "github.com/go-webauthn/webauthn/webauthn"

	u "tallyo/internal/utils"
)

type webAuthnCredentialResponse struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CreatedAt  string `json:"createdAt"`
	LastUsedAt string `json:"lastUsedAt,omitempty"`
}

func (s *Service) WebAuthnRegisterBegin(w http.ResponseWriter, r *http.Request) {
	webAuthn, ok := s.webAuthnOr404(w)
	if !ok {
		return
	}
	var req struct {
		Name  string `json:"name" validate:"notblank"`
		Email string `json:"email"`
	}
	if !decodeAndValidate(w, r, &req) {
		return
	}
	name := strings.TrimSpace(req.Name)
	user, ok := s.requestWebAuthnUser(w, r, req.Email)
	if !ok {
		return
	}
	options, session, err := webAuthn.BeginRegistration(user,
		webauthnlib.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			AuthenticatorAttachment: protocol.Platform,
			ResidentKey:             protocol.ResidentKeyRequirementRequired,
			RequireResidentKey:      protocol.ResidentKeyRequired(),
			UserVerification:        protocol.VerificationRequired,
		}),
	)
	if HTTPFail(w, err, http.StatusInternalServerError, "begin webauthn registration") {
		return
	}
	sessionJSON, err := json.Marshal(session)
	if HTTPFail(w, err, http.StatusInternalServerError, "save webauthn registration") {
		return
	}
	registration := WebAuthnRegistration{UserID: user.id, Name: name, SessionJSON: string(sessionJSON), ExpiresAt: session.Expires}
	if registration.ExpiresAt.IsZero() {
		registration.ExpiresAt = time.Now().UTC().Add(10 * time.Minute)
	}
	if err := s.store.db.SaveWebAuthnRegistration(r.Context(), registration); err != nil {
		http.Error(w, "save webauthn registration", http.StatusInternalServerError)
		return
	}
	writeJSON(w, options)
}

func (s *Service) WebAuthnRegisterFinish(w http.ResponseWriter, r *http.Request) {
	webAuthn, ok := s.webAuthnOr404(w)
	if !ok {
		return
	}
	user, ok := s.requestWebAuthnUser(w, r, r.URL.Query().Get("email"))
	if !ok {
		return
	}
	registration, err := s.store.db.WebAuthnRegistration(r.Context(), user.id)
	if err != nil || registration.ExpiresAt.Before(time.Now().UTC()) {
		http.Error(w, "registration session expired", http.StatusBadRequest)
		return
	}
	var session webauthnlib.SessionData
	if err := json.Unmarshal([]byte(registration.SessionJSON), &session); err != nil {
		http.Error(w, "load registration session", http.StatusInternalServerError)
		return
	}
	credential, err := webAuthn.FinishRegistration(user, session, r)
	if HTTPFail(w, err, http.StatusBadRequest, "finish webauthn registration") {
		return
	}
	dbCredential, err := databaseWebAuthnCredential(user.id, registration.Name, *credential)
	if HTTPFail(w, err, http.StatusInternalServerError, "save webauthn credential") {
		return
	}
	if err := s.store.db.ConsumeWebAuthnRegistration(r.Context(), dbCredential); err != nil {
		http.Error(w, "save webauthn credential", http.StatusInternalServerError)
		return
	}
	writeJSONStatus(w, http.StatusCreated, credentialResponse(dbCredential))
}

func (s *Service) WebAuthnCredentials(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.webAuthnOr404(w); !ok {
		return
	}
	user, ok := s.requestWebAuthnUser(w, r, "")
	if !ok {
		return
	}
	rows, err := s.store.db.WebAuthnCredentialsByUserID(r.Context(), user.id)
	if HTTPFail(w, err, http.StatusInternalServerError, "list webauthn credentials") {
		return
	}
	writeJSON(w, u.Map(rows, credentialResponse))
}

func (s *Service) WebAuthnCredential(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.webAuthnOr404(w); !ok {
		return
	}
	user, ok := s.requestWebAuthnUser(w, r, "")
	if !ok {
		return
	}
	var req struct {
		Name string `json:"name" validate:"notblank"`
	}
	if !decodeAndValidate(w, r, &req) {
		return
	}
	if err := s.store.db.RenameWebAuthnCredential(r.Context(), chi.URLParam(r, "id"), user.id, strings.TrimSpace(req.Name)); err != nil {
		writeWebAuthnStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) DeleteWebAuthnCredential(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.webAuthnOr404(w); !ok {
		return
	}
	user, ok := s.requestWebAuthnUser(w, r, "")
	if !ok {
		return
	}
	if err := s.store.db.DeleteWebAuthnCredential(r.Context(), chi.URLParam(r, "id"), user.id); err != nil {
		writeWebAuthnStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) WebAuthnLoginBegin(w http.ResponseWriter, r *http.Request) {
	webAuthn, ok := s.webAuthnOr404(w)
	if !ok {
		return
	}
	var req struct {
		LoginSessionID string `json:"login_session_id" validate:"required"`
	}
	if !decodeAndValidate(w, r, &req) {
		return
	}
	loginSession, err := s.store.LoginSessionByID(r.Context(), req.LoginSessionID)
	if err != nil || loginSession.ExpiresAt.Before(time.Now().UTC()) || loginSession.Authenticated {
		http.Error(w, "login session not found or expired", http.StatusBadRequest)
		return
	}
	options, session, err := webAuthn.BeginDiscoverableLogin(webauthnlib.WithUserVerification(protocol.VerificationRequired))
	if HTTPFail(w, err, http.StatusInternalServerError, "begin webauthn login") {
		return
	}
	sessionJSON, err := json.Marshal(session)
	if HTTPFail(w, err, http.StatusInternalServerError, "save webauthn login") {
		return
	}
	if err := s.store.SaveLoginSessionWebAuthn(r.Context(), req.LoginSessionID, string(sessionJSON)); err != nil {
		http.Error(w, "save webauthn login", http.StatusInternalServerError)
		return
	}
	writeJSON(w, options)
}

func (s *Service) WebAuthnLoginFinish(w http.ResponseWriter, r *http.Request) {
	webAuthn, ok := s.webAuthnOr404(w)
	if !ok {
		return
	}
	var req struct {
		LoginSessionID string          `json:"login_session_id" validate:"required"`
		Assertion      json.RawMessage `json:"assertion"        validate:"required"`
	}
	if !decodeAndValidate(w, r, &req) {
		return
	}
	loginSession, err := s.store.LoginSessionByID(r.Context(), req.LoginSessionID)
	if err != nil || loginSession.ExpiresAt.Before(time.Now().UTC()) || loginSession.Authenticated || loginSession.WebAuthnSession == "" {
		http.Error(w, "login session not found or expired", http.StatusBadRequest)
		return
	}
	var session webauthnlib.SessionData
	if err := json.Unmarshal([]byte(loginSession.WebAuthnSession), &session); err != nil {
		http.Error(w, "load webauthn login", http.StatusInternalServerError)
		return
	}
	assertionRequest := r.Clone(r.Context())
	assertionRequest.Body = io.NopCloser(bytes.NewReader(req.Assertion))
	assertionRequest.ContentLength = int64(len(req.Assertion))
	handler := func(_ []byte, userHandle []byte) (webauthnlib.User, error) {
		userID, err := strconv.ParseInt(string(userHandle), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("unknown credential")
		}
		return s.webAuthnUserByID(r.Context(), userID)
	}
	resolved, credential, err := webAuthn.FinishPasskeyLogin(handler, session, assertionRequest)
	if HTTPFail(w, err, http.StatusBadRequest, "finish webauthn login") {
		return
	}
	if credential.Authenticator.CloneWarning {
		s.cfg.Log.Warn("webauthn credential clone warning", "credential_id", webAuthnCredentialID(credential.ID))
	}
	credentialJSON, err := webAuthnCredentialJSON(*credential)
	if HTTPFail(w, err, http.StatusInternalServerError, "update webauthn credential") {
		return
	}
	if err := s.store.db.UpdateWebAuthnCredential(r.Context(), webAuthnCredentialID(credential.ID), credentialJSON, time.Now().UTC()); err != nil {
		http.Error(w, "update webauthn credential", http.StatusInternalServerError)
		return
	}
	user, ok := resolved.(webAuthnUser)
	if !ok {
		http.Error(w, "resolve webauthn user", http.StatusInternalServerError)
		return
	}
	if err := s.store.MarkLoginSessionAuthenticated(r.Context(), req.LoginSessionID, user.email); err != nil {
		http.Error(w, "complete webauthn login", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"redirect_url": s.IssuerURL() + "/authorize?session_id=" + req.LoginSessionID})
}

func (s *Service) requestWebAuthnUser(w http.ResponseWriter, r *http.Request, emailFallback string) (webAuthnUser, bool) {
	subject, ok := Subject(r.Context())
	if !ok || subject == "" {
		if fallback := strings.TrimSpace(emailFallback); fallback != "" && !s.cfg.SetupComplete() {
			subject, ok = fallback, true
		}
	}
	if !ok || subject == "" {
		http.Error(w, "authenticated user required", http.StatusUnauthorized)
		return webAuthnUser{}, false
	}
	user, err := s.webAuthnUserByEmail(r.Context(), subject)
	if err != nil {
		s.cfg.Log.Error("webauthn user lookup failed", "subject", subject, "error", err)
		http.Error(w, "lookup authenticated user", http.StatusInternalServerError)
		return webAuthnUser{}, false
	}
	return user, true
}

func (s *Service) webAuthnOr404(w http.ResponseWriter) (*webauthnlib.WebAuthn, bool) {
	webAuthn := s.GetWebAuthn()
	if !s.PassKeyEnabled() || webAuthn == nil {
		http.Error(w, "webauthn is not enabled", http.StatusNotFound)
		return nil, false
	}
	return webAuthn, true
}

func credentialResponse(row WebAuthnCredential) webAuthnCredentialResponse {
	response := webAuthnCredentialResponse{ID: row.ID, Name: row.Name, CreatedAt: row.CreatedAt.Format(time.RFC3339)}
	if !row.LastUsedAt.IsZero() {
		response.LastUsedAt = row.LastUsedAt.Format(time.RFC3339)
	}
	return response
}

func writeWebAuthnStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrNotFound) {
		http.Error(w, "credential not found", http.StatusNotFound)
		return
	}
	http.Error(w, "update credential", http.StatusInternalServerError)
}
