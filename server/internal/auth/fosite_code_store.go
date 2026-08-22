package auth

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/ory/fosite"
)

// AuthorizeCodeStorage

func (s *FositeStore) CreateAuthorizeCodeSession(ctx context.Context, code string, req fosite.Requester) error {
	subject := ""
	if req.GetSession() != nil {
		subject = req.GetSession().GetSubject()
	}
	redirectURI := ""
	if ar, ok := req.(fosite.AuthorizeRequester); ok {
		if u := ar.GetRedirectURI(); u != nil {
			redirectURI = u.String()
		}
	}
	auth := AuthCode{
		ClientID:            req.GetClient().GetID(),
		Subject:             subject,
		Scopes:              req.GetGrantedScopes(),
		RedirectURI:         redirectURI,
		CodeChallenge:       req.GetRequestForm().Get("code_challenge"),
		CodeChallengeMethod: req.GetRequestForm().Get("code_challenge_method"),
		ExpiresAt:           time.Now().UTC().Add(10 * time.Minute),
	}
	return s.CreateAuthCode(ctx, code, auth)
}

func (s *FositeStore) GetAuthorizeCodeSession(ctx context.Context, code string, session fosite.Session) (fosite.Requester, error) {
	auth, err := s.db.AuthCode(ctx, tokenSignature(code), time.Now().UTC(), false)
	if errors.Is(err, ErrNotFound) {
		return nil, fosite.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get authorize code session: %w", err)
	}

	client, err := s.Client(ctx, auth.ClientID)
	if err != nil {
		return nil, fmt.Errorf("get client for auth code: %w", err)
	}

	redirectURI, _ := url.Parse(auth.RedirectURI)

	applyAuthorizeCodeJWTSession(session, auth.Subject)

	req := fosite.NewRequest()
	req.ID = code
	req.Client = client
	req.GrantedScope = auth.Scopes
	req.RequestedScope = auth.Scopes
	req.GrantedAudience = fosite.Arguments{s.issuerURL}
	req.Session = session
	req.RequestedAt = time.Now().UTC()
	req.Form = url.Values{
		"redirect_uri":          {auth.RedirectURI},
		"code_challenge":        {auth.CodeChallenge},
		"code_challenge_method": {auth.CodeChallengeMethod},
	}
	if redirectURI != nil {
		req.Form.Set("redirect_uri", redirectURI.String())
	}
	if !auth.Active {
		return req, fosite.ErrInvalidatedAuthorizeCode
	}

	return req, nil
}

func (s *FositeStore) InvalidateAuthorizeCodeSession(ctx context.Context, code string) error {
	err := s.db.InvalidateAuthCode(ctx, tokenSignature(code))
	if errors.Is(err, ErrNotFound) {
		return fosite.ErrInvalidatedAuthorizeCode
	}
	return err
}
