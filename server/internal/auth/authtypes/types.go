package authtypes

import "time"

type OAuthClient struct {
	ID              string
	RedirectURIs    []string
	GrantTypes      []string
	ResponseTypes   []string
	Scopes          []string
	ApplicationType string
	ClientName      string
	Public          bool
	Preseeded       bool
}

type SigningKeyPEM struct {
	PrivatePEM string
	PublicPEM  string
}

type LoginSession struct {
	ID                  string
	ClientID            string
	RedirectURI         string
	State               string
	CodeChallenge       string
	CodeChallengeMethod string
	Scopes              []string
	CallbackState       string
	Subject             string
	Authenticated       bool
	ExpiresAt           time.Time
	Email               string
	EmailOTP            string
	EmailOTPExpiresAt   time.Time
	EmailOTPAttempts    int
	EmailMagicToken     string
	PKCEVerifier        string
	WebAuthnSession     string
	Purpose             string
}

type WebAuthnCredential struct {
	ID             string
	UserID         int64
	Name           string
	CredentialJSON string
	CreatedAt      time.Time
	LastUsedAt     time.Time
}

type WebAuthnRegistration struct {
	UserID      int64
	Name        string
	SessionJSON string
	ExpiresAt   time.Time
}

type EmailOTPUpdate struct {
	SessionID        string
	Email            string
	HashedOTP        string
	HashedMagicToken string
	PKCEVerifier     string
	ExpiresAt        time.Time
}

type AuthCode struct {
	ClientID            string
	Subject             string
	Scopes              []string
	RedirectURI         string
	CodeChallenge       string
	CodeChallengeMethod string
	ExpiresAt           time.Time
	Active              bool
}

type OAuthToken struct {
	Signature string
	ClientID  string
	Subject   string
	Scopes    []string
	ExpiresAt time.Time
	RequestID string
	Active    bool
}
