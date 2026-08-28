package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"

	"github.com/golang-jwt/jwt/v5"
)

type SigningKey struct {
	Private *ecdsa.PrivateKey
	Public  *ecdsa.PublicKey
}

type signingKeyMaterial struct {
	Key        *SigningKey
	PrivatePEM string
	PublicPEM  string
}

type claims struct {
	Email  string      `json:"email"`
	Scope  string      `json:"scope"`
	Locale localeClaim `json:"locale"`
	jwt.RegisteredClaims
}

type localeClaim struct {
	Timezone string `json:"timezone"`
}

func randomToken(bytes int) (string, error) {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func tokenSignature(token string) string {
	sum := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func codeChallenge(verifier string) string {
	return tokenSignature(verifier)
}

func newSigningKey() (signingKeyMaterial, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return signingKeyMaterial{}, err
	}
	privateDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return signingKeyMaterial{}, err
	}
	publicDER, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		return signingKeyMaterial{}, err
	}
	privatePEM := string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: privateDER}))
	publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}))
	return signingKeyMaterial{Key: &SigningKey{Private: key, Public: &key.PublicKey}, PrivatePEM: privatePEM, PublicPEM: publicPEM}, nil
}

func parseSigningKey(privatePEM string, publicPEM string) (*SigningKey, error) {
	privateBlock, _ := pem.Decode([]byte(privatePEM))
	if privateBlock == nil {
		return nil, fmt.Errorf("decode private signing key")
	}
	private, err := x509.ParseECPrivateKey(privateBlock.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse private signing key: %w", err)
	}
	publicBlock, _ := pem.Decode([]byte(publicPEM))
	if publicBlock == nil {
		return nil, fmt.Errorf("decode public signing key")
	}
	publicAny, err := x509.ParsePKIXPublicKey(publicBlock.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse public signing key: %w", err)
	}
	public, ok := publicAny.(*ecdsa.PublicKey)
	if !ok {
		return nil, fmt.Errorf("public signing key is not ECDSA")
	}
	return &SigningKey{Private: private, Public: public}, nil
}

func (s *Service) verifyAccessToken(token string) (*claims, error) {
	tokenClaims := &claims{}
	issuer := s.IssuerURL()
	parsed, err := jwt.ParseWithClaims(token, tokenClaims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodES256 {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return s.signingKey.Public, nil
	}, jwt.WithIssuer(issuer), jwt.WithAudience(issuer))
	if err != nil {
		return nil, err
	}
	if !parsed.Valid || tokenClaims.Subject == "" {
		return nil, fmt.Errorf("invalid token")
	}
	return tokenClaims, nil
}
