package auth

import (
	"net/http"

	"github.com/ory/fosite/handler/oauth2"
	"github.com/ory/fosite/token/jwt"
)

func (s *Service) Token(w http.ResponseWriter, r *http.Request) {
	s.tokenMu.Lock()
	defer s.tokenMu.Unlock()

	session := newFositeSession()

	ctx := r.Context()
	provider := s.oauthProvider()
	accessRequest, err := provider.NewAccessRequest(ctx, r, session)
	if err != nil {
		provider.WriteAccessError(ctx, w, accessRequest, err)
		return
	}

	// Add email claim from subject
	if subject := accessRequest.GetSession().GetSubject(); subject != "" {
		if jwtSession, ok := accessRequest.GetSession().(*oauth2.JWTSession); ok {
			if jwtSession.JWTClaims == nil {
				jwtSession.JWTClaims = &jwt.JWTClaims{}
			}
			if jwtSession.JWTClaims.Extra == nil {
				jwtSession.JWTClaims.Extra = make(map[string]any)
			}
			jwtSession.JWTClaims.Extra["email"] = subject
			jwtSession.JWTClaims.Extra["locale"] = map[string]string{"timezone": s.Timezone()}
		}
	}

	accessResponse, err := provider.NewAccessResponse(ctx, accessRequest)
	if err != nil {
		provider.WriteAccessError(ctx, w, accessRequest, err)
		return
	}

	provider.WriteAccessResponse(ctx, w, accessRequest, accessResponse)
}

func newFositeSession() *oauth2.JWTSession {
	return &oauth2.JWTSession{
		JWTClaims: &jwt.JWTClaims{},
		JWTHeader: &jwt.Headers{},
	}
}
