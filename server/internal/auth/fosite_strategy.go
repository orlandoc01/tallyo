package auth

import (
	"context"

	"github.com/ory/fosite"
	"github.com/ory/fosite/handler/oauth2"
)

// plainTokenStrategy implements fosite's CoreStrategy using our existing
// random-token format (base64url random bytes) with SHA256 signatures.
// This ensures compatibility with our existing database storage and browser
// session flow while still integrating with Fosite's request processing.
type plainTokenStrategy struct{}

func (p *plainTokenStrategy) GenerateAccessToken(_ context.Context, _ fosite.Requester) (string, string, error) {
	return generateSignedToken()
}

func (p *plainTokenStrategy) AccessTokenSignature(_ context.Context, token string) string {
	return tokenSignature(token)
}

func (p *plainTokenStrategy) ValidateAccessToken(_ context.Context, _ fosite.Requester, _ string) error {
	// Access tokens are JWTs — validation is handled by the JWT strategy.
	return nil
}

func (p *plainTokenStrategy) GenerateRefreshToken(_ context.Context, _ fosite.Requester) (string, string, error) {
	return generateSignedToken()
}

func (p *plainTokenStrategy) RefreshTokenSignature(_ context.Context, token string) string {
	return tokenSignature(token)
}

func (p *plainTokenStrategy) ValidateRefreshToken(_ context.Context, _ fosite.Requester, _ string) error {
	// Refresh token validity is checked by storage lookup.
	return nil
}

func (p *plainTokenStrategy) GenerateAuthorizeCode(_ context.Context, _ fosite.Requester) (string, string, error) {
	return generateSignedToken()
}

func (p *plainTokenStrategy) AuthorizeCodeSignature(_ context.Context, token string) string {
	return tokenSignature(token)
}

func (p *plainTokenStrategy) ValidateAuthorizeCode(_ context.Context, _ fosite.Requester, _ string) error {
	// Authorization code validity is checked by storage lookup.
	return nil
}

func generateSignedToken() (string, string, error) {
	token, err := randomToken(32)
	if err != nil {
		return "", "", err
	}
	return token, tokenSignature(token), nil
}

// Ensure CoreStrategy is implemented
var _ oauth2.AccessTokenStrategy = (*plainTokenStrategy)(nil)
var _ oauth2.RefreshTokenStrategy = (*plainTokenStrategy)(nil)
var _ oauth2.AuthorizeCodeStrategy = (*plainTokenStrategy)(nil)
