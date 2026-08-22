package auth

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/ory/fosite"
	"github.com/ory/fosite/handler/oauth2"
	"github.com/ory/fosite/handler/pkce"
	"github.com/ory/fosite/storage"
)

// FositeStore implements fosite.Storage using our existing SQLite tables.
type FositeStore struct {
	*Store
	issuerURL string
}

func NewFositeStore(store *Store, issuerURL string) *FositeStore {
	return &FositeStore{Store: store, issuerURL: issuerURL}
}

func (s *FositeStore) BeginTX(ctx context.Context) (context.Context, error) {
	return s.db.BeginTX(ctx)
}

func (s *FositeStore) Commit(ctx context.Context) error {
	return s.db.Commit(ctx)
}

func (s *FositeStore) Rollback(ctx context.Context) error {
	return s.db.Rollback(ctx)
}

// ClientManager

func (s *FositeStore) GetClient(ctx context.Context, id string) (fosite.Client, error) {
	c, err := s.Client(ctx, id)
	if err != nil {
		return nil, err
	}
	c.Audience = []string{s.issuerURL}
	return c, nil
}

func (s *FositeStore) ClientAssertionJWTValid(_ context.Context, _ string) error { return nil }

func (s *FositeStore) SetClientAssertionJWT(_ context.Context, _ string, _ time.Time) error {
	return nil
}

// PKCERequestStorage

func (s *FositeStore) CreatePKCERequestSession(ctx context.Context, code string, req fosite.Requester) error {
	// Fosite calls CreateAuthorizeCodeSession with a sanitized request (only code+redirect_uri),
	// stripping code_challenge. This call has the PKCE-only sanitized form, so we update the row.
	challenge := req.GetRequestForm().Get("code_challenge")
	method := req.GetRequestForm().Get("code_challenge_method")
	return s.db.UpdateAuthCodePKCE(ctx, tokenSignature(code), challenge, method)
}

func (s *FositeStore) GetPKCERequestSession(ctx context.Context, code string, session fosite.Session) (fosite.Requester, error) {
	auth, err := s.db.AuthCode(ctx, tokenSignature(code), time.Time{}, false)
	if errors.Is(err, ErrNotFound) {
		return nil, fosite.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get pkce request session: %w", err)
	}

	client, err := s.Client(ctx, auth.ClientID)
	if err != nil {
		return nil, err
	}

	redirectURI, _ := url.Parse(auth.RedirectURI)

	if jwtSession, ok := session.(*oauth2.JWTSession); ok {
		jwtSession.Subject = auth.Subject
	}

	req := fosite.NewRequest()
	req.Client = client
	req.GrantedScope = auth.Scopes
	req.RequestedScope = auth.Scopes
	req.Session = session
	req.Form = url.Values{
		"code_challenge":        {auth.CodeChallenge},
		"code_challenge_method": {auth.CodeChallengeMethod},
		"redirect_uri":          {auth.RedirectURI},
	}
	if redirectURI != nil {
		req.Form.Set("redirect_uri", redirectURI.String())
	}
	return req, nil
}

func (s *FositeStore) DeletePKCERequestSession(_ context.Context, _ string) error { return nil }

// Ensure interfaces are implemented
var (
	_ fosite.Storage              = (*FositeStore)(nil)
	_ pkce.PKCERequestStorage     = (*FositeStore)(nil)
	_ oauth2.AuthorizeCodeStorage = (*FositeStore)(nil)
	_ oauth2.AccessTokenStorage   = (*FositeStore)(nil)
	_ oauth2.RefreshTokenStorage  = (*FositeStore)(nil)
	_ storage.Transactional       = (*FositeStore)(nil)
)
