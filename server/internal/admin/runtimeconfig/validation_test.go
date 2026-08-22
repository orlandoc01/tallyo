package runtimeconfig

import (
	"reflect"
	"testing"
)

func TestLocaleConfigValidate(t *testing.T) {
	tests := map[string]struct {
		config  LocaleConfig
		wantErr string
	}{
		"missing timezone": {
			wantErr: "timezone is required",
		},
		"invalid timezone": {
			config:  LocaleConfig{Timezone: "Not/AZone"},
			wantErr: "load locale timezone: unknown time zone Not/AZone",
		},
		"valid timezone": {
			config: LocaleConfig{Timezone: "America/Los_Angeles"},
		},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			assertValidationError(t, tc.wantErr, tc.config.Validate(false))
		})
	}
}

func TestSecurityConfigValidate(t *testing.T) {
	if err := (SecurityConfig{TrustedProxyCIDRs: []string{"10.0.0.0/8"}}).Validate(true); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	assertValidationError(
		t,
		"parse trusted proxy CIDR \"invalid\": netip.ParsePrefix(\"invalid\"): no '/'",
		(SecurityConfig{TrustedProxyCIDRs: []string{"invalid"}}).Validate(true),
	)
}

func TestWebAuthnConfigValidate(t *testing.T) {
	example := "example.com"
	tests := map[string]struct {
		config  WebAuthnConfig
		enabled bool
		wantErr string
	}{
		"disabled skips validation": {
			config: WebAuthnConfig{RPID: stringPtr("example.com:8080")},
		},
		"rp id with port": {
			config:  WebAuthnConfig{RPID: stringPtr("example.com:8080")},
			enabled: true,
			wantErr: "invalid webauthn_rp_id \"example.com:8080\": use a valid bare hostname without scheme or port",
		},
		"non absolute origin": {
			config:  WebAuthnConfig{RPID: &example, RPOrigins: []string{"not-a-url"}},
			enabled: true,
			wantErr: "invalid webauthn_rp_origins entry \"not-a-url\": must be an absolute URL",
		},
		"valid configuration": {
			config:  WebAuthnConfig{RPID: &example, RPOrigins: []string{"https://example.com"}},
			enabled: true,
		},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			assertValidationError(t, tc.wantErr, tc.config.Validate(tc.enabled))
		})
	}
}

func TestLLMConfigValidate(t *testing.T) {
	tests := map[string]struct {
		config  LLMConfig
		enabled bool
		wantErr string
	}{
		"disabled skips validation": {
			config: LLMConfig{},
		},
		"missing url": {
			enabled: true,
			wantErr: "ollama url is required when the ollama provider is enabled",
		},
		"non absolute url": {
			config:  LLMConfig{Ollama: OllamaConfig{URL: stringPtr("not-a-url")}},
			enabled: true,
			wantErr: "invalid ollama url \"not-a-url\": must be an absolute URL",
		},
		"non http url": {
			config:  LLMConfig{Ollama: OllamaConfig{URL: stringPtr("ftp://example.com")}},
			enabled: true,
			wantErr: "invalid ollama url \"ftp://example.com\": must be an absolute URL",
		},
		"valid configuration": {
			config:  LLMConfig{Ollama: OllamaConfig{URL: stringPtr("http://localhost:11434"), Model: "llama3"}},
			enabled: true,
		},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			assertValidationError(t, tc.wantErr, tc.config.Validate(tc.enabled))
		})
	}
}

func TestMCPConfigNormalize(t *testing.T) {
	tests := map[string]struct {
		config  MCPConfig
		want    MCPConfig
		wantErr string
	}{
		"normalizes and drops empty hosts": {
			config: MCPConfig{DynamicRedirectHosts: []string{" EXAMPLE.COM ", "", "api.example.com"}},
			want:   MCPConfig{DynamicRedirectHosts: []string{"example.com", "api.example.com"}},
		},
		"rejects paths and ports": {
			config:  MCPConfig{DynamicRedirectHosts: []string{"example.com:8443"}},
			wantErr: "invalid dynamic redirect host \"example.com:8443\": use a bare hostname without scheme, path, or port",
		},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			got, err := tc.config.Normalize()
			assertValidationError(t, tc.wantErr, err)
			if err == nil && !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("Normalize() = %#v, want %#v", got, tc.want)
			}
		})
	}
}

func assertValidationError(t *testing.T, want string, err error) {
	t.Helper()
	if want == "" && err != nil {
		t.Fatalf("error = %v", err)
	}
	if want != "" && (err == nil || err.Error() != want) {
		t.Fatalf("error = %v, want %q", err, want)
	}
}

func stringPtr(value string) *string {
	return new(value)
}
