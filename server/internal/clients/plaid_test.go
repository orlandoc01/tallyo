package clients

import (
	"testing"
	"time"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"tallyo/internal/utils/must"
)

func TestNewPlaidSDKClientConfiguresEnvironment(t *testing.T) {
	tests := []struct {
		env  string
		host string
	}{
		{env: "production", host: string(plaidapi.Production)},
		{env: "sandbox", host: string(plaidapi.Sandbox)},
		{env: "development", host: string(plaidapi.Development)},
		{env: "unknown", host: string(plaidapi.Development)},
	}
	for _, tt := range tests {
		client := NewPlaidSDKClient(PlaidCredential{ClientID: "client", Secret: "secret", Environment: tt.env})
		if client.clientID != "client" || client.secret != "secret" {
			t.Fatalf("client credentials = %q/%q", client.clientID, client.secret)
		}
		url, err := client.api.GetConfig().ServerURL(0, nil)
		must.NoErr(t, err)
		if url != tt.host {
			t.Fatalf("env %q url = %q, want %q", tt.env, url, tt.host)
		}
		if timeout := client.api.GetConfig().HTTPClient.Timeout; timeout != 30*time.Second {
			t.Fatalf("HTTP timeout = %s, want %s", timeout, 30*time.Second)
		}
	}
}
