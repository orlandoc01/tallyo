package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ory/fosite"
	"github.com/ory/fosite/handler/oauth2"
	jwtpkg "github.com/ory/fosite/token/jwt"
)

// AccessTokenStorage

func (s *FositeStore) CreateAccessTokenSession(ctx context.Context, signature string, req fosite.Requester) error {
	create := s.db.CreateAccessToken
	return createTokenSession(ctx, signature, req, fosite.AccessToken, 15*time.Minute, "access", create)
}

func (s *FositeStore) GetAccessTokenSession(ctx context.Context, signature string, session fosite.Session) (fosite.Requester, error) {
	return s.getTokenSession(ctx, signature, session, tokenSessionKind{
		name:      "access",
		tokenType: fosite.AccessToken,
		get:       s.db.AccessToken,
	})
}

func (s *FositeStore) DeleteAccessTokenSession(ctx context.Context, signature string) error {
	return s.db.DeleteAccessToken(ctx, signature)
}

// RefreshTokenStorage

func (s *FositeStore) CreateRefreshTokenSession(ctx context.Context, signature string, _ string, req fosite.Requester) error {
	create := s.db.CreateRefreshToken
	return createTokenSession(ctx, signature, req, fosite.RefreshToken, 168*time.Hour, "refresh", create)
}

func (s *FositeStore) GetRefreshTokenSession(ctx context.Context, signature string, session fosite.Session) (fosite.Requester, error) {
	return s.getTokenSession(ctx, signature, session, tokenSessionKind{
		name:        "refresh",
		tokenType:   fosite.RefreshToken,
		setClaims:   true,
		setAudience: true,
		get:         s.db.RefreshToken,
	})
}

func (s *FositeStore) DeleteRefreshTokenSession(ctx context.Context, signature string) error {
	return s.db.RevokeRefreshToken(ctx, signature)
}

func (s *FositeStore) RotateRefreshToken(ctx context.Context, _ string, oldSignature string) error {
	if err := s.db.RevokeLiveRefreshToken(ctx, oldSignature, time.Now().UTC()); errors.Is(err, ErrNotFound) {
		return fosite.ErrNotFound
	} else if err != nil {
		return fmt.Errorf("rotate refresh token: %w", err)
	}
	return nil
}

// TokenRevocationStorage

func (s *FositeStore) RevokeAccessToken(ctx context.Context, requestID string) error {
	return s.db.DeleteAccessTokensByRequestID(ctx, requestID)
}

func (s *FositeStore) RevokeRefreshToken(ctx context.Context, requestID string) error {
	return s.db.RevokeRefreshTokensByRequestID(ctx, requestID)
}

func createTokenSession(
	ctx context.Context,
	signature string,
	req fosite.Requester,
	tokenType fosite.TokenType,
	fallback time.Duration,
	tokenName string,
	create func(context.Context, OAuthToken) error,
) error {
	expires := requesterExpires(req, tokenType, fallback)
	err := create(ctx, OAuthToken{Signature: signature, ClientID: req.GetClient().GetID(), Subject: requesterSubject(req), Scopes: req.GetGrantedScopes(), ExpiresAt: expires, RequestID: req.GetID()})
	if err != nil {
		return fmt.Errorf("create %s token session: %w", tokenName, err)
	}
	return nil
}

// tokenSessionKind names the per-token-type differences between the access and
// refresh session lookups. The flags are security-relevant (activeOnly gates
// revocation checks), so they are named fields rather than positional bools.
type tokenSessionKind struct {
	name        string
	tokenType   fosite.TokenType
	activeOnly  bool
	setClaims   bool
	setAudience bool
	get         func(context.Context, string, time.Time, bool) (OAuthToken, error)
}

func (s *FositeStore) getTokenSession(
	ctx context.Context,
	signature string,
	session fosite.Session,
	kind tokenSessionKind,
) (fosite.Requester, error) {
	token, err := kind.get(ctx, signature, time.Now().UTC(), kind.activeOnly)
	if errors.Is(err, ErrNotFound) {
		return nil, fosite.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get %s token session: %w", kind.name, err)
	}
	client, err := s.Client(ctx, token.ClientID)
	if err != nil {
		return nil, fmt.Errorf("get client for %s token: %w", kind.name, err)
	}

	applyJWTSession(session, token.Subject, token.ExpiresAt, kind.tokenType, kind.setClaims)
	req := fosite.NewRequest()
	req.ID = token.RequestID
	if req.ID == "" {
		req.ID = signature
	}
	req.Client = client
	req.GrantedScope = token.Scopes
	req.RequestedScope = token.Scopes
	if kind.setAudience {
		req.GrantedAudience = fosite.Arguments{s.issuerURL}
	}
	req.Session = session
	if kind.tokenType == fosite.RefreshToken && !token.Active {
		return req, fosite.ErrInactiveToken
	}
	return req, nil
}

func requesterSubject(req fosite.Requester) string {
	if req.GetSession() == nil {
		return ""
	}
	return req.GetSession().GetSubject()
}

func requesterExpires(req fosite.Requester, tokenType fosite.TokenType, fallback time.Duration) time.Time {
	if req.GetSession() != nil {
		if expires := req.GetSession().GetExpiresAt(tokenType); !expires.IsZero() {
			return expires
		}
	}
	return time.Now().UTC().Add(fallback)
}

func applyJWTSession(session fosite.Session, subject string, expires time.Time, tokenType fosite.TokenType, setClaims bool) {
	jwtSession, ok := session.(*oauth2.JWTSession)
	if !ok {
		return
	}
	jwtSession.Subject = subject
	if setClaims {
		if jwtSession.JWTClaims == nil {
			jwtSession.JWTClaims = &jwtpkg.JWTClaims{}
		}
		jwtSession.JWTClaims.Subject = subject
	}
	jwtSession.SetExpiresAt(tokenType, expires)
}

func applyAuthorizeCodeJWTSession(session fosite.Session, subject string) {
	if _, ok := session.(*oauth2.JWTSession); !ok {
		return
	}
	applyJWTSession(session, subject, time.Now().UTC().Add(15*time.Minute), fosite.AccessToken, true)
	applyJWTSession(session, subject, time.Now().UTC().Add(168*time.Hour), fosite.RefreshToken, false)
}
