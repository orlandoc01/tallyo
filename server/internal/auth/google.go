package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

const googleCallbackTimeout = 10 * time.Second

type googleOAuthConfig interface {
	AuthCodeURL(state string, opts ...oauth2.AuthCodeOption) string
	Exchange(ctx context.Context, code string, opts ...oauth2.AuthCodeOption) (*oauth2.Token, error)
}

func newGoogleConfig(cfg Config) googleOAuthConfig {
	return &oauth2.Config{
		ClientID:     cfg.GoogleClientID,
		ClientSecret: cfg.GoogleClientSecret,
		Endpoint:     google.Endpoint,
		RedirectURL:  cfg.IssuerURL + "/auth/google/callback",
		Scopes:       []string{"openid", "email"},
	}
}

func googleEmail(ctx context.Context, token string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.googleapis.com/oauth2/v2/userinfo", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("google userinfo status %d", resp.StatusCode)
	}
	var body struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", err
	}
	if body.Email == "" {
		return "", fmt.Errorf("missing email")
	}
	return body.Email, nil
}

func (s *Service) GoogleLogin(w http.ResponseWriter, r *http.Request) {
	googleConfig := s.GetGoogleConfig()
	if !s.GoogleEnabled() || googleConfig == nil {
		http.Error(w, "google auth is not enabled", http.StatusNotFound)
		return
	}
	session, err := s.store.LoginSessionByID(r.Context(), r.URL.Query().Get("login_session"))
	if err != nil || session.ExpiresAt.Before(time.Now()) {
		http.Error(w, "login session expired", http.StatusBadRequest)
		return
	}
	http.Redirect(w, r, googleConfig.AuthCodeURL(session.CallbackState, oauth2.AccessTypeOnline), http.StatusFound)
}

func (s *Service) GoogleCallback(w http.ResponseWriter, r *http.Request) {
	googleConfig := s.GetGoogleConfig()
	if !s.GoogleEnabled() || googleConfig == nil {
		http.Error(w, "google auth is not enabled", http.StatusNotFound)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), googleCallbackTimeout)
	defer cancel()
	session, err := s.store.LoginSessionByCallbackState(ctx, r.URL.Query().Get("state"))
	if err != nil || session.ExpiresAt.Before(time.Now()) {
		http.Error(w, "authorization state expired", http.StatusBadRequest)
		return
	}
	tok, err := googleConfig.Exchange(ctx, r.URL.Query().Get("code"))
	if HTTPFail(w, err, http.StatusBadGateway, "google token exchange failed") {
		return
	}
	email, err := s.googleEmail(ctx, tok.AccessToken)
	if HTTPFail(w, err, http.StatusBadGateway, "google email lookup failed") {
		return
	}
	email = strings.ToLower(email)
	allowed, err := s.store.IsEmailAllowed(ctx, email)
	if HTTPFail(w, err, http.StatusInternalServerError, "check email allowed") {
		return
	}
	if !allowed {
		http.Error(w, "google authentication failed", http.StatusBadRequest)
		return
	}
	if err := s.store.MarkLoginSessionAuthenticated(ctx, session.ID, email); err != nil {
		http.Error(w, "save login", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, s.cfg.IssuerURL+"/authorize?session_id="+url.QueryEscape(session.ID), http.StatusFound)
}
