package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ory/fosite"
	"github.com/ory/fosite/handler/oauth2"
	"tallyo/internal/utils/must"
)

func TestFositeStrategyFunctions(t *testing.T) {
	strategy := &plainTokenStrategy{}

	token, sig, err := strategy.GenerateAccessToken(context.Background(), nil)
	must.NoErr(t, err)
	if token == "" || sig == "" {
		t.Fatalf("GenerateAccessToken returned empty token or sig")
	}

	if strategy.AccessTokenSignature(context.Background(), token) != sig {
		t.Fatalf("AccessTokenSignature mismatch")
	}

	must.NoErr(t, strategy.ValidateAccessToken(context.Background(), nil, token))

	rt, rtSig, err := strategy.GenerateRefreshToken(context.Background(), nil)
	must.NoErr(t, err)
	if rt == "" || rtSig == "" {
		t.Fatalf("GenerateRefreshToken returned empty token or sig")
	}

	if strategy.RefreshTokenSignature(context.Background(), rt) != rtSig {
		t.Fatalf("RefreshTokenSignature mismatch")
	}

	must.NoErr(t, strategy.ValidateRefreshToken(context.Background(), nil, rt))

	code, codeSig, err := strategy.GenerateAuthorizeCode(context.Background(), nil)
	must.NoErr(t, err)
	if code == "" || codeSig == "" {
		t.Fatalf("GenerateAuthorizeCode returned empty")
	}

	if strategy.AuthorizeCodeSignature(context.Background(), code) != codeSig {
		t.Fatalf("AuthorizeCodeSignature mismatch")
	}

	must.NoErr(t, strategy.ValidateAuthorizeCode(context.Background(), nil, code))
}

func TestFositeAccessTokenSessionRountrip(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()

	req := fosite.NewRequest()
	req.Client = Client{OAuthClient: OAuthClient{ID: FrontendClientID}}
	req.GrantedScope = []string{"read"}
	req.ID = "access-request-1"
	session := &oauth2.JWTSession{Subject: "test@example.com"}
	session.SetExpiresAt(fosite.AccessToken, time.Now().Add(time.Hour))
	req.Session = session

	must.NoErr(t, service.fositeStore.CreateAccessTokenSession(ctx, "access-sig", req))

	retrieved, err := service.fositeStore.GetAccessTokenSession(ctx, "access-sig", &oauth2.JWTSession{})
	must.NoErr(t, err)
	if retrieved.GetClient().GetID() != FrontendClientID {
		t.Fatalf("GetAccessTokenSession client = %q", retrieved.GetClient().GetID())
	}
}

func TestFositePKCERequestSessionErrors(t *testing.T) {
	service := newTestService(t)
	_, err := service.fositeStore.GetPKCERequestSession(context.Background(), "missing", &oauth2.JWTSession{})
	if !errors.Is(err, fosite.ErrNotFound) {
		t.Fatalf("missing PKCE err = %v", err)
	}

	store := NewStore(&pkceErrorStore{authPersistence: service.store.db})
	fositeStore := NewFositeStore(store, service.cfg.IssuerURL)
	_, err = fositeStore.GetPKCERequestSession(context.Background(), "code", &oauth2.JWTSession{})
	if err == nil || errors.Is(err, fosite.ErrNotFound) || !strings.Contains(err.Error(), "get pkce request session") {
		t.Fatalf("operational PKCE err = %v", err)
	}
}

type pkceErrorStore struct {
	authPersistence
}

func (s *pkceErrorStore) AuthCode(context.Context, string, time.Time, bool) (AuthCode, error) {
	return AuthCode{}, errors.New("database offline")
}
