package auth

import (
	"encoding/json"
	"testing"

	webauthnlib "github.com/go-webauthn/webauthn/webauthn"
	"tallyo/internal/utils/must"
)

func TestWebAuthnUserMethods(t *testing.T) {
	credential := webauthnlib.Credential{ID: []byte("credential-id")}
	user := webAuthnUser{id: 42, email: "user@example.com", credentials: []webauthnlib.Credential{credential}}

	if string(user.WebAuthnID()) != "42" {
		t.Fatalf("WebAuthnID() = %q", string(user.WebAuthnID()))
	}
	if user.WebAuthnName() != "user@example.com" {
		t.Fatalf("WebAuthnName() = %q", user.WebAuthnName())
	}
	if user.WebAuthnDisplayName() != "user@example.com" {
		t.Fatalf("WebAuthnDisplayName() = %q", user.WebAuthnDisplayName())
	}
	if got := user.WebAuthnCredentials(); len(got) != 1 || string(got[0].ID) != "credential-id" {
		t.Fatalf("WebAuthnCredentials() = %#v", got)
	}
}

func TestDatabaseWebAuthnCredential(t *testing.T) {
	credential := webauthnlib.Credential{ID: []byte{0x01, 0x02, 0x03}}
	row, err := databaseWebAuthnCredential(42, "Laptop", credential)
	must.NoErr(t, err)
	if row.ID != "AQID" || row.UserID != 42 || row.Name != "Laptop" {
		t.Fatalf("databaseWebAuthnCredential() = %#v", row)
	}

	var decoded webauthnlib.Credential
	must.NoErr(t, json.Unmarshal([]byte(row.CredentialJSON), &decoded))
	if string(decoded.ID) != string(credential.ID) {
		t.Fatalf("decoded credential ID = %v", decoded.ID)
	}
}
