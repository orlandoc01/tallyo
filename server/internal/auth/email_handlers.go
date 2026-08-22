package auth

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func (s *Service) EmailSend(w http.ResponseWriter, r *http.Request) {
	if !s.EmailEnabled() {
		http.Error(w, "email auth is not enabled", http.StatusNotFound)
		return
	}
	var req struct {
		LoginSessionID string `json:"login_session_id" validate:"required"`
		Email          string `json:"email"            validate:"required"`
		CodeVerifier   string `json:"code_verifier"`
	}
	if !decodeAndValidate(w, r, &req) {
		return
	}
	req.Email = normalizeEmail(req.Email)
	allowed, err := s.store.IsEmailAllowed(r.Context(), req.Email)
	if HTTPFail(w, err, http.StatusInternalServerError, "check email allowed") {
		return
	}
	if !allowed {
		writeJSON(w, map[string]any{"sent": true, "message": "If that address is registered, a code has been sent."})
		return
	}
	session, err := s.store.LoginSessionByID(r.Context(), req.LoginSessionID)
	if err != nil || session.ExpiresAt.Before(time.Now().UTC()) {
		http.Error(w, "login session not found or expired", http.StatusBadRequest)
		return
	}
	if session.Authenticated {
		http.Error(w, "login session already authenticated", http.StatusBadRequest)
		return
	}
	const otpLifetime = 10 * time.Minute
	const otpCooldown = 60 * time.Second
	if !session.EmailOTPExpiresAt.IsZero() && session.EmailOTPExpiresAt.After(time.Now().UTC().Add(otpLifetime-otpCooldown)) {
		http.Error(w, "please wait before requesting a new code", http.StatusTooManyRequests)
		return
	}
	code, err := generateOTP()
	if HTTPFail(w, err, http.StatusInternalServerError, "generate otp") {
		return
	}
	magicToken, err := randomToken(32)
	if HTTPFail(w, err, http.StatusInternalServerError, "generate magic token") {
		return
	}
	hash := tokenSignature(code)
	magicHash := tokenSignature(magicToken)
	expiresAt := time.Now().UTC().Add(10 * time.Minute)
	if err := s.store.SaveEmailOTP(r.Context(), req.LoginSessionID, req.Email, hash, magicHash, req.CodeVerifier, expiresAt); err != nil {
		http.Error(w, "save otp", http.StatusInternalServerError)
		return
	}
	magicLink := s.cfg.IssuerURL + "/auth/email/magic?token=" + url.QueryEscape(magicToken) +
		"&session_id=" + url.QueryEscape(req.LoginSessionID) +
		"&email=" + url.QueryEscape(req.Email)
	emailSubject := "Tallyo Email Login"
	body := fmt.Sprintf(
		"Your Tallyo sign-in code is: %s\n\n"+
			"Or, click this link to sign in instantly:\n%s\n\n"+
			"Both expire in 10 minutes.\n\n"+
			"If you didn't request this, you can safely ignore this email.",
		code, magicLink,
	)
	if err := s.GetEmailSender().Send(r.Context(), req.Email, emailSubject, body); err != nil {
		http.Error(w, "send email failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"sent": true})
}

func (s *Service) EmailVerify(w http.ResponseWriter, r *http.Request) {
	if !s.EmailEnabled() {
		http.Error(w, "email auth is not enabled", http.StatusNotFound)
		return
	}
	var req struct {
		LoginSessionID string `json:"login_session_id" validate:"required"`
		Email          string `json:"email"            validate:"required"`
		Code           string `json:"code"             validate:"required"`
	}
	if !decodeAndValidate(w, r, &req) {
		return
	}
	req.Email = normalizeEmail(req.Email)
	hash := tokenSignature(req.Code)
	session, err := s.store.VerifyEmailOTP(r.Context(), req.LoginSessionID, req.Email, hash)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidCode):
			writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "invalid_code", "message": "Incorrect code. Please try again."})
		case errors.Is(err, ErrTooManyAttempts):
			writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "too_many_attempts", "message": "Too many incorrect attempts. Please start over."})
		case errors.Is(err, ErrExpired):
			writeJSONStatus(w, http.StatusBadRequest, map[string]any{"error": "expired", "message": "Code has expired. Please request a new one."})
		default:
			http.Error(w, "verification failed", http.StatusBadRequest)
		}
		return
	}
	redirectURL := s.cfg.IssuerURL + "/authorize?session_id=" + session.ID
	writeJSON(w, map[string]any{"redirect_url": redirectURL})
}

func (s *Service) EmailMagicLink(w http.ResponseWriter, r *http.Request) {
	if !s.OAuthEnabled() {
		http.Error(w, "oauth is not enabled", http.StatusNotFound)
		return
	}
	q := r.URL.Query()
	token := q.Get("token")
	sessionID := q.Get("session_id")
	email := normalizeEmail(q.Get("email"))
	if token == "" || sessionID == "" || email == "" {
		http.Error(w, "missing required parameters", http.StatusBadRequest)
		return
	}
	allowed, err := s.store.IsEmailAllowed(r.Context(), email)
	if HTTPFail(w, err, http.StatusInternalServerError, "check email allowed") {
		return
	}
	if !allowed {
		writeInvalidMagicLink(w)
		return
	}
	hash := tokenSignature(token)
	session, err := s.store.VerifyEmailMagicToken(r.Context(), sessionID, email, hash)
	if err != nil {
		switch {
		case errors.Is(err, ErrExpired):
			http.Error(w, "Magic link has expired. Please request a new sign-in email.", http.StatusBadRequest)
		default:
			writeInvalidMagicLink(w)
		}
		return
	}
	if session.PKCEVerifier != "" {
		s.setMagicCookie(w, "pkce-verifier", session.PKCEVerifier, "/auth/callback")
	}
	if session.Purpose == "passkey" {
		s.setMagicCookie(w, "st_post_login", url.QueryEscape("/settings/passkeys?onboarding=passkey"), "/")
	}
	http.Redirect(w, r, s.cfg.IssuerURL+"/authorize?session_id="+url.QueryEscape(session.ID), http.StatusFound)
}

func (s *Service) setMagicCookie(w http.ResponseWriter, name, value, path string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     path,
		MaxAge:   300,
		SameSite: http.SameSiteLaxMode,
		Secure:   strings.HasPrefix(s.cfg.IssuerURL, "https://"),
		HttpOnly: false,
	})
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func writeInvalidMagicLink(w http.ResponseWriter) {
	http.Error(w, "Invalid or already used magic link.", http.StatusBadRequest)
}

func generateOTP() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(900000))
	if err != nil {
		return "", err
	}
	code := n.Int64() + 100000
	return fmt.Sprintf("%d", code), nil
}
