package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"

	webauthnlib "github.com/go-webauthn/webauthn/webauthn"

	u "tallyo/internal/utils"
)

type webAuthnUser struct {
	id          int64
	email       string
	credentials []webauthnlib.Credential
}

func (u webAuthnUser) WebAuthnID() []byte { return []byte(strconv.FormatInt(u.id, 10)) }

func (u webAuthnUser) WebAuthnName() string { return u.email }

func (u webAuthnUser) WebAuthnDisplayName() string { return u.email }

func (u webAuthnUser) WebAuthnCredentials() []webauthnlib.Credential { return u.credentials }

func (s *Service) webAuthnUserByEmail(ctx context.Context, email string) (webAuthnUser, error) {
	userID, err := s.store.db.UserIDByEmail(ctx, email)
	if err != nil {
		return webAuthnUser{}, fmt.Errorf("lookup user id by email %q: %w", email, err)
	}
	return s.webAuthnUserByID(ctx, userID)
}

func (s *Service) webAuthnUserByID(ctx context.Context, userID int64) (webAuthnUser, error) {
	email, err := s.store.db.UserEmailByID(ctx, userID)
	if err != nil {
		return webAuthnUser{}, fmt.Errorf("lookup user email: %w", err)
	}
	rows, err := s.store.db.WebAuthnCredentialsByUserID(ctx, userID)
	if err != nil {
		return webAuthnUser{}, fmt.Errorf("load webauthn credentials: %w", err)
	}
	credentialFromRow := func(row WebAuthnCredential) (webauthnlib.Credential, error) {
		var credential webauthnlib.Credential
		if err := json.Unmarshal([]byte(row.CredentialJSON), &credential); err != nil {
			return webauthnlib.Credential{}, fmt.Errorf("decode webauthn credential: %w", err)
		}
		return credential, nil
	}
	credentials, err := u.MapErr(rows, credentialFromRow)
	if err != nil {
		return webAuthnUser{}, err
	}
	return webAuthnUser{id: userID, email: email, credentials: credentials}, nil
}

func webAuthnCredentialID(id []byte) string {
	return base64.RawURLEncoding.EncodeToString(id)
}

func webAuthnCredentialJSON(credential webauthnlib.Credential) (string, error) {
	data, err := json.Marshal(credential)
	if err != nil {
		return "", fmt.Errorf("encode webauthn credential: %w", err)
	}
	return string(data), nil
}

func databaseWebAuthnCredential(userID int64, name string, credential webauthnlib.Credential) (WebAuthnCredential, error) {
	encoded, err := webAuthnCredentialJSON(credential)
	if err != nil {
		return WebAuthnCredential{}, err
	}
	return WebAuthnCredential{ID: webAuthnCredentialID(credential.ID), UserID: userID, Name: name, CredentialJSON: encoded}, nil
}
